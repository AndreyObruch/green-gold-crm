const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

let tableReady = false;

async function ensureTable() {
  if (tableReady) return;
  await pool.query(
    'CREATE TABLE IF NOT EXISTS audit_log (' +
    'id SERIAL PRIMARY KEY, ' +
    'created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), ' +
    'user_id INTEGER, ' +
    'user_role TEXT, ' +
    'action TEXT, ' +
    'entity TEXT, ' +
    'entity_id TEXT, ' +
    'details JSONB, ' +
    'ip TEXT)'
  );
  tableReady = true;
}

function safeJson(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (e) {
    return null;
  }
}

function audit(req, action, entity, entityId, details) {
  try {
    const user = req && req.user ? req.user : {};
    const detailsRaw = details !== undefined && details !== null ? details : action;
    const row = {
      userId: user.id || null,
      userRole: user.role || null,
      action: typeof action === 'string' ? action : 'action',
      entity: typeof entity === 'string' ? entity : null,
      entityId: entityId === null || entityId === undefined ? null : String(entityId),
      details: typeof detailsRaw === 'object' ? safeJson(detailsRaw) : { note: String(detailsRaw) },
      ip: req && req.ip ? String(req.ip) : null
    };
    ensureTable()
      .then(function () {
        return pool.query(
          'INSERT INTO audit_log (user_id, user_role, action, entity, entity_id, details, ip) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [row.userId, row.userRole, row.action, row.entity, row.entityId, row.details === null ? null : JSON.stringify(row.details), row.ip]
        );
      })
      .catch(function () {});
  } catch (e) {}
}

audit.audit = audit;
audit.log = audit;
audit.write = audit;
audit.default = audit;

module.exports = new Proxy(audit, {
  get: function (target, prop) {
    if (prop in target) return target[prop];
    return audit;
  }
});