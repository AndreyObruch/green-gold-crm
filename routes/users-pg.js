const express = require('express');
const { query } = require('../db/pg-db');
const { authenticate, authorizeRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/users (Admin only)
router.get('/', authenticate, authorizeRole(['admin']), async (req, res) => {
  try {
    const result = await query(
      'SELECT id, username, role, created_at FROM users ORDER BY username'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get users error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;