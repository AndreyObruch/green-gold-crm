const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../db/db');
const router = express.Router();

const TOKEN_TTL = '8h';
const USER_RE = /^[A-Za-z0-9_]{3,30}$/;
const MIN_PASS = 8;

router.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const uname = String(username).trim();
  if (!USER_RE.test(uname)) return res.status(400).json({ error: 'Username must be 3-30 chars: letters, digits, underscore' });
  if (String(password).length < MIN_PASS) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const userRole = 'executor';
  try {
    const hash = await bcrypt.hash(String(password), 10);
    db.run('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
      [uname, hash, userRole],
      function(err) {
        if (err) {
          if (/UNIQUE constraint failed/i.test(err.message)) return res.status(409).json({ error: 'User exists' });
          return res.status(500).json({ error: err.message });
        }
        res.json({ id: this.lastID });
      }
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  db.get('SELECT * FROM users WHERE username = ?', [String(username).trim()], async (err, user) => {
    if (err) return res.status(500).json({ error: 'Server error' });
    try {
      const valid = user ? await bcrypt.compare(String(password), user.password_hash) : false;
      if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
      const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, process.env.JWT_SECRET, { expiresIn: TOKEN_TTL });
      res.json({ token, role: user.role });
    } catch (e) {
      res.status(500).json({ error: 'Server error' });
    }
  });
});

module.exports = router;