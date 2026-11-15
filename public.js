const express = require('express');
const { db, pollResults, votedOption } = require('../db');
const { hmac } = require('../util');
const { CATS } = require('../i18n');

const r = express.Router({ mergeParams: true });
const PER_PAGE = 12;

const withVote = (id, vid) => {
  const p = pollResults(id);
  if (p) p.voted = votedOption(id, hmac(vid));
  return p;
};

r.get('/', (req, res) => {
  const breaking = db.prepare(`SELECT * FROM articles WHERE published=1 AND (is_breaking=1 OR category='breaking')
                               ORDER BY created_at DESC, id DESC LIMIT 5`).all();
  const latest = db.prepare('SELECT * FROM articles WHERE published=1 ORDER BY created_at DESC, id DESC LIMIT 9').all();
  const polls = db.prepare('SELECT id FROM polls WHERE published=1 ORDER BY created_at DESC, id DESC LIMIT 3').all()
    .map((p) => withVote(p.id, req.vid));
  const ads = db.prepare('SELECT * FROM ads WHERE published=1 ORDER BY position, id DESC').all();
  res.render('home', { breaking, latest, polls, ads, active: 'home' });
});

r.get('/news', (req, res) => {
  const lang = res.locals.lang;
  const cat = CATS.includes(req.query.cat) ? req.query.cat : '';
  const q = String(req.query.q || '').trim().slice(0, 80);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);

  const where = ['published=1'];
  const params = [];
  if (cat) { where.push('category=?'); params.push(cat); }
  if (q) {
    const like = '%' + q.replace(/[\\%_]/g, '\\$&') + '%';
    where.push(`(title_ar LIKE ? ESCAPE '\\' OR title_fr LIKE ? ESCAPE '\\' OR excerpt_ar LIKE ? ESCAPE '\\' OR excerpt_fr LIKE ? ESCAPE '\\')`);
    params.push(like, like, like, like);
  }
  const W = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) c FROM articles WHERE ${W}`).get(...params).c;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const items = db.prepare(`SELECT * FROM articles WHERE ${W} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...params, PER_PAGE, (page - 1) * PER_PAGE);

  const qs = new URLSearchParams();
  if (cat) qs.set('cat', cat);
  if (q) qs.set('q', q);
  res.render('news', {
    items, cat, q, page, pages, active: 'news',
    base: `/${lang}/news?${qs.toString()}${qs.toString() ? '&' : ''}page=`,
    qsCat: (c) => { const p = new URLSearchParams(); if (c) p.set('cat', c); if (q) p.set('q', q); const s = p.toString(); return `/${lang}/news${s ? '?' + s : ''}`; },
  });
});

r.get('/news/:slug', (req, res, next) => {
  const a = db.prepare('SELECT * FROM articles WHERE slug=? AND published=1').get(req.params.slug);
  if (!a) return next();
  db.prepare('UPDATE articles SET views=views+1 WHERE id=?').run(a.id);
  a.views += 1;
  const related = db.prepare('SELECT * FROM articles WHERE published=1 AND category=? AND id<>? ORDER BY created_at DESC LIMIT 3').all(a.category, a.id);
  const L = res.locals.L;
  res.render('article', {
    a, related, active: 'news',
    meta: {
      title: L(a, 'title'),
      description: res.locals.excerptOf(a).slice(0, 160),
      image: a.image ? `${res.locals.SITE_URL}/uploads/${a.image}` : null,
      type: 'article',
    },
  });
});

r.get('/polls', (req, res) => {
  const lang = res.locals.lang;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const per = 9;
  const total = db.prepare('SELECT COUNT(*) c FROM polls WHERE published=1').get().c;
  const pages = Math.max(1, Math.ceil(total / per));
  const polls = db.prepare('SELECT id FROM polls WHERE published=1 ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?')
    .all(per, (page - 1) * per).map((p) => withVote(p.id, req.vid));
  res.render('polls', { polls, page, pages, base: `/${lang}/polls?page=`, active: 'polls' });
});

r.get('/polls/:id', (req, res, next) => {
  const p = db.prepare('SELECT id FROM polls WHERE id=? AND published=1').get(parseInt(req.params.id, 10));
  if (!p) return next();
  const poll = withVote(p.id, req.vid);
  res.render('poll', { p: poll, active: 'polls', meta: { title: res.locals.L(poll, 'question') } });
});

module.exports = r;
