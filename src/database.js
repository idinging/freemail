/**
 * 初始化数据库，创建必要的表和索引
 * @param {object} db - 数据库连接对象
 * @returns {Promise<void>} 初始化完成后无返回值
 */
export async function initDatabase(db) {
  try {
    // 新结构：mailboxes（地址历史） + messages（邮件）
    await db.exec(`PRAGMA foreign_keys = ON;`);
    await db.exec("CREATE TABLE IF NOT EXISTS mailboxes (id INTEGER PRIMARY KEY AUTOINCREMENT, address TEXT NOT NULL UNIQUE, local_part TEXT NOT NULL, domain TEXT NOT NULL, password_hash TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, last_accessed_at TEXT, expires_at TEXT, is_pinned INTEGER DEFAULT 0);");
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_mailboxes_address ON mailboxes(address);`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_mailboxes_is_pinned ON mailboxes(is_pinned DESC);`);
    // 复合索引：按地址 + 创建时间，优化历史邮箱倒序
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_mailboxes_address_created ON mailboxes(address, created_at DESC);`);

    await db.exec("CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, mailbox_id INTEGER NOT NULL, sender TEXT NOT NULL, to_addrs TEXT NOT NULL, subject TEXT NOT NULL, verification_code TEXT, preview TEXT, r2_bucket TEXT NOT NULL DEFAULT 'mail-eml', r2_object_key TEXT NOT NULL, received_at TEXT DEFAULT CURRENT_TIMESTAMP, is_read INTEGER DEFAULT 0, FOREIGN KEY(mailbox_id) REFERENCES mailboxes(id));");
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_mailbox_id ON messages(mailbox_id);`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_received_at ON messages(received_at DESC);`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_r2_object_key ON messages(r2_object_key);`);
    // 复合索引：常见筛选路径
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_mailbox_received ON messages(mailbox_id, received_at DESC);`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_mailbox_received_read ON messages(mailbox_id, received_at DESC, is_read);`);

    // 用户与授权关系表
    await ensureUsersTables(db);

    // 发送记录表：用于记录通过 Resend 发出的邮件与状态
    await ensureSentEmailsTable(db);

    // 兼容迁移：若存在旧表 emails 且新表 messages 为空，则尝试迁移数据（不回填 R2，仅生成 preview）
    const legacy = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='emails'").all();
    const mc = await db.prepare('SELECT COUNT(1) as c FROM messages').all();
    const msgCount = Array.isArray(mc?.results) && mc.results.length ? mc.results[0].c : 0;
    if (Array.isArray(legacy?.results) && legacy.results.length > 0 && msgCount === 0) {
      const res = await db.prepare('SELECT * FROM emails').all();
      const rows = res?.results || [];
      if (rows && rows.length) {
        for (const r of rows) {
          const mailboxId = await getOrCreateMailboxId(db, r.mailbox);
          const preview = (r.content && String(r.content).trim())
            ? String(r.content).slice(0, 120)
            : String(r.html_content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 120);
          await db.prepare(`INSERT INTO messages (mailbox_id, sender, to_addrs, subject, verification_code, preview, r2_bucket, r2_object_key, received_at, is_read)
            VALUES (?, ?, '', ?, NULL, ?, 'mail-eml', '', ?, ?)`)
            .bind(mailboxId, r.sender, r.subject, preview || '', r.received_at || null, r.is_read || 0)
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

    // 迁移：为现有邮箱添加 password_hash 字段
    try {
      const res = await db.prepare("PRAGMA table_info(mailboxes)").all();
      const cols = (res?.results || []).map(r => (r.name || r?.['name']));
      if (!cols.includes('password_hash')){
        await db.exec('ALTER TABLE mailboxes ADD COLUMN password_hash TEXT');
      }
    } catch (_) {}

    // 迁移：为现有邮箱添加 can_login 字段
    try {
      const res = await db.prepare("PRAGMA table_info(mailboxes)").all();
      const cols = (res?.results || []).map(r => (r.name || r?.['name']));
      if (!cols.includes('can_login')){
        await db.exec('ALTER TABLE mailboxes ADD COLUMN can_login INTEGER DEFAULT 0');
      }
    } catch (_) {}

    // 迁移：messages 缺失新列时追加
    try {
      const info = await db.prepare("PRAGMA table_info(messages)").all();
      const cols = (info?.results || []).map(r => (r.name || r?.['name']));
      if (!cols.includes('to_addrs')) await db.exec("ALTER TABLE messages ADD COLUMN to_addrs TEXT NOT NULL DEFAULT ''");
      if (!cols.includes('verification_code')) await db.exec("ALTER TABLE messages ADD COLUMN verification_code TEXT");
      if (!cols.includes('preview')) await db.exec("ALTER TABLE messages ADD COLUMN preview TEXT");
      if (!cols.includes('r2_bucket')) await db.exec("ALTER TABLE messages ADD COLUMN r2_bucket TEXT NOT NULL DEFAULT 'mail-eml'");
      if (!cols.includes('r2_object_key')) await db.exec("ALTER TABLE messages ADD COLUMN r2_object_key TEXT NOT NULL DEFAULT ''");
      await db.exec('CREATE INDEX IF NOT EXISTS idx_messages_r2_object_key ON messages(r2_object_key)');
    } catch (_) {}
  } catch (error) {
    console.error('数据库初始化失败:', error);
  }
}

/**
 * 获取或创建邮箱ID，如果邮箱不存在则自动创建
 * @param {object} db - 数据库连接对象
 * @param {string} address - 邮箱地址
 * @returns {Promise<number>} 邮箱ID
 * @throws {Error} 当邮箱地址无效时抛出异常
 */
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
    'INSERT INTO mailboxes (address, local_part, domain, password_hash, last_accessed_at) VALUES (?, ?, ?, NULL, CURRENT_TIMESTAMP)'
  ).bind(normalized, local_part, domain).run();
  // D1 返回对象不一定带 last_insert_rowid，可再查一次
  const created = await db.prepare('SELECT id FROM mailboxes WHERE address = ?').bind(normalized).all();
  return created.results[0].id;
}

