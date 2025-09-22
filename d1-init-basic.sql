-- Cloudflare D1 初始化脚本（不包含旧表迁移）

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS mailboxes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address TEXT NOT NULL UNIQUE,
  local_part TEXT NOT NULL,
  domain TEXT NOT NULL,
  password_hash TEXT,
  can_login INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  last_accessed_at TEXT,
  expires_at TEXT,
  is_pinned INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_mailboxes_address ON mailboxes(address);
CREATE INDEX IF NOT EXISTS idx_mailboxes_is_pinned ON mailboxes(is_pinned DESC);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mailbox_id INTEGER NOT NULL,
  sender TEXT NOT NULL,
  to_addrs TEXT NOT NULL,
  subject TEXT NOT NULL,
  verification_code TEXT,
  preview TEXT,
  r2_bucket TEXT NOT NULL DEFAULT 'mail-eml',
  r2_object_key TEXT NOT NULL,
  received_at TEXT DEFAULT CURRENT_TIMESTAMP,
  is_read INTEGER DEFAULT 0,
  FOREIGN KEY(mailbox_id) REFERENCES mailboxes(id)
);

CREATE INDEX IF NOT EXISTS idx_messages_mailbox_id ON messages(mailbox_id);
CREATE INDEX IF NOT EXISTS idx_messages_received_at ON messages(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_r2_object_key ON messages(r2_object_key);

-- 发送记录表：sent_emails
CREATE TABLE IF NOT EXISTS sent_emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  resend_id TEXT,
  from_addr TEXT NOT NULL,
  to_addrs TEXT NOT NULL,
  subject TEXT NOT NULL,
  verification_code TEXT,
  preview TEXT,
  r2_bucket TEXT NOT NULL DEFAULT 'mail-eml',
  r2_object_key TEXT,
  html_content TEXT,
  text_content TEXT,
  status TEXT DEFAULT 'queued',
  scheduled_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sent_emails_resend_id ON sent_emails(resend_id);
CREATE INDEX IF NOT EXISTS idx_sent_emails_r2_object_key ON sent_emails(r2_object_key);


-- 用户与授权表
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  can_send INTEGER NOT NULL DEFAULT 0,
  mailbox_limit INTEGER NOT NULL DEFAULT 10,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

CREATE TABLE IF NOT EXISTS user_mailboxes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  mailbox_id INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, mailbox_id),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(mailbox_id) REFERENCES mailboxes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_user_mailboxes_user ON user_mailboxes(user_id);
CREATE INDEX IF NOT EXISTS idx_user_mailboxes_mailbox ON user_mailboxes(mailbox_id);
