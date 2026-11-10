const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../db/db');
const router = express.Router();

router.post('/register', async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const allowedRoles = ['admin', 'executor'];
  const userRole = allowedRoles.includes(role) ? role : 'executor';

  try {
    const hash = await bcrypt.hash(String(password), 10);
    db.run('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
      [String(username).trim(), hash, userRole],
      function(err) {
        if (err) {
          if (/UNIQUE constraint failed/i.test(err.message)) {
            return res.status(409).json({ error: 'User exists' });
          }
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

      const token = jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        process.env.JWT_SECRET
      );

      res.json({ token, role: user.role });
    } catch (e) {
      res.status(500).json({ error: 'Server error' });
    }
  });
});

module.exports = router;