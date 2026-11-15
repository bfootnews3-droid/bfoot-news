require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dataDir = path.join(__dirname, 'data');
const uploadDir = path.join(__dirname, 'uploads');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });

function loadSecret() {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 16) return process.env.JWT_SECRET;
  const f = path.join(dataDir, '.secret');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(f, 'utf8').trim();
}

const PORT = parseInt(process.env.PORT, 10) || 3000;

module.exports = {
  PORT,
  SITE_URL: (process.env.SITE_URL || `http://localhost:${PORT}`).replace(/\/$/, ''),
  IS_PROD: process.env.NODE_ENV === 'production',
  SECRET: loadSecret(),
  dataDir,
  uploadDir,
  VOTES_PER_IP: parseInt(process.env.VOTES_PER_IP, 10) || 3,
  social: {
    Instagram: process.env.INSTAGRAM_URL || 'https://www.instagram.com/b_foot_news/',
    TikTok: process.env.TIKTOK_URL || 'https://www.tiktok.com/@bfoot.news',
    Facebook: process.env.FACEBOOK_URL || 'https://www.facebook.com/share/19vmMZChko/',
  },
};
