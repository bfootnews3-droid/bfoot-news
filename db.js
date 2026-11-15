const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const cfg = require('./config');

const db = new Database(path.join(cfg.dataDir, 'bfoot.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  category TEXT NOT NULL,
  title_ar TEXT DEFAULT '', title_fr TEXT DEFAULT '',
  excerpt_ar TEXT DEFAULT '', excerpt_fr TEXT DEFAULT '',
  content_ar TEXT DEFAULT '', content_fr TEXT DEFAULT '',
  image TEXT,
  is_breaking INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 1,
  views INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_articles_list ON articles(published, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_cat ON articles(category, published);

CREATE TABLE IF NOT EXISTS polls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_ar TEXT DEFAULT '', question_fr TEXT DEFAULT '',
  published INTEGER NOT NULL DEFAULT 1,
  closed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS poll_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  label_ar TEXT DEFAULT '', label_fr TEXT DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  option_id INTEGER NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  voter_hash TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(poll_id, voter_hash)
);
CREATE INDEX IF NOT EXISTS idx_votes_option ON votes(option_id);
CREATE INDEX IF NOT EXISTS idx_votes_ip ON votes(poll_id, ip_hash);

CREATE TABLE IF NOT EXISTS ads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT '',
  image TEXT,
  link TEXT DEFAULT '',
  published INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ads_list ON ads(published, position, created_at DESC);
`);

// Migration des bases créées avant l’ajout des images sur les choix.
const optionColumns = db.prepare('PRAGMA table_info(poll_options)').all().map((c) => c.name);
if (!optionColumns.includes('image')) db.exec('ALTER TABLE poll_options ADD COLUMN image TEXT');

// ---- First-run admin creation ----
if (!db.prepare('SELECT 1 FROM admins LIMIT 1').get()) {
  const user = String(process.env.ADMIN_EMAIL || 'admin@example.com').trim().toLowerCase();
  let pass = process.env.ADMIN_PASSWORD;
  let generated = false;
  if (!pass || pass.length < 8) { pass = crypto.randomBytes(9).toString('base64url'); generated = true; }
  db.prepare('INSERT INTO admins(username, password_hash) VALUES (?, ?)').run(user, bcrypt.hashSync(pass, 12));
  console.log('\n=== ADMIN CREATED ===');
  console.log('User:', user);
  if (generated) console.log('Password (note it now, shown once):', pass);
  console.log('=====================\n');
}

// ---- Poll helpers ----
function pollResults(pollId) {
  const poll = db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId);
  if (!poll) return null;
  const options = db.prepare(`
    SELECT o.*, COUNT(v.id) AS votes
    FROM poll_options o LEFT JOIN votes v ON v.option_id = o.id
    WHERE o.poll_id = ? GROUP BY o.id ORDER BY o.position, o.id`).all(pollId);
  const total = options.reduce((s, o) => s + o.votes, 0);
  options.forEach((o) => { o.percent = total ? Math.round((o.votes * 1000) / total) / 10 : 0; });
  return { ...poll, options, total };
}

const pollPublic = (p) => ({
  id: p.id, closed: !!p.closed, total: p.total,
  options: p.options.map((o) => ({ id: o.id, votes: o.votes, percent: o.percent })),
});

const votedOption = (pollId, voterHash) => {
  const r = db.prepare('SELECT option_id FROM votes WHERE poll_id = ? AND voter_hash = ?').get(pollId, voterHash);
  return r ? r.option_id : null;
};

module.exports = { db, pollResults, pollPublic, votedOption };
