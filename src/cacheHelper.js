/**
 * 缓存辅助工具
 * 用于减少数据库查询次数，降低 Cloudflare D1 的行读取量
 */

// 全局缓存对象
const CACHE = {
  tableStructures: new Map(), // 表结构缓存
  mailboxIds: new Map(),      // 邮箱ID缓存
  userQuotas: new Map(),      // 用户配额缓存
  systemStats: new Map(),     // 系统统计数据缓存（COUNT 等）
  lastClearTime: Date.now()   // 上次清理时间
};

// 缓存过期时间配置（毫秒）
const CACHE_TTL = {
  tableStructure: 60 * 60 * 1000,   // 表结构缓存1小时
  mailboxId: 10 * 60 * 1000,        // 邮箱ID缓存10分钟
  userQuota: 5 * 60 * 1000,         // 用户配额缓存5分钟
  systemStats: 10 * 60 * 1000,      // 系统统计缓存10分钟
  clearInterval: 30 * 60 * 1000     // 每30分钟清理一次过期缓存
};

/**
 * 获取表结构信息（带缓存）
 * @param {object} db - 数据库连接
 * @param {string} tableName - 表名
 * @returns {Promise<Array>} 列信息数组
 */
export async function getCachedTableStructure(db, tableName) {
  const cacheKey = tableName;
  const cached = CACHE.tableStructures.get(cacheKey);
  
  // 检查缓存是否有效
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL.tableStructure) {
    return cached.data;
  }
  
  // 查询数据库
  try {
    const res = await db.prepare(`PRAGMA table_info(${tableName})`).all();
    const cols = (res?.results || []).map(r => ({
      name: r.name || r?.['name'],
      type: r.type || r?.['type'],
      notnull: r.notnull ? 1 : 0,
      dflt_value: r.dflt_value
    }));
    
    // 更新缓存
    CACHE.tableStructures.set(cacheKey, {
      data: cols,
      timestamp: Date.now()
    });
    
    return cols;
  } catch (e) {
    console.error('获取表结构失败:', e);
    return [];
  }
}

/**
 * 检查列是否存在（使用缓存的表结构）
 * @param {object} db - 数据库连接
 * @param {string} tableName - 表名
 * @param {string} columnName - 列名
 * @returns {Promise<boolean>} 列是否存在
 */
export async function hasColumn(db, tableName, columnName) {
  const cols = await getCachedTableStructure(db, tableName);
  return cols.some(c => c.name === columnName);
}

/**
 * 获取邮箱ID（带缓存）
 * @param {object} db - 数据库连接
 * @param {string} address - 邮箱地址
 * @returns {Promise<number|null>} 邮箱ID
 */
export async function getCachedMailboxId(db, address) {
  const normalized = String(address || '').trim().toLowerCase();
  if (!normalized) return null;
  
  const cached = CACHE.mailboxIds.get(normalized);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL.mailboxId) {
    return cached.id;
  }
  
  // 查询数据库
  const res = await db.prepare('SELECT id FROM mailboxes WHERE address = ?').bind(normalized).all();
  const id = (res.results && res.results.length) ? res.results[0].id : null;
  
  // 更新缓存（即使是 null 也缓存，避免重复查询不存在的邮箱）
  CACHE.mailboxIds.set(normalized, {
    id,
    timestamp: Date.now()
  });
  
  return id;
}

/**
 * 更新邮箱ID缓存
 * @param {string} address - 邮箱地址
 * @param {number} id - 邮箱ID
 */
export function updateMailboxIdCache(address, id) {
  const normalized = String(address || '').trim().toLowerCase();
  if (!normalized || !id) return;
  
  CACHE.mailboxIds.set(normalized, {
    id,
    timestamp: Date.now()
  });
}

/**
 * 使邮箱ID缓存失效
 * @param {string} address - 邮箱地址
 */
export function invalidateMailboxCache(address) {
  const normalized = String(address || '').trim().toLowerCase();
  CACHE.mailboxIds.delete(normalized);
}

/**
 * 获取用户配额（带缓存）
 * @param {object} db - 数据库连接
 * @param {number} userId - 用户ID
 * @returns {Promise<object>} {used, limit}
 */
export async function getCachedUserQuota(db, userId) {
  const cached = CACHE.userQuotas.get(userId);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL.userQuota) {
    return cached.data;
  }
  
  // 查询数据库
  const ures = await db.prepare('SELECT mailbox_limit FROM users WHERE id = ?').bind(userId).all();
  const limit = ures?.results?.[0]?.mailbox_limit ?? 10;
  const cres = await db.prepare('SELECT COUNT(1) AS c FROM user_mailboxes WHERE user_id = ?').bind(userId).all();
  const used = cres?.results?.[0]?.c || 0;
  
  const data = { used, limit };
  
  // 更新缓存
  CACHE.userQuotas.set(userId, {
    data,
    timestamp: Date.now()
  });
  
  return data;
}

/**
 * 使用户配额缓存失效
 * @param {number} userId - 用户ID
 */
export function invalidateUserQuotaCache(userId) {
  CACHE.userQuotas.delete(userId);
}

/**
 * 获取系统统计数据（带缓存）
 * @param {object} db - 数据库连接
 * @param {string} statKey - 统计类型（如 'total_mailboxes', 'total_messages'）
 * @param {Function} queryFn - 查询函数
 * @returns {Promise<number>} 统计数值
 */
export async function getCachedSystemStat(db, statKey, queryFn) {
  const cached = CACHE.systemStats.get(statKey);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL.systemStats) {
    return cached.value;
  }
  
  // 执行查询函数
  const value = await queryFn(db);
  
  // 更新缓存
  CACHE.systemStats.set(statKey, {
    value,
    timestamp: Date.now()
  });
  
  return value;
}

/**
 * 使系统统计缓存失效
 * @param {string} statKey - 统计类型，不提供则清空所有统计缓存
 */
export function invalidateSystemStatCache(statKey = null) {
  if (statKey) {
    CACHE.systemStats.delete(statKey);
  } else {
    CACHE.systemStats.clear();
  }
}

/**
 * 清理过期缓存
 */
export function clearExpiredCache() {
  const now = Date.now();
  
  // 避免频繁清理
  if (now - CACHE.lastClearTime < CACHE_TTL.clearInterval) {
    return;
  }
  
  CACHE.lastClearTime = now;
  
  // 清理过期的邮箱ID缓存
  for (const [key, value] of CACHE.mailboxIds.entries()) {
    if (now - value.timestamp > CACHE_TTL.mailboxId) {
      CACHE.mailboxIds.delete(key);
    }
  }
  
  // 清理过期的用户配额缓存
  for (const [key, value] of CACHE.userQuotas.entries()) {
    if (now - value.timestamp > CACHE_TTL.userQuota) {
      CACHE.userQuotas.delete(key);
    }
  }
  
  // 清理过期的系统统计缓存
  for (const [key, value] of CACHE.systemStats.entries()) {
    if (now - value.timestamp > CACHE_TTL.systemStats) {
      CACHE.systemStats.delete(key);
    }
  }
}

/**
 * 清空所有缓存
 */
export function clearAllCache() {
  CACHE.tableStructures.clear();
  CACHE.mailboxIds.clear();
  CACHE.userQuotas.clear();
  CACHE.systemStats.clear();
  CACHE.lastClearTime = Date.now();
}

