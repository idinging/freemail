import { clearExpiredCache } from './cacheHelper.js';

// 初始化状态标志（全局共享，Worker 生命周期内有效）
let _isFirstInit = true;

/**
 * 轻量级数据库初始化（仅在首次启动时检查）
 * @param {object} db - 数据库连接对象
 * @returns {Promise<void>} 初始化完成后无返回值
 */
export async function initDatabase(db) {
  try {
    // 清理过期缓存
    clearExpiredCache();
    
    // 仅首次启动时执行完整初始化
    if (_isFirstInit) {
      await performFirstTimeSetup(db);
      _isFirstInit = false;
    }
    
    // 每次都确保外键约束开启
    await db.exec(`PRAGMA foreign_keys = ON;`);
  } catch (error) {
    console.error('数据库初始化失败:', error);
    throw error;
  }
}

/**
 * 首次启动设置（仅执行一次）
 * @param {object} db - 数据库连接对象
 * @returns {Promise<void>}
 */
async function performFirstTimeSetup(db) {
  // 快速检查：如果主表存在，跳过初始化
  try {
    await db.prepare('SELECT 1 FROM mailboxes LIMIT 1').all();
    await db.prepare('SELECT 1 FROM messages LIMIT 1').all();
    await db.prepare('SELECT 1 FROM users LIMIT 1').all();
    // 所有表都存在，跳过创建
    return;
  } catch (e) {
    // 表不存在，继续初始化
  }
  
  // 创建表结构（仅在表不存在时）
  await db.exec("CREATE TABLE IF NOT EXISTS mailboxes (id INTEGER PRIMARY KEY AUTOINCREMENT, address TEXT NOT NULL UNIQUE, local_part TEXT NOT NULL, domain TEXT NOT NULL, password_hash TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, last_accessed_at TEXT, expires_at TEXT, is_pinned INTEGER DEFAULT 0, can_login INTEGER DEFAULT 0);");
  await db.exec("CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, mailbox_id INTEGER NOT NULL, sender TEXT NOT NULL, to_addrs TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL, verification_code TEXT, preview TEXT, r2_bucket TEXT NOT NULL DEFAULT 'mail-eml', r2_object_key TEXT NOT NULL DEFAULT '', received_at TEXT DEFAULT CURRENT_TIMESTAMP, is_read INTEGER DEFAULT 0, FOREIGN KEY(mailbox_id) REFERENCES mailboxes(id));");
  
  // 创建索引
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_mailboxes_address ON mailboxes(address);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_mailboxes_is_pinned ON mailboxes(is_pinned DESC);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_mailboxes_address_created ON mailboxes(address, created_at DESC);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_mailbox_id ON messages(mailbox_id);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_received_at ON messages(received_at DESC);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_r2_object_key ON messages(r2_object_key);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_mailbox_received ON messages(mailbox_id, received_at DESC);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_mailbox_received_read ON messages(mailbox_id, received_at DESC, is_read);`);
  
  // 创建用户和发送记录表
  await ensureUsersTables(db);
  await ensureSentEmailsTable(db);
}

/**
 * 完整的数据库设置脚本（用于首次部署）
 * 可通过 wrangler d1 execute 或管理面板执行
 * @param {object} db - 数据库连接对象
 * @returns {Promise<void>}
 */
export async function setupDatabase(db) {
  await db.exec(`PRAGMA foreign_keys = ON;`);
  
  // 创建所有表
  await db.exec(`
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
  `);
  
  await db.exec(`
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
  `);
  
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      can_send INTEGER NOT NULL DEFAULT 0,
      mailbox_limit INTEGER NOT NULL DEFAULT 10,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  
  await db.exec(`
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
  `);
  
  await db.exec(`
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
  `);
  
  // 创建所有索引
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_mailboxes_address ON mailboxes(address);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_mailboxes_is_pinned ON mailboxes(is_pinned DESC);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_mailboxes_address_created ON mailboxes(address, created_at DESC);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_mailbox_id ON messages(mailbox_id);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_received_at ON messages(received_at DESC);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_r2_object_key ON messages(r2_object_key);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_mailbox_received ON messages(mailbox_id, received_at DESC);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_mailbox_received_read ON messages(mailbox_id, received_at DESC, is_read);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_user_mailboxes_user ON user_mailboxes(user_id);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_user_mailboxes_mailbox ON user_mailboxes(mailbox_id);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_user_mailboxes_user_pinned ON user_mailboxes(user_id, is_pinned DESC);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_user_mailboxes_composite ON user_mailboxes(user_id, mailbox_id, is_pinned);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_sent_emails_resend_id ON sent_emails(resend_id);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_sent_emails_status_created ON sent_emails(status, created_at DESC);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_sent_emails_from_addr ON sent_emails(from_addr);`);
}

