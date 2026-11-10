const hits = new Map();
const WINDOW_MS = 60000;
const MAX = 5;

module.exports = function rateLimit(req, res, next) {
  const key = req.ip + '|' + (req.body && req.body.username ? req.body.username : '');
  const now = Date.now();
  const arr = (hits.get(key) || []).filter(function(t) { return now - t < WINDOW_MS; });
  if (arr.length >= MAX) {
    return res.status(429).json({ error: 'Too many attempts, try later' });
  }
  arr.push(now);
  hits.set(key, arr);
  next();
};