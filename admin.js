const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cfg = require('../config');
const { db, pollResults } = require('../db');
const { slugify } = require('../util');
const { CATS, I18N } = require('../i18n');
const { broadcast } = require('../realtime');

const r = express.Router();
const DUMMY_HASH = bcrypt.hashSync('dummy-password', 12);
const clean = (s, max) => String(s || '').trim().slice(0, max);

r.use(express.urlencoded({ extended: true, limit: '1mb' }));
r.use((req, res, next) => {
  res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
  res.locals.lang = 'fr'; // admin UI is in French
  res.locals.CATS = CATS;
  res.locals.catLabel = (c) => I18N.fr['cat_' + c];
  next();
});

// ---------- Auth ----------
const getAdmin = (req) => {
  try { return jwt.verify(req.cookies.bf_admin, cfg.SECRET); } catch { return null; }
};

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  handler: (req, res) => res.status(429).render('admin/login', { error: 'Trop de tentatives. Réessayez dans 15 minutes.' }),
});

r.get('/login', (req, res) => {
  if (getAdmin(req)) return res.redirect('/admin');
  res.render('admin/login', { error: null });
});

r.post('/login', loginLimiter, async (req, res) => {
  const row = db.prepare('SELECT * FROM admins WHERE username=?').get(String(req.body.email || '').trim().toLowerCase());
  const ok = await bcrypt.compare(String(req.body.password || ''), row ? row.password_hash : DUMMY_HASH);
  if (!row || !ok) return res.status(401).render('admin/login', { error: 'Identifiants incorrects.' });
  const token = jwt.sign({ id: row.id, u: row.username }, cfg.SECRET, { expiresIn: '8h' });
  res.cookie('bf_admin', token, { httpOnly: true, sameSite: 'strict', secure: cfg.IS_PROD, maxAge: 8 * 3600 * 1000, path: '/' });
  res.redirect('/admin');
});

r.use((req, res, next) => {
  const a = getAdmin(req);
  if (!a) return res.redirect('/admin/login');
  res.locals.admin = a;
  next();
});

r.post('/logout', (req, res) => { res.clearCookie('bf_admin', { path: '/' }); res.redirect('/admin/login'); });

// ---------- Upload ----------
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
const storage = multer.diskStorage({
    destination: cfg.uploadDir,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex') + EXT[file.mimetype]),
  });
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, !!EXT[file.mimetype]),
});
const pollUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 12 },
  fileFilter: (req, file, cb) => cb(null, !!EXT[file.mimetype]),
}).array('opt_image', 12);

const handleUpload = (req, res, next) => upload(req, res, (err) => {
  if (err) req.uploadError = err.code === 'LIMIT_FILE_SIZE' ? 'Image trop lourde (max 5 Mo).' : "Erreur lors de l'envoi de l'image.";
  next();
});
const handlePollUpload = (req, res, next) => pollUpload(req, res, (err) => {
  if (err) req.uploadError = err.code === 'LIMIT_FILE_SIZE' ? 'Une image est trop lourde (max 5 Mo).' : "Erreur lors de l'envoi des images.";
  next();
});

const removeFile = (name) => { if (name) fs.unlink(path.join(cfg.uploadDir, path.basename(name)), () => {}); };

function isRealImage(file) { // check magic bytes, not just the declared MIME type
  try {
    const fd = fs.openSync(file.path, 'r');
    const b = Buffer.alloc(12);
    fs.readSync(fd, b, 0, 12, 0);
    fs.closeSync(fd);
    return (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) ||
      b.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) ||
      b.slice(0, 4).toString() === 'GIF8' ||
      (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP');
  } catch { return false; }
}

function checkUpload(req) {
  if (req.uploadError) return { error: req.uploadError };
  if (!req.file) return { file: null };
  if (!isRealImage(req.file)) { removeFile(req.file.filename); return { error: 'Fichier image invalide.' }; }
  return { file: req.file.filename };
}

