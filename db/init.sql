CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'executor'
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  assignee_id INTEGER,
  creator_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (assignee_id) REFERENCES users(id),
  FOREIGN KEY (creator_id) REFERENCES users(id)
);

INSERT OR IGNORE INTO users (username, password_hash, role) VALUES ('admin', '$2b$10$XQ5Z5Z5Z5Z5Z5Z5Z5Z5Z5O', 'admin');