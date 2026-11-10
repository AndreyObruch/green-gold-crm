const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'crm.db');
const db = new sqlite3.Database(dbPath);

const initSql = fs.readFileSync(path.join(__dirname, 'init.sql'), 'utf8');
db.exec(initSql, (err) => {
  if (err) console.error('DB init error:', err);
  else console.log('Database initialized');
  db.run('ALTER TABLE tasks ADD COLUMN deleted INTEGER DEFAULT 0', (e) => {
    if (e && !/duplicate column/i.test(e.message)) console.error('Migration error:', e);
    else console.log('Soft-delete column ready');
  });
});

module.exports = db;