/**
 * 根据邮箱地址获取邮箱ID
 * @param {object} db - 数据库连接对象
 * @param {string} address - 邮箱地址
 * @returns {Promise<number|null>} 邮箱ID，如果不存在返回null
 */
export async function getMailboxIdByAddress(db, address) {
  const normalized = String(address || '').trim().toLowerCase();
  if (!normalized) return null;
  const res = await db.prepare('SELECT id FROM mailboxes WHERE address = ?').bind(normalized).all();
  return (res.results && res.results.length) ? res.results[0].id : null;
}

/**
 * 切换邮箱的置顶状态
 * @param {object} db - 数据库连接对象
 * @param {string} address - 邮箱地址
 * @param {number} userId - 用户ID
 * @returns {Promise<object>} 包含is_pinned状态的对象
 * @throws {Error} 当邮箱地址无效、用户未登录或邮箱不存在时抛出异常
 */
export async function toggleMailboxPin(db, address, userId) {
  const normalized = String(address || '').trim().toLowerCase();
  if (!normalized) throw new Error('无效的邮箱地址');
  const uid = Number(userId || 0);
  if (!uid) throw new Error('未登录');

  // 获取邮箱 ID
  const mbRes = await db.prepare('SELECT id FROM mailboxes WHERE address = ?').bind(normalized).all();
  if (!mbRes.results || mbRes.results.length === 0){
    throw new Error('邮箱不存在');
  }
  const mailboxId = mbRes.results[0].id;

  // 检查该邮箱是否属于该用户
  const umRes = await db.prepare('SELECT id, is_pinned FROM user_mailboxes WHERE user_id = ? AND mailbox_id = ?')
    .bind(uid, mailboxId).all();
  if (!umRes.results || umRes.results.length === 0){
    // 若尚未存在关联记录（例如严格管理员未分配该邮箱），则创建一条仅用于个人置顶的关联
    await db.prepare('INSERT INTO user_mailboxes (user_id, mailbox_id, is_pinned) VALUES (?, ?, 1)')
      .bind(uid, mailboxId).run();
    return { is_pinned: 1 };
  }

  const currentPin = umRes.results[0].is_pinned ? 1 : 0;
  const newPin = currentPin ? 0 : 1;
  await db.prepare('UPDATE user_mailboxes SET is_pinned = ? WHERE user_id = ? AND mailbox_id = ?')
    .bind(newPin, uid, mailboxId).run();
  return { is_pinned: newPin };
}

/**
 * 记录发送的邮件信息到数据库
 * @param {object} db - 数据库连接对象
 * @param {object} params - 邮件参数对象
 * @param {string} params.resendId - Resend服务的邮件ID
 * @param {string} params.fromName - 发件人姓名
 * @param {string} params.from - 发件人邮箱地址
 * @param {string|Array<string>} params.to - 收件人邮箱地址
 * @param {string} params.subject - 邮件主题
 * @param {string} params.html - HTML内容
 * @param {string} params.text - 纯文本内容
 * @param {string} params.status - 邮件状态，默认为'queued'
 * @param {string} params.scheduledAt - 计划发送时间，默认为null
 * @returns {Promise<void>} 记录完成后无返回值
 */
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

/**
 * 更新已发送邮件的状态信息
 * @param {object} db - 数据库连接对象
 * @param {string} resendId - Resend服务的邮件ID
 * @param {object} fields - 需要更新的字段对象
 * @returns {Promise<void>} 更新完成后无返回值
 */
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