// ---------- Dashboard ----------
const one = (sql) => db.prepare(sql).get().c;
const listPolls = (limit) => db.prepare(`
  SELECT p.*, (SELECT COUNT(*) FROM poll_options WHERE poll_id=p.id) AS options,
         (SELECT COUNT(*) FROM votes WHERE poll_id=p.id) AS votes
  FROM polls p ORDER BY created_at DESC, id DESC ${limit ? 'LIMIT ' + Number(limit) : ''}`).all();

r.get('/', (req, res) => {
  res.render('admin/dashboard', {
    page: 'dashboard',
    stats: {
      articles: one('SELECT COUNT(*) c FROM articles'),
      published: one('SELECT COUNT(*) c FROM articles WHERE published=1'),
      polls: one('SELECT COUNT(*) c FROM polls'),
      votes: one('SELECT COUNT(*) c FROM votes'),
      views: one('SELECT COALESCE(SUM(views),0) c FROM articles'),
    },
    articles: db.prepare('SELECT * FROM articles ORDER BY created_at DESC, id DESC LIMIT 5').all(),
    polls: listPolls(5),
  });
});

// ---------- Articles ----------
const readArticle = (b) => ({
  category: CATS.includes(b.category) ? b.category : 'clubs',
  title_ar: clean(b.title_ar, 200), title_fr: clean(b.title_fr, 200),
  excerpt_ar: clean(b.excerpt_ar, 400), excerpt_fr: clean(b.excerpt_fr, 400),
  content_ar: clean(b.content_ar, 30000), content_fr: clean(b.content_fr, 30000),
  is_breaking: b.is_breaking ? 1 : 0, published: b.published ? 1 : 0,
});
const validateArticle = (v) => {
  if (!v.title_ar && !v.title_fr) return 'Un titre (AR ou FR) est obligatoire.';
  if (!v.content_ar && !v.content_fr) return 'Le contenu (AR ou FR) est obligatoire.';
  return null;
};
function uniqueSlug(base) {
  const s = slugify(base);
  let slug = s, i = 2;
  while (db.prepare('SELECT 1 FROM articles WHERE slug=?').get(slug)) slug = `${s}-${i++}`;
  return slug;
}

r.get('/articles', (req, res) => {
  res.render('admin/articles', { page: 'articles', items: db.prepare('SELECT * FROM articles ORDER BY created_at DESC, id DESC').all() });
});

r.get('/articles/new', (req, res) => {
  res.render('admin/article-form', { page: 'articles', isNew: true, id: null, error: null, v: { category: 'clubs', published: 1, is_breaking: 0 } });
});

r.post('/articles', handleUpload, (req, res) => {
  const v = readArticle(req.body);
  const up = checkUpload(req);
  const error = up.error || validateArticle(v);
  if (error) { removeFile(up.file); return res.status(400).render('admin/article-form', { page: 'articles', isNew: true, id: null, error, v }); }
  db.prepare(`INSERT INTO articles(slug,category,title_ar,title_fr,excerpt_ar,excerpt_fr,content_ar,content_fr,image,is_breaking,published)
              VALUES (@slug,@category,@title_ar,@title_fr,@excerpt_ar,@excerpt_fr,@content_ar,@content_fr,@image,@is_breaking,@published)`)
    .run({ ...v, slug: uniqueSlug(v.title_fr || v.title_ar), image: up.file });
  res.redirect('/admin/articles');
});

r.get('/articles/:id/edit', (req, res, next) => {
  const a = db.prepare('SELECT * FROM articles WHERE id=?').get(parseInt(req.params.id, 10));
  if (!a) return next();
  res.render('admin/article-form', { page: 'articles', isNew: false, id: a.id, error: null, v: a });
});

r.post('/articles/:id', handleUpload, (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  const old = db.prepare('SELECT * FROM articles WHERE id=?').get(id);
  if (!old) { if (req.file) removeFile(req.file.filename); return next(); }
  const v = readArticle(req.body);
  const up = checkUpload(req);
  const error = up.error || validateArticle(v);
  if (error) { removeFile(up.file); return res.status(400).render('admin/article-form', { page: 'articles', isNew: false, id, error, v: { ...v, image: old.image } }); }
  let image = old.image;
  if (up.file) { removeFile(old.image); image = up.file; }
  else if (req.body.remove_image) { removeFile(old.image); image = null; }
  db.prepare(`UPDATE articles SET category=@category,title_ar=@title_ar,title_fr=@title_fr,excerpt_ar=@excerpt_ar,excerpt_fr=@excerpt_fr,
              content_ar=@content_ar,content_fr=@content_fr,image=@image,is_breaking=@is_breaking,published=@published,
              updated_at=datetime('now') WHERE id=@id`).run({ ...v, image, id });
  res.redirect('/admin/articles');
});

