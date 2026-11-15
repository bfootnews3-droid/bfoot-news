const express = require('express');
const path = require('path');
const crypto = require('crypto');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const cfg = require('./config');
const { db } = require('./db');
const { CATS, I18N } = require('./i18n');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: null,
    },
  },
}));
app.use(compression({ filter: (req, res) => (req.path.startsWith('/api/') ? false : compression.filter(req, res)) }));

const age = cfg.IS_PROD ? '7d' : 0;
app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: age }));
app.use('/uploads', express.static(cfg.uploadDir, { maxAge: '30d', immutable: true }));

app.use(cookieParser());

// Anonymous voter id (cookie) + language/i18n locals
app.use((req, res, next) => {
  let vid = req.cookies.bf_vid;
  if (!/^[a-f0-9]{32}$/.test(vid || '')) {
    vid = crypto.randomBytes(16).toString('hex');
    res.cookie('bf_vid', vid, { httpOnly: true, sameSite: 'lax', secure: cfg.IS_PROD, maxAge: 365 * 24 * 3600 * 1000 });
  }
  req.vid = vid;

  const m = req.path.match(/^\/(ar|fr)(\/.*)?$/);
  const lang = m ? m[1] : req.cookies.bf_lang === 'ar' ? 'ar' : 'fr';
  if (m && req.cookies.bf_lang !== lang) res.cookie('bf_lang', lang, { sameSite: 'lax', maxAge: 365 * 24 * 3600 * 1000 });

  const cur = () => res.locals.lang;
  Object.assign(res.locals, {
    lang, dir: lang === 'ar' ? 'rtl' : 'ltr',
    rest: m ? m[2] || '' : '',
    SITE_URL: cfg.SITE_URL, social: cfg.social, CATS, meta: {}, active: '',
    t: (k) => I18N[cur()][k] ?? I18N.fr[k] ?? k,
    catLabel: (c) => I18N[cur()]['cat_' + c] || c,
    L: (row, f) => row[f + '_' + cur()] || row[f + '_' + (cur() === 'ar' ? 'fr' : 'ar')] || '',
    excerptOf: (a) => {
      const L = res.locals.L;
      return L(a, 'excerpt') || (L(a, 'content').slice(0, 150) + '…');
    },
    fmtDate: (s) => {
      if (!s) return '';
      const d = new Date(String(s).replace(' ', 'T') + 'Z');
      return new Intl.DateTimeFormat(cur() === 'ar' ? 'ar-u-nu-latn' : 'fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
    },
    altUrl: (l) => '/' + l + (m ? req.originalUrl.slice(3) : ''),
  });
  next();
});

app.get('/', (req, res) => {
  const al = (req.headers['accept-language'] || '').toLowerCase();
  const lang = req.cookies.bf_lang || (al.startsWith('ar') ? 'ar' : 'fr');
  res.redirect(302, '/' + (lang === 'ar' ? 'ar' : 'fr'));
});

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nDisallow: /admin\nDisallow: /api/\nSitemap: ${cfg.SITE_URL}/sitemap.xml\n`);
});

app.get('/sitemap.xml', (req, res) => {
  const urls = [];
  for (const l of ['ar', 'fr']) {
    urls.push({ loc: `/${l}` }, { loc: `/${l}/news` }, { loc: `/${l}/polls` });
    db.prepare('SELECT slug, updated_at FROM articles WHERE published=1').all()
      .forEach((a) => urls.push({ loc: `/${l}/news/${a.slug}`, last: a.updated_at.slice(0, 10) }));
    db.prepare('SELECT id FROM polls WHERE published=1').all().forEach((p) => urls.push({ loc: `/${l}/polls/${p.id}` }));
  }
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => `<url><loc>${cfg.SITE_URL}${u.loc}</loc>${u.last ? `<lastmod>${u.last}</lastmod>` : ''}</url>`).join('\n') + '\n</urlset>';
  res.type('application/xml').send(xml);
});

app.use('/api', rateLimit({ windowMs: 10 * 60 * 1000, max: 600, standardHeaders: true, legacyHeaders: false }), require('./routes/api'));
app.use('/admin', require('./routes/admin'));
app.use('/:lang(ar|fr)', require('./routes/public'));

app.use((req, res) => res.status(404).render('404'));
app.use((err, req, res, next) => {
  console.error(err);
  if (req.path.startsWith('/api/')) return res.status(err.status || 500).json({ code: 'server_error' });
  res.status(500).send('Server error');
});

app.listen(cfg.PORT, () => console.log(`BFOOT NEWS running on ${cfg.SITE_URL}`));
