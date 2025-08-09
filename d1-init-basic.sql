-- Cloudflare D1 初始化脚本（不包含旧表迁移）

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS mailboxes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address TEXT NOT NULL UNIQUE,
  local_part TEXT NOT NULL,
  domain TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  last_accessed_at TEXT,
  expires_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_mailboxes_address ON mailboxes(address);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mailbox_id INTEGER NOT NULL,
  sender TEXT NOT NULL,
  subject TEXT NOT NULL,
  content TEXT NOT NULL,
  html_content TEXT,
  received_at TEXT DEFAULT CURRENT_TIMESTAMP,
  is_read INTEGER DEFAULT 0,
  FOREIGN KEY(mailbox_id) REFERENCES mailboxes(id)
);

CREATE INDEX IF NOT EXISTS idx_messages_mailbox_id ON messages(mailbox_id);
CREATE INDEX IF NOT EXISTS idx_messages_received_at ON messages(received_at DESC);

