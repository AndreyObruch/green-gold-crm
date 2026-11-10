const db = require('../db/db');

function log(userId, username, action, entity, entityId, detail) {
  const sql = 'INSERT INTO audit_log (user_id, username, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?, ?)';
  db.run(sql, [userId || null, username || null, action, entity || null, entityId || null, detail || null], function(err) {
    if (err) console.error('audit_log write error:', err.message);
  });
}

module.exports = log;