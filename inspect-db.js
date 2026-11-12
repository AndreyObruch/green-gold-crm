const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'db', 'crm.db');
const arg = process.argv[2];
const limitArg = parseInt(process.argv[3], 10);
const limit = Number.isFinite(limitArg) ? Math.min(Math.max(limitArg, 1), 500) : 50;

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function quoteIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

async function listTables() {
  return all(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );
}

async function printCounts(tables) {
  for (const row of tables) {
    const name = row.name;
    const countRows = await all('SELECT COUNT(*) AS count FROM ' + quoteIdent(name));
    console.log(name + '=' + (countRows[0] ? countRows[0].count : 0));
  }
}

async function printTable(name) {
  const tables = await listTables();
  const found = tables.find(t => String(t.name).toLowerCase() === String(name).toLowerCase());

  if (!found) {
    throw new Error('Table not found: ' + name);
  }

  const safeName = quoteIdent(found.name);

  const cols = await all('PRAGMA table_info(' + safeName + ')');
  console.log('columns:');
  cols.forEach(c => {
    console.log(c.name + ' ' + c.type);
  });

  const rows = await all(
    'SELECT * FROM ' + safeName + ' ORDER BY rowid LIMIT ?',
    [limit]
  );

  console.log('rows:');
  console.log(JSON.stringify(rows, null, 2));
}

async function main() {
  try {
    if (!arg) {
      const tables = await listTables();
      await printCounts(tables);
      console.log('usage: node inspect-db.js <table> [limit]');
    } else {
      await printTable(arg);
    }
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

main();