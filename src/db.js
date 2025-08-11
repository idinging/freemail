export async function initDatabase(db) {
  try {
    // 新结构：mailboxes（地址历史） + messages（邮件）
    await db.exec(`PRAGMA foreign_keys = ON;`);
    await db.exec("CREATE TABLE IF NOT EXISTS mailboxes (id INTEGER PRIMARY KEY AUTOINCREMENT, address TEXT NOT NULL UNIQUE, local_part TEXT NOT NULL, domain TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, last_accessed_at TEXT, expires_at TEXT, is_pinned INTEGER DEFAULT 0);");
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_mailboxes_address ON mailboxes(address);`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_mailboxes_is_pinned ON mailboxes(is_pinned DESC);`);

    await db.exec("CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, mailbox_id INTEGER NOT NULL, sender TEXT NOT NULL, subject TEXT NOT NULL, content TEXT NOT NULL, html_content TEXT, received_at TEXT DEFAULT CURRENT_TIMESTAMP, is_read INTEGER DEFAULT 0, FOREIGN KEY(mailbox_id) REFERENCES mailboxes(id));");
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_mailbox_id ON messages(mailbox_id);`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_received_at ON messages(received_at DESC);`);

    // 发送记录表：用于记录通过 Resend 发出的邮件与状态
    await ensureSentEmailsTable(db);

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

    // 迁移：为现有邮箱添加 is_pinned 字段
    try {
      const res = await db.prepare("PRAGMA table_info(mailboxes)").all();
      const cols = (res?.results || []).map(r => (r.name || r?.['name']));
      if (!cols.includes('is_pinned')){
        await db.exec('ALTER TABLE mailboxes ADD COLUMN is_pinned INTEGER DEFAULT 0');
        await db.exec('CREATE INDEX IF NOT EXISTS idx_mailboxes_is_pinned ON mailboxes(is_pinned DESC)');
      }
    } catch (_) {}
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

export async function toggleMailboxPin(db, address) {
  const normalized = String(address || '').trim().toLowerCase();
  if (!normalized) throw new Error('无效的邮箱地址');
  
  const existing = await db.prepare('SELECT id, is_pinned FROM mailboxes WHERE address = ?').bind(normalized).all();
  if (!existing.results || existing.results.length === 0) {
    throw new Error('邮箱不存在');
  }
  
  const currentPin = existing.results[0].is_pinned;
  const newPin = currentPin ? 0 : 1;
  
  await db.prepare('UPDATE mailboxes SET is_pinned = ? WHERE address = ?').bind(newPin, normalized).run();
  
  return { is_pinned: newPin };
}

export async function recordSentEmail(db, { resendId, fromName, from, to, subject, html, text, status = 'queued', scheduledAt = null }){
  const toAddrs = Array.isArray(to) ? to.join(',') : String(to || '');
  try{
    await db.prepare(`
      INSERT INTO sent_emails (resend_id, from_name, from_addr, to_addrs, subject, html_content, text_content, status, scheduled_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(resendId || null, fromName || null, from, toAddrs, subject, html || null, text || null, status, scheduledAt || null).run();
  } catch (e) {
    // 如果表不存在，尝试即时创建并重试一次
    if ((e?.message || '').toLowerCase().includes('no such table: sent_emails')){
      try { await ensureSentEmailsTable(db); } catch(_){}
      await db.prepare(`
        INSERT INTO sent_emails (resend_id, from_name, from_addr, to_addrs, subject, html_content, text_content, status, scheduled_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(resendId || null, fromName || null, from, toAddrs, subject, html || null, text || null, status, scheduledAt || null).run();
      return;
    }
    throw e;
  }
}

export async function updateSentEmail(db, resendId, fields){
  if (!resendId) return;
  const allowed = ['status', 'scheduled_at'];
  const setClauses = [];
  const values = [];
  for (const key of allowed){
    if (key in (fields || {})){
      setClauses.push(`${key} = ?`);
      values.push(fields[key]);
    }
  }
  if (!setClauses.length) return;
  setClauses.push('updated_at = CURRENT_TIMESTAMP');
  const sql = `UPDATE sent_emails SET ${setClauses.join(', ')} WHERE resend_id = ?`;
  values.push(resendId);
  await db.prepare(sql).bind(...values).run();
}

export async function ensureSentEmailsTable(db){
  const createSql = 'CREATE TABLE IF NOT EXISTS sent_emails (' +
    'id INTEGER PRIMARY KEY AUTOINCREMENT,' +
    'resend_id TEXT,' +
    'from_name TEXT,' +
    'from_addr TEXT NOT NULL,' +
    'to_addrs TEXT NOT NULL,' +
    'subject TEXT NOT NULL,' +
    'html_content TEXT,' +
    'text_content TEXT,' +
    "status TEXT DEFAULT 'queued'," +
    'scheduled_at TEXT,' +
    'created_at TEXT DEFAULT CURRENT_TIMESTAMP,' +
    'updated_at TEXT DEFAULT CURRENT_TIMESTAMP' +
  ')';
  await db.exec(createSql);
  await db.exec('CREATE INDEX IF NOT EXISTS idx_sent_emails_resend_id ON sent_emails(resend_id)');
  // 迁移：若缺少 from_name 列，尝试增加
  try {
    const res = await db.prepare("PRAGMA table_info(sent_emails)").all();
    const cols = (res?.results || []).map(r => (r.name || r?.['name']));
    if (!cols.includes('from_name')){
      await db.exec('ALTER TABLE sent_emails ADD COLUMN from_name TEXT');
    }
  } catch (_) {}
}