r.post('/articles/:id/toggle', (req, res) => {
  db.prepare('UPDATE articles SET published = 1 - published, updated_at=datetime(\'now\') WHERE id=?').run(parseInt(req.params.id, 10));
  res.redirect(req.get('referer') || '/admin/articles');
});

r.post('/articles/:id/delete', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const a = db.prepare('SELECT image FROM articles WHERE id=?').get(id);
  if (a) { removeFile(a.image); db.prepare('DELETE FROM articles WHERE id=?').run(id); }
  res.redirect('/admin/articles');
});

// ---------- Polls ----------
function readPoll(b) {
  const ids = [].concat(b.opt_id || []), ar = [].concat(b.opt_ar || []), fr = [].concat(b.opt_fr || []);
  const currentImages = [].concat(b.opt_image_current || []);
  const newImages = b.files || [];
  const options = [];
  for (let i = 0; i < Math.max(ar.length, fr.length) && options.length < 12; i++) {
    const a = clean(ar[i], 150), f = clean(fr[i], 150);
    if (a || f || currentImages[i] || newImages[i]) {
      options.push({ id: parseInt(ids[i], 10) || null, label_ar: a, label_fr: f,
        image: newImages[i] ? newImages[i].filename : (currentImages[i] || null),
        newImage: newImages[i] ? newImages[i].filename : null });
    }
  }
  return {
    question_ar: clean(b.question_ar, 250), question_fr: clean(b.question_fr, 250),
    published: b.published ? 1 : 0, closed: b.closed ? 1 : 0, options,
  };
}
const validatePoll = (v) => {
  if (!v.question_ar && !v.question_fr) return 'Une question (AR ou FR) est obligatoire.';
  if (v.options.length < 2) return 'Ajoutez au moins 2 options.';
  return null;
};

const savePoll = db.transaction((v, pollId) => {
  let existing = [];
  if (!pollId) {
    pollId = db.prepare('INSERT INTO polls(question_ar,question_fr,published,closed) VALUES (?,?,?,?)')
      .run(v.question_ar, v.question_fr, v.published, v.closed).lastInsertRowid;
  } else {
    db.prepare('UPDATE polls SET question_ar=?,question_fr=?,published=?,closed=? WHERE id=?')
      .run(v.question_ar, v.question_fr, v.published, v.closed, pollId);
    existing = db.prepare('SELECT id FROM poll_options WHERE poll_id=?').all(pollId).map((x) => x.id);
    const keep = v.options.map((o) => o.id).filter((x) => existing.includes(x));
    existing.filter((x) => !keep.includes(x)).forEach((x) => db.prepare('DELETE FROM poll_options WHERE id=?').run(x));
  }
  v.options.forEach((o, i) => {
    if (o.id && existing.includes(o.id)) {
      db.prepare('UPDATE poll_options SET label_ar=?,label_fr=?,image=?,position=? WHERE id=? AND poll_id=?').run(o.label_ar, o.label_fr, o.image, i, o.id, pollId);
    } else {
      db.prepare('INSERT INTO poll_options(poll_id,label_ar,label_fr,image,position) VALUES (?,?,?,?,?)').run(pollId, o.label_ar, o.label_fr, o.image, i);
    }
  });
  return Number(pollId);
});

r.get('/polls', (req, res) => res.render('admin/polls', { page: 'polls', items: listPolls() }));

r.get('/polls/new', (req, res) => {
  res.render('admin/poll-form', { page: 'polls', isNew: true, id: null, error: null,
    v: { question_ar: '', question_fr: '', published: 1, closed: 0, options: [{}, {}], total: 0 } });
});

const cleanupPollUploads = (req) => (req.files || []).forEach((f) => removeFile(f.filename));

