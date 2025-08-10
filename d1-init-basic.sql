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

-- 发送记录表：sent_emails
CREATE TABLE IF NOT EXISTS sent_emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  resend_id TEXT,
  from_addr TEXT NOT NULL,
  to_addrs TEXT NOT NULL,
  subject TEXT NOT NULL,
  html_content TEXT,
  text_content TEXT,
  status TEXT DEFAULT 'queued',
  scheduled_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sent_emails_resend_id ON sent_emails(resend_id);

