const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../db/pg-db');

const router = express.Router();

// Rate limiting is handled in server.js globally or per-route if needed, 
// but we assume middleware/auth.js handles JWT verification for protected routes.
// Here we handle LOGIN specifically.

router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  try {
    // Find user by username
    const result = await query('SELECT id, username, password_hash, role FROM users WHERE username = $1', [username]);
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    // Compare passwords
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token
    const secret = process.env.JWT_SECRET || 'fallback_secret_for_dev_only_change_in_prod';
    const expiresIn = process.env.JWT_EXPIRES_IN || '8h';
    
    const token = jwt.sign(
      { 
        id: user.id, 
        username: user.username, 
        role: user.role 
      },
      secret,
      { expiresIn }
    );

    // Log audit entry for successful login
    try {
      await query(
        'INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES ($1, $2, $3, $4, $5)',
        [user.id, 'login_success', 'user', user.id, `IP: ${req.ip}`]
      );
    } catch (auditErr) {
      console.error('Audit log failed on login:', auditErr);
      // Don't fail the request if audit fails
    }

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;