/**
 * 获取或创建邮箱ID，如果邮箱不存在则自动创建
 * @param {object} db - 数据库连接对象
 * @param {string} address - 邮箱地址
 * @returns {Promise<number>} 邮箱ID
 * @throws {Error} 当邮箱地址无效时抛出异常
 */
export async function getOrCreateMailboxId(db, address) {
  const { getCachedMailboxId, updateMailboxIdCache } = await import('./cacheHelper.js');
  
  const normalized = String(address || '').trim().toLowerCase();
  if (!normalized) throw new Error('无效的邮箱地址');
  
  // 先检查缓存
  const cachedId = await getCachedMailboxId(db, normalized);
  if (cachedId) {
    // 更新访问时间（使用后台任务，不阻塞主流程）
    db.prepare('UPDATE mailboxes SET last_accessed_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(cachedId).run().catch(() => {});
    return cachedId;
  }
  
  // 解析邮箱地址
  let local_part = '';
  let domain = '';
  const at = normalized.indexOf('@');
  if (at > 0 && at < normalized.length - 1) {
    local_part = normalized.slice(0, at);
    domain = normalized.slice(at + 1);
  }
  if (!local_part || !domain) throw new Error('无效的邮箱地址');
  
  // 再次查询数据库（避免并发创建）
  const existing = await db.prepare('SELECT id FROM mailboxes WHERE address = ? LIMIT 1').bind(normalized).all();
  if (existing.results && existing.results.length > 0) {
    const id = existing.results[0].id;
    updateMailboxIdCache(normalized, id);
    await db.prepare('UPDATE mailboxes SET last_accessed_at = CURRENT_TIMESTAMP WHERE id = ?').bind(id).run();
    return id;
  }
  
  // 创建新邮箱
  await db.prepare(
    'INSERT INTO mailboxes (address, local_part, domain, password_hash, last_accessed_at) VALUES (?, ?, ?, NULL, CURRENT_TIMESTAMP)'
  ).bind(normalized, local_part, domain).run();
  
  // 查询新创建的ID
  const created = await db.prepare('SELECT id FROM mailboxes WHERE address = ? LIMIT 1').bind(normalized).all();
  const newId = created.results[0].id;
  
  // 更新缓存
  updateMailboxIdCache(normalized, newId);
  
  // 使系统统计缓存失效（邮箱数量变化）
  const { invalidateSystemStatCache } = await import('./cacheHelper.js');
  invalidateSystemStatCache('total_mailboxes');
  
  return newId;
}

/**
 * 根据邮箱地址获取邮箱ID
 * @param {object} db - 数据库连接对象
 * @param {string} address - 邮箱地址
 * @returns {Promise<number|null>} 邮箱ID，如果不存在返回null
 */
export async function getMailboxIdByAddress(db, address) {
  const { getCachedMailboxId } = await import('./cacheHelper.js');
  
  const normalized = String(address || '').trim().toLowerCase();
  if (!normalized) return null;
  
  // 使用缓存
  return await getCachedMailboxId(db, normalized);
}

/**
 * 检查邮箱是否存在以及是否属于特定用户
 * @param {object} db - 数据库连接对象
 * @param {string} address - 邮箱地址
 * @param {number} userId - 用户ID（可选）
 * @returns {Promise<object>} 包含exists(是否存在)、ownedByUser(是否属于该用户)、mailboxId的对象
 */
export async function checkMailboxOwnership(db, address, userId = null) {
  const normalized = String(address || '').trim().toLowerCase();
  if (!normalized) return { exists: false, ownedByUser: false, mailboxId: null };
  
  // 检查邮箱是否存在
  const res = await db.prepare('SELECT id FROM mailboxes WHERE address = ? LIMIT 1').bind(normalized).all();
  if (!res.results || res.results.length === 0) {
    return { exists: false, ownedByUser: false, mailboxId: null };
  }
  
  const mailboxId = res.results[0].id;
  
  // 如果没有提供用户ID，只返回存在性检查结果
  if (!userId) {
    return { exists: true, ownedByUser: false, mailboxId };
  }
  
  // 检查邮箱是否属于该用户
  const ownerRes = await db.prepare(
    'SELECT id FROM user_mailboxes WHERE user_id = ? AND mailbox_id = ? LIMIT 1'
  ).bind(userId, mailboxId).all();
  
  const ownedByUser = ownerRes.results && ownerRes.results.length > 0;
  
  return { exists: true, ownedByUser, mailboxId };
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
  const mbRes = await db.prepare('SELECT id FROM mailboxes WHERE address = ? LIMIT 1').bind(normalized).all();
  if (!mbRes.results || mbRes.results.length === 0){
    throw new Error('邮箱不存在');
  }
  const mailboxId = mbRes.results[0].id;

  // 检查该邮箱是否属于该用户
  const umRes = await db.prepare('SELECT id, is_pinned FROM user_mailboxes WHERE user_id = ? AND mailbox_id = ? LIMIT 1')
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
  await db.prepare(`
    INSERT INTO sent_emails (resend_id, from_name, from_addr, to_addrs, subject, html_content, text_content, status, scheduled_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(resendId || null, fromName || null, from, toAddrs, subject, html || null, text || null, status, scheduledAt || null).run();
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
 * 确保发送邮件表存在（简化版，仅创建表）
 * @param {object} db - 数据库连接对象
 * @returns {Promise<void>} 表创建完成后无返回值
 */
async function ensureSentEmailsTable(db){
  await db.exec(`
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
    )
  `);
  await db.exec('CREATE INDEX IF NOT EXISTS idx_sent_emails_resend_id ON sent_emails(resend_id)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_sent_emails_status_created ON sent_emails(status, created_at DESC)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_sent_emails_from_addr ON sent_emails(from_addr)');
}

// ============== 用户与授权相关 ==============
/**
 * 确保用户相关表存在（简化版，仅创建表）
 * @param {object} db - 数据库连接对象
 * @returns {Promise<void>} 表创建完成后无返回值
 */
async function ensureUsersTables(db){
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      can_send INTEGER NOT NULL DEFAULT 0,
      mailbox_limit INTEGER NOT NULL DEFAULT 10,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.exec('CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)');

  await db.exec(`
    CREATE TABLE IF NOT EXISTS user_mailboxes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      mailbox_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      is_pinned INTEGER NOT NULL DEFAULT 0,
      UNIQUE(user_id, mailbox_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(mailbox_id) REFERENCES mailboxes(id) ON DELETE CASCADE
    )
  `);
  await db.exec('CREATE INDEX IF NOT EXISTS idx_user_mailboxes_user ON user_mailboxes(user_id)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_user_mailboxes_mailbox ON user_mailboxes(mailbox_id)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_user_mailboxes_user_pinned ON user_mailboxes(user_id, is_pinned DESC)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_user_mailboxes_composite ON user_mailboxes(user_id, mailbox_id, is_pinned)');
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
  const res = await db.prepare('SELECT id, username, role, mailbox_limit, created_at FROM users WHERE username = ? LIMIT 1')
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
  
  // 使相关缓存失效
  const { invalidateUserQuotaCache, invalidateSystemStatCache } = await import('./cacheHelper.js');
  if ('mailbox_limit' in fields) {
    invalidateUserQuotaCache(userId);
  }
  if ('can_send' in fields) {
    invalidateSystemStatCache(`user_can_send_${userId}`);
  }
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
 * @param {string} options.sort - 排序方向，'asc' 或 'desc'，默认'desc'
 * @returns {Promise<Array<object>>} 用户列表数组
 */
export async function listUsersWithCounts(db, { limit = 50, offset = 0, sort = 'desc' } = {}){
  const orderDirection = (sort === 'asc') ? 'ASC' : 'DESC';
  const actualLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  const actualOffset = Math.max(0, Number(offset) || 0);
  
  // 优化：先获取用户列表，再单独查询邮箱数量，避免子查询扫描全表
  const usersSql = `
    SELECT u.id, u.username, u.role, u.mailbox_limit, u.can_send, u.created_at
    FROM users u
    ORDER BY datetime(u.created_at) ${orderDirection}
    LIMIT ? OFFSET ?
  `;
  const { results: users } = await db.prepare(usersSql).bind(actualLimit, actualOffset).all();
  
  if (!users || users.length === 0) {
    return [];
  }
  
  // 批量查询这些用户的邮箱数量
  const userIds = users.map(u => u.id);
  const placeholders = userIds.map(() => '?').join(',');
  const countSql = `
    SELECT user_id, COUNT(1) AS c 
    FROM user_mailboxes 
    WHERE user_id IN (${placeholders})
    GROUP BY user_id
  `;
  const { results: counts } = await db.prepare(countSql).bind(...userIds).all();
  
  // 构建计数映射
  const countMap = new Map();
  for (const row of (counts || [])) {
    countMap.set(row.user_id, row.c);
  }
  
  // 合并结果
  return users.map(u => ({
    ...u,
    mailbox_count: countMap.get(u.id) || 0
  }));
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
  const { getCachedUserQuota, invalidateUserQuotaCache } = await import('./cacheHelper.js');
  
  const normalized = String(address || '').trim().toLowerCase();
  if (!normalized) throw new Error('邮箱地址无效');
  // 查询或创建邮箱
  const mailboxId = await getOrCreateMailboxId(db, normalized);

  // 获取用户 ID
  let uid = userId;
  if (!uid){
    const uname = String(username || '').trim().toLowerCase();
    if (!uname) throw new Error('缺少用户标识');
    const r = await db.prepare('SELECT id FROM users WHERE username = ? LIMIT 1').bind(uname).all();
    if (!r.results || !r.results.length) throw new Error('用户不存在');
    uid = r.results[0].id;
  }

  // 使用缓存校验上限
  const quota = await getCachedUserQuota(db, uid);
  if (quota.used >= quota.limit) throw new Error('已达到邮箱上限');

  // 绑定（唯一约束避免重复）
  await db.prepare('INSERT OR IGNORE INTO user_mailboxes (user_id, mailbox_id) VALUES (?, ?)').bind(uid, mailboxId).run();
  
  // 使缓存失效，下次查询时会重新获取
  invalidateUserQuotaCache(uid);
  
  return { success: true };
}

/**
 * 获取用户的所有邮箱列表
 * @param {object} db - 数据库连接对象
 * @param {number} userId - 用户ID
 * @param {number} limit - 查询数量限制，默认100
 * @returns {Promise<Array<object>>} 用户邮箱列表数组，包含地址、创建时间和置顶状态
 */
export async function getUserMailboxes(db, userId, limit = 100){
  const sql = `
    SELECT m.address, m.created_at, um.is_pinned,
           COALESCE(m.can_login, 0) AS can_login
    FROM user_mailboxes um
    JOIN mailboxes m ON m.id = um.mailbox_id
    WHERE um.user_id = ?
    ORDER BY um.is_pinned DESC, datetime(m.created_at) DESC
    LIMIT ?
  `;
  const { results } = await db.prepare(sql).bind(userId, Math.min(limit, 200)).all();
  return results || [];
}

/**
 * 取消邮箱分配，解除用户与邮箱的绑定关系
 * @param {object} db - 数据库连接对象
 * @param {object} params - 取消分配参数对象
 * @param {number} params.userId - 用户ID，可选
 * @param {string} params.username - 用户名，可选（userId和username至少提供一个）
 * @param {string} params.address - 邮箱地址
 * @returns {Promise<object>} 取消分配结果对象
 * @throws {Error} 当邮箱地址无效、用户不存在或邮箱未分配给该用户时抛出异常
 */
export async function unassignMailboxFromUser(db, { userId = null, username = null, address }){
  const { invalidateUserQuotaCache } = await import('./cacheHelper.js');
  
  const normalized = String(address || '').trim().toLowerCase();
  if (!normalized) throw new Error('邮箱地址无效');
  
  // 获取邮箱ID
  const mailboxId = await getMailboxIdByAddress(db, normalized);
  if (!mailboxId) throw new Error('邮箱不存在');

  // 获取用户ID
  let uid = userId;
  if (!uid){
    const uname = String(username || '').trim().toLowerCase();
    if (!uname) throw new Error('缺少用户标识');
    const r = await db.prepare('SELECT id FROM users WHERE username = ? LIMIT 1').bind(uname).all();
    if (!r.results || !r.results.length) throw new Error('用户不存在');
    uid = r.results[0].id;
  }

  // 检查绑定关系是否存在
  const checkRes = await db.prepare('SELECT id FROM user_mailboxes WHERE user_id = ? AND mailbox_id = ? LIMIT 1')
    .bind(uid, mailboxId).all();
  if (!checkRes.results || checkRes.results.length === 0) {
    throw new Error('该邮箱未分配给该用户');
  }

  // 删除绑定关系
  await db.prepare('DELETE FROM user_mailboxes WHERE user_id = ? AND mailbox_id = ?')
    .bind(uid, mailboxId).run();
  
  // 使缓存失效
  invalidateUserQuotaCache(uid);
  
  return { success: true };
}

/**
 * 获取系统中所有邮箱的总数量
 * @param {object} db - 数据库连接对象
 * @returns {Promise<number>} 系统中所有邮箱的总数量
 */
export async function getTotalMailboxCount(db) {
  const { getCachedSystemStat } = await import('./cacheHelper.js');
  
  try {
    // 使用缓存避免频繁的 COUNT 全表扫描
    return await getCachedSystemStat(db, 'total_mailboxes', async (db) => {
      const result = await db.prepare('SELECT COUNT(1) AS count FROM mailboxes').all();
      return result?.results?.[0]?.count || 0;
    });
  } catch (error) {
    console.error('获取系统邮箱总数失败:', error);
    return 0;
  }
}

