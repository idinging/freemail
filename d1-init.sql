-- Cloudflare D1 数据库初始化脚本
-- 首次部署时执行：wrangler d1 execute DB --file=./d1-init.sql

-- 启用外键约束
PRAGMA foreign_keys = ON;

-- 邮箱地址表
CREATE TABLE IF NOT EXISTS mailboxes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address TEXT NOT NULL UNIQUE,
  local_part TEXT NOT NULL,
  domain TEXT NOT NULL,
  password_hash TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  last_accessed_at TEXT,
  expires_at TEXT,
  is_pinned INTEGER DEFAULT 0,
  can_login INTEGER DEFAULT 0
);

-- 邮件消息表
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mailbox_id INTEGER NOT NULL,
  sender TEXT NOT NULL,
  to_addrs TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL,
  verification_code TEXT,
  preview TEXT,
  r2_bucket TEXT NOT NULL DEFAULT 'mail-eml',
  r2_object_key TEXT NOT NULL DEFAULT '',
  received_at TEXT DEFAULT CURRENT_TIMESTAMP,
  is_read INTEGER DEFAULT 0,
  FOREIGN KEY(mailbox_id) REFERENCES mailboxes(id)
);

-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  can_send INTEGER NOT NULL DEFAULT 0,
  mailbox_limit INTEGER NOT NULL DEFAULT 10,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 用户-邮箱关联表
CREATE TABLE IF NOT EXISTS user_mailboxes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  mailbox_id INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, mailbox_id),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(mailbox_id) REFERENCES mailboxes(id) ON DELETE CASCADE
);

-- 发送邮件记录表
CREATE TABLE IF NOT EXISTS sent_emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  resend_id TEXT,
  from_name TEXT,
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

-- 创建索引

-- mailboxes 索引
CREATE INDEX IF NOT EXISTS idx_mailboxes_address ON mailboxes(address);
CREATE INDEX IF NOT EXISTS idx_mailboxes_is_pinned ON mailboxes(is_pinned DESC);
CREATE INDEX IF NOT EXISTS idx_mailboxes_address_created ON mailboxes(address, created_at DESC);

-- messages 索引
CREATE INDEX IF NOT EXISTS idx_messages_mailbox_id ON messages(mailbox_id);
CREATE INDEX IF NOT EXISTS idx_messages_received_at ON messages(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_r2_object_key ON messages(r2_object_key);
CREATE INDEX IF NOT EXISTS idx_messages_mailbox_received ON messages(mailbox_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_mailbox_received_read ON messages(mailbox_id, received_at DESC, is_read);

-- users 索引
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- user_mailboxes 索引
CREATE INDEX IF NOT EXISTS idx_user_mailboxes_user ON user_mailboxes(user_id);
CREATE INDEX IF NOT EXISTS idx_user_mailboxes_mailbox ON user_mailboxes(mailbox_id);
CREATE INDEX IF NOT EXISTS idx_user_mailboxes_user_pinned ON user_mailboxes(user_id, is_pinned DESC);
CREATE INDEX IF NOT EXISTS idx_user_mailboxes_composite ON user_mailboxes(user_id, mailbox_id, is_pinned);

-- sent_emails 索引
CREATE INDEX IF NOT EXISTS idx_sent_emails_resend_id ON sent_emails(resend_id);
CREATE INDEX IF NOT EXISTS idx_sent_emails_status_created ON sent_emails(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sent_emails_from_addr ON sent_emails(from_addr);

