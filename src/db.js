export async function initDatabase(db) {
  try {
    // 新结构：mailboxes（地址历史） + messages（邮件）
    await db.exec(`PRAGMA foreign_keys = ON;`);
    await db.exec("CREATE TABLE IF NOT EXISTS mailboxes (id INTEGER PRIMARY KEY AUTOINCREMENT, address TEXT NOT NULL UNIQUE, local_part TEXT NOT NULL, domain TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, last_accessed_at TEXT, expires_at TEXT);");
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_mailboxes_address ON mailboxes(address);`);

    await db.exec("CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, mailbox_id INTEGER NOT NULL, sender TEXT NOT NULL, subject TEXT NOT NULL, content TEXT NOT NULL, html_content TEXT, received_at TEXT DEFAULT CURRENT_TIMESTAMP, is_read INTEGER DEFAULT 0, FOREIGN KEY(mailbox_id) REFERENCES mailboxes(id));");
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_mailbox_id ON messages(mailbox_id);`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_received_at ON messages(received_at DESC);`);

    // 兼容迁移：若存在旧表 emails 且新表 messages 为空，则尝试迁移数据
    const legacy = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='emails'").all();
    const mc = await db.prepare('SELECT COUNT(1) as c FROM messages').all();
    const msgCount = Array.isArray(mc?.results) && mc.results.length ? mc.results[0].c : 0;
    if (Array.isArray(legacy?.results) && legacy.results.length > 0 && msgCount === 0) {
      const res = await db.prepare('SELECT * FROM emails').all();
      const rows = res?.results || [];
      if (rows && rows.length) {
        for (const r of rows) {
          const mailboxId = await getOrCreateMailboxId(db, r.mailbox);
          await db.prepare(`INSERT INTO messages (mailbox_id, sender, subject, content, html_content, received_at, is_read)
            VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .bind(mailboxId, r.sender, r.subject, r.content, r.html_content || null, r.received_at || null, r.is_read || 0)
            .run();
        }
      }
    }
  } catch (error) {
    console.error('数据库初始化失败:', error);
  }
}

export async function getOrCreateMailboxId(db, address) {
  const normalized = String(address || '').trim().toLowerCase();
  if (!normalized) throw new Error('无效的邮箱地址');
  let local_part = '';
  let domain = '';
  const at = normalized.indexOf('@');
  if (at > 0 && at < normalized.length - 1) {
    local_part = normalized.slice(0, at);
    domain = normalized.slice(at + 1);
  }
  if (!local_part || !domain) throw new Error('无效的邮箱地址');
  const existing = await db.prepare('SELECT id FROM mailboxes WHERE address = ?').bind(normalized).all();
  if (existing.results && existing.results.length > 0) {
    const id = existing.results[0].id;
    await db.prepare('UPDATE mailboxes SET last_accessed_at = CURRENT_TIMESTAMP WHERE id = ?').bind(id).run();
    return id;
  }
  const res = await db.prepare(
    'INSERT INTO mailboxes (address, local_part, domain, last_accessed_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)'
  ).bind(normalized, local_part, domain).run();
  // D1 返回对象不一定带 last_insert_rowid，可再查一次
  const created = await db.prepare('SELECT id FROM mailboxes WHERE address = ?').bind(normalized).all();
  return created.results[0].id;
}

export async function getMailboxIdByAddress(db, address) {
  const normalized = String(address || '').trim().toLowerCase();
  if (!normalized) return null;
  const res = await db.prepare('SELECT id FROM mailboxes WHERE address = ?').bind(normalized).all();
  return (res.results && res.results.length) ? res.results[0].id : null;
}

