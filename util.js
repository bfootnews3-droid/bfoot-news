const crypto = require('crypto');
const { SECRET } = require('./config');

exports.hmac = (s) => crypto.createHmac('sha256', SECRET).update(String(s)).digest('hex');

exports.slugify = (str) => {
  const s = String(str || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return s || 'article-' + Date.now().toString(36);
};