/**
 * 确保发送邮件表存在，如果不存在则创建
 * @param {object} db - 数据库连接对象
 * @returns {Promise<void>} 表创建完成后无返回值
 */
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
  await db.exec('CREATE INDEX IF NOT EXISTS idx_sent_emails_status_created ON sent_emails(status, created_at DESC)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_sent_emails_from_addr ON sent_emails(from_addr)');
  // 迁移：若缺少 from_name 列，尝试增加
  try {
    const res = await db.prepare("PRAGMA table_info(sent_emails)").all();
    const cols = (res?.results || []).map(r => (r.name || r?.['name']));
    if (!cols.includes('from_name')){
      await db.exec('ALTER TABLE sent_emails ADD COLUMN from_name TEXT');
    }
  } catch (_) {}
}

// ============== 用户与授权相关 ==============
/**
 * 确保用户相关表存在，包括用户表和用户-邮箱关联表
 * @param {object} db - 数据库连接对象
 * @returns {Promise<void>} 表创建完成后无返回值
 */
export async function ensureUsersTables(db){
  // 用户表：默认邮箱上限 10
  await db.exec(
    "CREATE TABLE IF NOT EXISTS users (" +
    "id INTEGER PRIMARY KEY AUTOINCREMENT," +
    "username TEXT NOT NULL UNIQUE," +
    "password_hash TEXT," +
    "role TEXT NOT NULL DEFAULT 'user'," +
    "can_send INTEGER NOT NULL DEFAULT 0," +
    "mailbox_limit INTEGER NOT NULL DEFAULT 10," +
    "created_at TEXT DEFAULT CURRENT_TIMESTAMP" +
    ")"
  );
  await db.exec('CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)');

  // 迁移：若缺少 can_send 列，补齐
  try{
    const res = await db.prepare("PRAGMA table_info(users)").all();
    const cols = (res?.results || []).map(r => (r.name || r?.['name']));
    if (!cols.includes('can_send')){
      await db.exec('ALTER TABLE users ADD COLUMN can_send INTEGER NOT NULL DEFAULT 0');
    }
  }catch(_){ }

  // 用户-邮箱 关联表
  await db.exec(
    "CREATE TABLE IF NOT EXISTS user_mailboxes (" +
    "id INTEGER PRIMARY KEY AUTOINCREMENT," +
    "user_id INTEGER NOT NULL," +
    "mailbox_id INTEGER NOT NULL," +
    "created_at TEXT DEFAULT CURRENT_TIMESTAMP," +
    "is_pinned INTEGER NOT NULL DEFAULT 0," +
    "UNIQUE(user_id, mailbox_id)," +
    "FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE," +
    "FOREIGN KEY(mailbox_id) REFERENCES mailboxes(id) ON DELETE CASCADE" +
    ")"
  );
  await db.exec('CREATE INDEX IF NOT EXISTS idx_user_mailboxes_user ON user_mailboxes(user_id)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_user_mailboxes_mailbox ON user_mailboxes(mailbox_id)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_user_mailboxes_user_pinned ON user_mailboxes(user_id, is_pinned DESC)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_user_mailboxes_composite ON user_mailboxes(user_id, mailbox_id, is_pinned)');

  // 迁移：若缺少 is_pinned 列，则添加
  try {
    const um = await db.prepare("PRAGMA table_info(user_mailboxes)").all();
    const cols = (um?.results || []).map(r => (r.name || r?.['name']));
    if (!cols.includes('is_pinned')){
      await db.exec('ALTER TABLE user_mailboxes ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0');
    }
  } catch (_){ }
}

/**
 * 创建新用户
 * @param {object} db - 数据库连接对象
 * @param {object} params - 用户参数对象
 * @param {string} params.username - 用户名
 * @param {string} params.passwordHash - 密码哈希值，默认为null
 * @param {string} params.role - 用户角色，默认为'user'
 * @param {number} params.mailboxLimit - 邮箱数量限制，默认为10
 * @returns {Promise<object>} 创建的用户信息对象
 * @throws {Error} 当用户名为空时抛出异常
 */
export async function createUser(db, { username, passwordHash = null, role = 'user', mailboxLimit = 10 }){
  const uname = String(username || '').trim().toLowerCase();
  if (!uname) throw new Error('用户名不能为空');
  const r = await db.prepare('INSERT INTO users (username, password_hash, role, mailbox_limit) VALUES (?, ?, ?, ?)')
    .bind(uname, passwordHash, role, Math.max(0, Number(mailboxLimit || 10))).run();
  const res = await db.prepare('SELECT id, username, role, mailbox_limit, created_at FROM users WHERE username = ?')
    .bind(uname).all();
  return res?.results?.[0];
}

