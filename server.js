require('dotenv').config();
const express = require('express');
const path = require('path');

if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET missing in .env');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

const hits = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const key = req.ip + ':' + req.path;
    const now = Date.now();
    let rec = hits.get(key);
    if (!rec || now - rec.start > windowMs) { rec = { start: now, count: 0 }; hits.set(key, rec); }
    rec.count++;
    if (rec.count > max) return res.status(429).json({ error: 'Too many requests' });
    next();
  };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) { if (now - v.start > 60000) hits.delete(k); }
}, 60000).unref();

app.use('/api/auth', rateLimit(20, 60000), require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/files', require('./routes/files'));
app.use('/api/messages', require('./routes/messages'));

app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, () => console.log('Server on http://localhost:' + PORT));