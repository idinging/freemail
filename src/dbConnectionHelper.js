/**
 * 数据库连接辅助工具
 * 解决数据库绑定名称硬编码问题，支持动态获取D1数据库连接
 */

// 缓存数据库连接和绑定名称，避免重复查找和日志输出
let _cachedDB = null;
let _cachedBindingName = null;

/**
 * 获取D1数据库连接对象
 * @param {object} env - Cloudflare Workers环境变量对象
 * @returns {object|null} 数据库连接对象，如果未找到返回null
 */
export function getDatabase(env) {
  // 如果已经缓存了数据库连接，直接返回
  if (_cachedDB && _cachedBindingName && env[_cachedBindingName]) {
    return _cachedDB;
  }

  // 尝试的数据库绑定名称列表（按优先级排序）
  const possibleBindings = [
    'TEMP_MAIL_DB',      // 原有默认名称
    'DB',                // 通用数据库绑定名称
    'DATABASE',          // 另一个常见名称
    'D1_DB',             // D1数据库常用名称
    'MAIL_DB',           // 邮件数据库
    'MAILFREE_DB',       // 项目相关名称
    'TEMPMAIL_DB'        // 临时邮箱数据库
  ];

  // 遍历所有可能的绑定名称
  for (const bindingName of possibleBindings) {
    if (env[bindingName]) {
      // 只在首次找到时打印日志
      if (_cachedBindingName !== bindingName) {
        console.log(`使用数据库绑定: ${bindingName}`);
        _cachedBindingName = bindingName;
      }
      _cachedDB = env[bindingName];
      return _cachedDB;
    }
  }

  // 如果都没找到，尝试从env中查找任何看起来像D1数据库的对象
  const envKeys = Object.keys(env);
  for (const key of envKeys) {
    const value = env[key];
    // 检查是否是D1数据库对象（有prepare方法）
    if (value && typeof value === 'object' && typeof value.prepare === 'function') {
      // 只在首次找到时打印日志
      if (_cachedBindingName !== key) {
        console.log(`自动检测到数据库绑定: ${key}`);
        _cachedBindingName = key;
      }
      _cachedDB = value;
      return _cachedDB;
    }
  }

  console.error('未找到有效的D1数据库绑定，请检查wrangler.toml配置');
  return null;
}

/**
 * 验证数据库连接是否有效
 * @param {object} db - 数据库连接对象
 * @returns {Promise<boolean>} 连接是否有效
 */
export async function validateDatabaseConnection(db) {
  if (!db) return false;
  
  try {
    // 尝试执行一个简单的查询来验证连接
    await db.prepare('SELECT 1').all();
    return true;
  } catch (error) {
    console.error('数据库连接验证失败:', error);
    return false;
  }
}

// 缓存验证结果，避免重复验证
let _validationCache = new Map();

/**
 * 获取并验证数据库连接
 * @param {object} env - 环境变量对象
 * @returns {Promise<object|null>} 已验证的数据库连接对象
 */
export async function getDatabaseWithValidation(env) {
  const db = getDatabase(env);
  if (!db) {
    throw new Error('无法获取数据库连接，请检查wrangler.toml中的D1数据库配置');
  }
  
  // 使用缓存的验证结果，避免重复验证
  const cacheKey = _cachedBindingName || 'unknown';
  if (_validationCache.has(cacheKey)) {
    const cached = _validationCache.get(cacheKey);
    // 缓存5分钟
    if (Date.now() - cached.timestamp < 5 * 60 * 1000) {
      return cached.valid ? db : (() => { throw new Error('数据库连接无效（缓存）'); })();
    }
  }
  
  const isValid = await validateDatabaseConnection(db);
  _validationCache.set(cacheKey, { valid: isValid, timestamp: Date.now() });
  
  if (!isValid) {
    throw new Error('数据库连接无效，请检查数据库配置和权限');
  }
  
  return db;
}
