const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // Amvera PostgreSQL URL
  ssl: { rejectUnauthorized: false } // Требуется для многих хостингов, включая Amvera
});

// Helper to execute queries with logging for debugging
async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('Executed query', { text, duration, rows: res.rowCount });
    return res;
  } catch (err) {
    console.error('Query error:', err.message, { stack: err.stack });
    throw err;
  }
}

module.exports = {
  pool,
  query
};