/**
 * 更新用户信息
 * @param {object} db - 数据库连接对象
 * @param {number} userId - 用户ID
 * @param {object} fields - 需要更新的字段对象
 * @returns {Promise<void>} 更新完成后无返回值
 */
export async function updateUser(db, userId, fields){
  const allowed = ['role', 'mailbox_limit', 'password_hash', 'can_send'];
  const setClauses = [];
  const values = [];
  for (const key of allowed){
    if (key in (fields || {})){
      setClauses.push(`${key} = ?`);
      values.push(fields[key]);
    }
  }
  if (!setClauses.length) return;
  const sql = `UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`;
  values.push(userId);
  await db.prepare(sql).bind(...values).run();
}

/**
 * 删除用户，关联表会自动级联删除
 * @param {object} db - 数据库连接对象
 * @param {number} userId - 用户ID
 * @returns {Promise<void>} 删除完成后无返回值
 */
export async function deleteUser(db, userId){
  // 关联表启用 ON DELETE CASCADE
  await db.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();
}

/**
 * 列出用户及其邮箱数量统计
 * @param {object} db - 数据库连接对象
 * @param {object} options - 查询选项
 * @param {number} options.limit - 每页数量限制，默认50
 * @param {number} options.offset - 偏移量，默认0
 * @returns {Promise<Array<object>>} 用户列表数组
 */
export async function listUsersWithCounts(db, { limit = 50, offset = 0 } = {}){
  const sql = `
    SELECT u.id, u.username, u.role, u.mailbox_limit, u.can_send, u.created_at,
           COALESCE(cnt.c, 0) AS mailbox_count
    FROM users u
    LEFT JOIN (
      SELECT user_id, COUNT(1) AS c FROM user_mailboxes GROUP BY user_id
    ) cnt ON cnt.user_id = u.id
    ORDER BY datetime(u.created_at) DESC
    LIMIT ? OFFSET ?
  `;
  const { results } = await db.prepare(sql).bind(Math.max(1, Math.min(100, Number(limit) || 50)), Math.max(0, Number(offset) || 0)).all();
  return results || [];
}

/**
 * 分配邮箱给用户
 * @param {object} db - 数据库连接对象
 * @param {object} params - 分配参数对象
 * @param {number} params.userId - 用户ID，可选
 * @param {string} params.username - 用户名，可选（userId和username至少提供一个）
 * @param {string} params.address - 邮箱地址
 * @returns {Promise<object>} 分配结果对象
 * @throws {Error} 当邮箱地址无效、用户不存在或达到邮箱上限时抛出异常
 */
export async function assignMailboxToUser(db, { userId = null, username = null, address }){
  const normalized = String(address || '').trim().toLowerCase();
  if (!normalized) throw new Error('邮箱地址无效');
  // 查询或创建邮箱
  const mailboxId = await getOrCreateMailboxId(db, normalized);

  // 获取用户 ID
  let uid = userId;
  if (!uid){
    const uname = String(username || '').trim().toLowerCase();
    if (!uname) throw new Error('缺少用户标识');
    const r = await db.prepare('SELECT id FROM users WHERE username = ?').bind(uname).all();
    if (!r.results || !r.results.length) throw new Error('用户不存在');
    uid = r.results[0].id;
  }

  // 校验上限
  const ures = await db.prepare('SELECT mailbox_limit FROM users WHERE id = ?').bind(uid).all();
  const limit = ures?.results?.[0]?.mailbox_limit ?? 10;
  const cres = await db.prepare('SELECT COUNT(1) AS c FROM user_mailboxes WHERE user_id = ?').bind(uid).all();
  const count = cres?.results?.[0]?.c || 0;
  if (count >= limit) throw new Error('已达到邮箱上限');

  // 绑定（唯一约束避免重复）
  await db.prepare('INSERT OR IGNORE INTO user_mailboxes (user_id, mailbox_id) VALUES (?, ?)').bind(uid, mailboxId).run();
  return { success: true };
}

/**
 * 获取用户的所有邮箱列表
 * @param {object} db - 数据库连接对象
 * @param {number} userId - 用户ID
 * @returns {Promise<Array<object>>} 用户邮箱列表数组，包含地址、创建时间和置顶状态
 */
export async function getUserMailboxes(db, userId){
  const sql = `
    SELECT m.address, m.created_at, um.is_pinned,
           COALESCE(m.can_login, 0) AS can_login
    FROM user_mailboxes um
    JOIN mailboxes m ON m.id = um.mailbox_id
    WHERE um.user_id = ?
    ORDER BY um.is_pinned DESC, datetime(m.created_at) DESC
  `;
  const { results } = await db.prepare(sql).bind(userId).all();
  return results || [];
}

