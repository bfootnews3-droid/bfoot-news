const { pollResults, pollPublic } = require('./db');
const clients = new Set();

function addClient(res) {
  clients.add(res);
  return () => clients.delete(res);
}

function broadcast(pollId) {
  const p = pollResults(pollId);
  if (!p) return;
  const payload = `data: ${JSON.stringify(pollPublic(p))}\n\n`;
  for (const c of clients) c.write(payload);
}

module.exports = { addClient, broadcast };
