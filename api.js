const express = require('express');
const rateLimit = require('express-rate-limit');
const { db, pollResults, pollPublic, votedOption } = require('../db');
const { hmac } = require('../util');
const cfg = require('../config');
const { addClient, broadcast } = require('../realtime');

const r = express.Router();
const voteLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false,
  message: { code: 'rate_limited' },
});

// Server-Sent Events: live results for every poll on the page
r.get('/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  const remove = addClient(res);
  const ping = setInterval(() => res.write(':ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); remove(); });
});

r.get('/polls/:id/results', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const p = db.prepare('SELECT id FROM polls WHERE id=? AND published=1').get(id);
  if (!p) return res.status(404).json({ code: 'not_found' });
  res.json({ ...pollPublic(pollResults(id)), votedOption: votedOption(id, hmac(req.vid)) });
});

r.post('/polls/:id/vote', voteLimiter, express.json({ limit: '1kb' }), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const optionId = parseInt(req.body && req.body.optionId, 10);
  const poll = db.prepare('SELECT * FROM polls WHERE id=? AND published=1').get(id);
  if (!poll) return res.status(404).json({ code: 'not_found' });
  const results = () => pollPublic(pollResults(id));

  if (poll.closed) return res.status(403).json({ code: 'closed', results: results() });
  const opt = db.prepare('SELECT id FROM poll_options WHERE id=? AND poll_id=?').get(optionId, id);
  if (!opt) return res.status(400).json({ code: 'bad_option' });

  const vh = hmac(req.vid);
  const prev = votedOption(id, vh);
  if (prev) return res.status(409).json({ code: 'already_voted', votedOption: prev, results: results() });

  const ih = hmac('ip:' + req.ip);
  const n = db.prepare('SELECT COUNT(*) c FROM votes WHERE poll_id=? AND ip_hash=?').get(id, ih).c;
  if (n >= cfg.VOTES_PER_IP) return res.status(429).json({ code: 'ip_limit', results: results() });

  try {
    db.prepare('INSERT INTO votes(poll_id, option_id, voter_hash, ip_hash) VALUES (?,?,?,?)').run(id, optionId, vh, ih);
  } catch (e) {
    if (String(e.code).startsWith('SQLITE_CONSTRAINT')) {
      return res.status(409).json({ code: 'already_voted', votedOption: votedOption(id, vh), results: results() });
    }
    throw e;
  }
  broadcast(id);
  res.json({ ok: true, votedOption: optionId, results: results() });
});

r.use((req, res) => res.status(404).json({ code: 'not_found' }));
module.exports = r;
