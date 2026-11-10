const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../db/db');
const router = express.Router();

router.post('/register', async (req, res) => {
  const { username, password, role } = req.body;
  try {
    const hash = await bcrypt.hash(password, 10);
    db.run('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', 
      [username, hash, role || 'executor'], 
      function(err) {
        if (err) return res.status(400).json({ error: 'User exists' });
        res.json({ id: this.lastID });
      }
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
    if (err || !user) return res.status(400).json({ error: 'User not found' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(400).json({ error: 'Invalid password' });
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, process.env.JWT_SECRET);
    res.json({ token, role: user.role });
  });
});

module.exports = router;