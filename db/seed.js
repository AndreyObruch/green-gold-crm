const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'crm.db');
const initSql = fs.readFileSync(path.join(__dirname, 'init.sql'), 'utf8');
const sdb = new sqlite3.Database(dbPath);

function run(sql, params) {
  return new Promise((res, rej) => {
    sdb.run(sql, params, function (e) { if (e) rej(e); else res(this); });
  });
}
function all(sql, params) {
  return new Promise((res, rej) => {
    sdb.all(sql, params, (e, r) => { if (e) rej(e); else res(r); });
  });
}
function execSql(sql) {
  return new Promise((res, rej) => { sdb.exec(sql, (e) => { if (e) rej(e); else res(); }); });
}

const USERS = [
  { username: '\u0410\u043d\u0434\u0440\u0435\u0439', password: '1111', role: 'admin' },
  { username: '\u0412\u044f\u0447\u0435\u0441\u043b\u0430\u0432', password: '2222', role: 'admin' },
  { username: '\u041c\u0430\u0442\u0432\u0435\u0439', password: '3333', role: 'executor' },
  { username: '\u0410\u043b\u0435\u0441\u044f', password: '4444', role: 'executor' }
];

const TASKS = [
  { title: '\u041e\u0442\u0447\u0451\u0442', assignee: '\u041c\u0430\u0442\u0432\u0435\u0439', creator: '\u0410\u043d\u0434\u0440\u0435\u0439', status: 'new' },
  { title: '\u0421\u043a\u043b\u0430\u0434', assignee: '\u0410\u043b\u0435\u0441\u044f', creator: '\u0410\u043d\u0434\u0440\u0435\u0439', status: 'in_progress' },
  { title: '\u0417\u0432\u043e\u043d\u043e\u043a', assignee: '\u041c\u0430\u0442\u0432\u0435\u0439', creator: '\u0412\u044f\u0447\u0435\u0441\u043b\u0430\u0432', status: 'done' }
];

async function main() {
  await execSql(initSql);
  await run('ALTER TABLE tasks ADD COLUMN deleted INTEGER DEFAULT 0', []).catch((e) => {
    if (!/duplicate column/i.test(e.message)) throw e;
  });
  await run('CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, username TEXT, action TEXT, entity TEXT, entity_id INTEGER, detail TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)', []);
  await run('DELETE FROM audit_log', []);
  await run('DELETE FROM tasks', []);
  await run('DELETE FROM users', []);
  await run("DELETE FROM sqlite_sequence WHERE name IN ('users','tasks','audit_log')", []).catch(() => {});

  const ids = {};
  for (const u of USERS) {
    const hash = await bcrypt.hash(u.password, 10);
    const r = await run('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', [u.username, hash, u.role]);
    ids[u.username] = r.lastID;
  }
  for (const t of TASKS) {
    await run('INSERT INTO tasks (title, description, assignee_id, creator_id, status, deleted) VALUES (?, ?, ?, ?, ?, ?)',
      [t.title, null, ids[t.assignee], ids[t.creator], t.status, 0]);
  }

  const rows = await all('SELECT id, username, role FROM users ORDER BY id', []);
  console.log('SEED OK');
  console.table(rows);
  sdb.close();
  process.exit(0);
}

main().catch((e) => { console.error('SEED FAIL:', e.message); sdb.close(); process.exit(1); });