r.post('/polls', handlePollUpload, (req, res) => {
  const v = readPoll({ ...req.body, files: req.files });
  const error = validatePoll(v);
  if (error) { cleanupPollUploads(req); if (v.options.length < 2) while (v.options.length < 2) v.options.push({}); return res.status(400).render('admin/poll-form', { page: 'polls', isNew: true, id: null, error, v }); }
  savePoll(v, null);
  res.redirect('/admin/polls');
});

r.get('/polls/:id/edit', (req, res, next) => {
  const p = pollResults(parseInt(req.params.id, 10));
  if (!p) return next();
  res.render('admin/poll-form', { page: 'polls', isNew: false, id: p.id, error: null, v: p });
});

r.post('/polls/:id', handlePollUpload, (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  if (!db.prepare('SELECT 1 FROM polls WHERE id=?').get(id)) return next();
  const v = readPoll({ ...req.body, files: req.files });
  const error = validatePoll(v);
  if (error) { cleanupPollUploads(req); while (v.options.length < 2) v.options.push({}); return res.status(400).render('admin/poll-form', { page: 'polls', isNew: false, id, error, v: { ...v, total: 0 } }); }
  const oldImages = db.prepare('SELECT image FROM poll_options WHERE poll_id=?').all(id).map((o) => o.image).filter(Boolean);
  savePoll(v, id);
  oldImages.filter((image) => !v.options.some((o) => o.image === image)).forEach(removeFile);
  broadcast(id);
  res.redirect('/admin/polls');
});

r.post('/polls/:id/toggle', (req, res) => {
  db.prepare('UPDATE polls SET published = 1 - published WHERE id=?').run(parseInt(req.params.id, 10));
  res.redirect(req.get('referer') || '/admin/polls');
});

r.post('/polls/:id/close', (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.prepare('UPDATE polls SET closed = 1 - closed WHERE id=?').run(id);
  broadcast(id);
  res.redirect(req.get('referer') || '/admin/polls');
});

r.post('/polls/:id/reset', (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.prepare('DELETE FROM votes WHERE poll_id=?').run(id);
  broadcast(id);
  res.redirect(req.get('referer') || '/admin/polls');
});

r.post('/polls/:id/delete', (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.prepare('SELECT image FROM poll_options WHERE poll_id=?').all(id).forEach((o) => removeFile(o.image));
  db.prepare('DELETE FROM polls WHERE id=?').run(id); // cascades options + votes
  res.redirect('/admin/polls');
});

// ---------- Publicités ----------
const readAd = (b) => ({
  title: clean(b.title, 160),
  link: clean(b.link, 500),
  position: Math.max(0, parseInt(b.position, 10) || 0),
  published: b.published ? 1 : 0,
});

r.get('/ads', (req, res) => {
  res.render('admin/ads', { page: 'ads', items: db.prepare('SELECT * FROM ads ORDER BY position, id DESC').all() });
});

r.get('/ads/new', (req, res) => {
  res.render('admin/ad-form', { page: 'ads', isNew: true, id: null, error: null,
    v: { title: '', link: '', position: 0, published: 1 } });
});

r.post('/ads', handleUpload, (req, res) => {
  const v = readAd(req.body);
  const up = checkUpload(req);
  const error = up.error || (!v.title && !up.file ? 'Ajoutez un titre ou une image à la publicité.' : null);
  if (error) { removeFile(up.file); return res.status(400).render('admin/ad-form', { page: 'ads', isNew: true, id: null, error, v }); }
  db.prepare('INSERT INTO ads(title,image,link,published,position) VALUES (?,?,?,?,?)')
    .run(v.title, up.file, v.link, v.published, v.position);
  res.redirect('/admin/ads');
});

r.post('/ads/:id/toggle', (req, res) => {
  db.prepare('UPDATE ads SET published = 1 - published WHERE id=?').run(parseInt(req.params.id, 10));
  res.redirect('/admin/ads');
});

r.post('/ads/:id/delete', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const ad = db.prepare('SELECT image FROM ads WHERE id=?').get(id);
  if (ad) { removeFile(ad.image); db.prepare('DELETE FROM ads WHERE id=?').run(id); }
  res.redirect('/admin/ads');
});

module.exports = r;
