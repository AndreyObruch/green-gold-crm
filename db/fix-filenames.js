const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'crm.db');
const db = new sqlite3.Database(dbPath);
db.configure('busyTimeout', 5000);

function repair(name) {
  if (!name) return name;
  for (let i = 0; i < name.length; i++) {
    if (name.charCodeAt(i) > 0xFF) return name; // already real Unicode -> leave
  }
  let dec;
  try { dec = Buffer.from(name, 'latin1').toString('utf8'); } catch (e) { return name; }
  if (dec.indexOf('\uFFFD') !== -1) return name; // invalid utf8 -> not our mojibake
  if (dec === name) return name; // ascii identity -> no change
  return dec;
}

db.all('SELECT id, original_name FROM files', [], (err, rows) => {
  if (err) { console.error('READ ERROR:', err.message); db.close(); return; }
  const fixes = [];
  (rows || []).forEach(r => {
    const fixed = repair(r.original_name);
    if (fixed !== r.original_name) fixes.push({ id: r.id, old: r.original_name, neu: fixed });
  });
  console.log('Scanned: ' + (rows ? rows.length : 0) + ' rows. To fix: ' + fixes.length);
  if (fixes.length === 0) { console.log('Nothing to repair.'); db.close(); return; }
  db.serialize(() => {
    db.run('BEGIN');
    const stmt = db.prepare('UPDATE files SET original_name = ? WHERE id = ?');
    fixes.forEach(f => { stmt.run(f.neu, f.id); console.log('FIXED #' + f.id + ' -> ' + f.neu); });
    stmt.finalize((e) => {
      if (e) { console.error('STMT ERROR:', e.message); db.run('ROLLBACK'); db.close(); return; }
      db.run('COMMIT', (e2) => {
        if (e2) { console.error('COMMIT ERROR:', e2.message); db.run('ROLLBACK'); }
        else console.log('Committed ' + fixes.length + ' fixes.');
        db.close();
      });
    });
  });
});