const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'db', 'crm.db');
const outDir = path.join(__dirname, 'exports');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function csvValue(value) {
  if (value === null || value === undefined) return '';

  let s;
  if (typeof value === 'object') {
    s = JSON.stringify(value);
  } else {
    s = String(value);
  }

  if (/[",\r\n]/.test(s) || s !== s.trim()) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }

  return s;
}

function toCsv(rows, columns) {
  const lines = [columns.map(csvValue).join(',')];

  for (const row of rows) {
    lines.push(columns.map(column => csvValue(row[column])).join(','));
  }

  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

function quoteIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

async function writeCsv(fileName, rows, columns) {
  const filePath = path.join(outDir, fileName + '.csv');
  fs.writeFileSync(filePath, toCsv(rows, columns), 'utf8');
  return filePath;
}

async function getTableColumns(tableName) {
  const info = await all('PRAGMA table_info(' + quoteIdent(tableName) + ')');
  return info.map(item => item.name);
}

async function exportTable(tableName) {
  const columns = await getTableColumns(tableName);
  const rows = await all('SELECT * FROM ' + quoteIdent(tableName) + ' ORDER BY rowid');
  return writeCsv(tableName, rows, columns);
}

async function exportSummary() {
  const sql =
    'SELECT ' +
    't.id AS id, ' +
    't.title AS title, ' +
    't.description AS description, ' +
    't.status AS status, ' +
    't.deleted AS deleted, ' +
    'cu.username AS creator_username, ' +
    '(' +
      'SELECT group_concat(u.username, ", ") ' +
      'FROM task_assignees ta ' +
      'JOIN users u ON u.id = ta.user_id ' +
      'WHERE ta.task_id = t.id ' +
      'ORDER BY u.username' +
    ') AS assignee_usernames, ' +
    '(' +
      'SELECT COUNT(*) FROM messages m WHERE m.task_id = t.id' +
    ') AS messages_count, ' +
    '(' +
      'SELECT COUNT(*) FROM files f WHERE f.task_id = t.id' +
    ') AS files_count ' +
    'FROM tasks t ' +
    'LEFT JOIN users cu ON cu.id = t.creator_id ' +
    'ORDER BY t.id';

  const rows = await all(sql);
  const columns = [
    'id',
    'title',
    'description',
    'status',
    'deleted',
    'creator_username',
    'assignee_usernames',
    'messages_count',
    'files_count'
  ];

  return writeCsv('tasks_summary', rows, columns);
}

async function main() {
  const tables = [
    'users',
    'tasks',
    'task_assignees',
    'messages',
    'message_files',
    'files',
    'audit_log'
  ];

  const written = [];

  for (const table of tables) {
    try {
      written.push(await exportTable(table));
    } catch (e) {
      console.error('Skip table ' + table + ': ' + e.message);
    }
  }

  try {
    written.push(await exportSummary());
  } catch (e) {
    console.error('Skip summary: ' + e.message);
  }

  console.log('CSV files exported to: ' + outDir);
  written.forEach(file => console.log(file));

  db.close();
}

main().catch(e => {
  console.error(e.message);
  db.close();
  process.exitCode = 1;
});