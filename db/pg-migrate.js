const { pool } = require('./pg-db');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Starting migration to PostgreSQL...');

    // Users
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) CHECK (role IN ('admin', 'executor')) DEFAULT 'executor',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Tasks
    await client.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        status VARCHAR(20) CHECK (status IN ('new', 'in_progress', 'done')) DEFAULT 'new',
        creator_id INTEGER REFERENCES users(id),
        deleted BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Task Assignees (Many-to-Many)
    await client.query(`
      CREATE TABLE IF NOT EXISTS task_assignees (
        task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        assigned_by INTEGER REFERENCES users(id),
        assigned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (task_id, user_id)
      );
    `);

    // Messages
    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id),
        body TEXT,
        legacy_file_id INTEGER, -- Keep for compatibility if needed, otherwise remove later
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Files Metadata
    await client.query(`
      CREATE TABLE IF NOT EXISTS files (
        id SERIAL PRIMARY KEY,
        task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
        uploader_id INTEGER REFERENCES users(id),
        original_name TEXT NOT NULL,
        stored_name TEXT NOT NULL,
        size BIGINT NOT NULL,
        mime VARCHAR(100),
        sha256 VARCHAR(64),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Message-File Link
    await client.query(`
      CREATE TABLE IF NOT EXISTS message_files (
        message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
        file_id INTEGER REFERENCES files(id) ON DELETE CASCADE,
        PRIMARY KEY (message_id, file_id)
      );
    `);

    // Audit Log
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        action VARCHAR(50) NOT NULL,
        entity VARCHAR(50) NOT NULL,
        entity_id INTEGER,
        detail TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('Migration completed successfully.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();