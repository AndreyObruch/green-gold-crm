const bcrypt = require('bcryptjs');
const { pool } = require('./pg-db');

async function seed() {
  const client = await pool.connect();
  try {
    console.log('Seeding PostgreSQL...');

    // Clear existing data (be careful in production)
    await client.query('TRUNCATE audit_log, message_files, files, messages, task_assignees, tasks, users RESTART IDENTITY CASCADE;');

    // Insert Users
    const saltRounds = 10;
    const users = [
      { username: 'Andrey', password: '1111', role: 'admin' },
      { username: 'Vyacheslav', password: '2222', role: 'admin' },
      { username: 'Matvey', password: '3333', role: 'executor' },
      { username: 'Alesya', password: '4444', role: 'executor' }
    ];

    for (const user of users) {
      const hash = await bcrypt.hash(user.password, saltRounds);
      await client.query(
        'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)',
        [user.username, hash, user.role]
      );
    }

    // Get IDs
    const andreyId = (await client.query("SELECT id FROM users WHERE username='Andrey'")).rows[0].id;
    const matveyId = (await client.query("SELECT id FROM users WHERE username='Matvey'")).rows[0].id;
    const alesyaId = (await client.query("SELECT id FROM users WHERE username='Alesya'")).rows[0].id;

    // Insert Tasks
    const tasks = [
      { title: 'Updated probe', description: 'New description', status: 'in_progress', creator_id: andreyId, assignees: [matveyId] },
      { title: 'Warehouse', description: null, status: 'in_progress', creator_id: andreyId, assignees: [alesyaId] },
      { title: 'Call', description: null, status: 'in_progress', creator_id: 2, assignees: [matveyId], deleted: true },
      { title: 'Access to constructor.', description: 'Send Andrey access to Green Gold constructor', status: 'in_progress', creator_id: andreyId, assignees: [] }, // Assignee handled via UI usually, but seeding empty for now or specific logic needed
      { title: 'Test task', description: 'something like that', status: 'new', creator_id: andreyId, assignees: [matveyId, alesyaId] }
    ];

    for (const task of tasks) {
      const res = await client.query(
        'INSERT INTO tasks (title, description, status, creator_id, deleted) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [task.title, task.description, task.status, task.creator_id, task.deleted || false]
      );
      const taskId = res.rows[0].id;

      for (const userId of task.assignees) {
        await client.query(
          'INSERT INTO task_assignees (task_id, user_id, assigned_by) VALUES ($1, $2, $3)',
          [taskId, userId, task.creator_id]
        );
      }
    }

    console.log('Seed completed successfully.');
  } catch (err) {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();