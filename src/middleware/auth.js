/**
 * 认证中间件模块
 * @module middleware/auth
 */

export const COOKIE_NAME = 'iding-session';

// 默认会话过期时间（天）
const DEFAULT_SESSION_EXPIRE_DAYS = 7;

/**
 * 获取会话过期秒数
 * @param {number|string} days - 过期天数
 * @returns {number} 过期秒数
 */
export function getSessionExpireSeconds(days) {
  const d = parseInt(days, 10);
  const validDays = (Number.isFinite(d) && d > 0) ? d : DEFAULT_SESSION_EXPIRE_DAYS;
  return validDays * 24 * 60 * 60;
}

/**
 * 创建JWT令牌
 * @param {string} secret - JWT签名密钥
 * @param {object} extraPayload - 额外的负载数据
 * @param {number} expireDays - 过期天数（可选，默认从环境变量或7天）
 * @returns {Promise<string>} 生成的JWT令牌
 */
export async function createJwt(secret, extraPayload = {}, expireDays = DEFAULT_SESSION_EXPIRE_DAYS) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const expireSeconds = getSessionExpireSeconds(expireDays);
  const payload = { exp: Math.floor(Date.now() / 1000) + expireSeconds, ...extraPayload };
  const encoder = new TextEncoder();
  const data = base64UrlEncode(JSON.stringify(header)) + '.' + base64UrlEncode(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return data + '.' + base64UrlEncode(new Uint8Array(signature));
}

/**
 * 验证JWT令牌
 * @param {string} secret - JWT签名密钥
 * @param {string} cookieHeader - 包含JWT令牌的Cookie头部
 * @returns {Promise<object|false>} 验证成功返回负载对象，失败返回false
 */
export async function verifyJwt(secret, cookieHeader) {
  if (!cookieHeader) return false;
  const cookie = cookieHeader.split(';').find(c => c.trim().startsWith(`${COOKIE_NAME}=`));
  if (!cookie) return false;
  const token = cookie.split('=')[1];
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const valid = await crypto.subtle.verify('HMAC', key, base64UrlDecode(parts[2]), encoder.encode(parts[0] + '.' + parts[1]));
    if (!valid) return false;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1])));
    if (payload.exp <= Math.floor(Date.now() / 1000)) return false;
    return payload;
  } catch (_) {
    return false;
  }
}

/**
 * 构建会话Cookie字符串
 * @param {string} token - JWT令牌
 * @param {string} reqUrl - 请求URL
 * @param {number} expireDays - 过期天数（可选，默认7天）
 * @returns {string} Cookie字符串
 */
export function buildSessionCookie(token, reqUrl = '', expireDays = DEFAULT_SESSION_EXPIRE_DAYS) {
  const maxAge = getSessionExpireSeconds(expireDays);
  try {
    const u = new URL(reqUrl || 'http://localhost/');
    const isHttps = (u.protocol === 'https:');
    const secureFlag = isHttps ? ' Secure;' : '';
    return `${COOKIE_NAME}=${token}; HttpOnly;${secureFlag} Path=/; SameSite=Strict; Max-Age=${maxAge}`;
  } catch (_) {
    return `${COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${maxAge}`;
  }
}

/**
 * 验证邮箱登录
 * @param {string} emailAddress - 邮箱地址
 * @param {string} password - 输入的密码
 * @param {object} DB - 数据库连接对象
 * @returns {Promise<object|false>} 验证成功返回邮箱信息，失败返回false
 */
export async function verifyMailboxLogin(emailAddress, password, DB) {
  if (!emailAddress || !password) return false;

  try {
    const email = emailAddress.toLowerCase().trim();

    const result = await DB.prepare('SELECT id, address, local_part, domain, password_hash, can_login FROM mailboxes WHERE address = ?')
      .bind(email).all();

    if (result?.results?.length > 0) {
      const mailbox = result.results[0];

      if (!mailbox.can_login) {
        return false;
      }

      let passwordValid = false;

      if (mailbox.password_hash) {
        passwordValid = await verifyPassword(password, mailbox.password_hash);
      } else {
        passwordValid = (password === email);
      }

      if (!passwordValid) {
        return false;
      }

      await DB.prepare('UPDATE mailboxes SET last_accessed_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(mailbox.id).run();

      return {
        id: mailbox.id,
        address: mailbox.address,
        localPart: mailbox.local_part,
        domain: mailbox.domain,
        role: 'mailbox'
      };
    }

    return false;
  } catch (error) {
    console.error('Mailbox login verification error:', error);
    return false;
  }
}

/**
 * SHA256哈希函数
 */
async function sha256Hex(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 验证密码
 * @param {string} rawPassword - 原始密码
 * @param {string} hashed - 哈希密码
 * @returns {Promise<boolean>} 验证结果
 */
export async function verifyPassword(rawPassword, hashed) {
  if (!hashed) return false;
  try {
    const hex = (await sha256Hex(rawPassword)).toLowerCase();
    return hex === String(hashed || '').toLowerCase();
  } catch (_) {
    return false;
  }
}

/**
 * 生成密码哈希
 * @param {string} password - 原始密码
 * @returns {Promise<string>} 哈希后的密码
 */
export async function hashPassword(password) {
  return await sha256Hex(password);
}

function base64UrlEncode(data) {
  const s = typeof data === 'string' ? data : String.fromCharCode(...(data instanceof Uint8Array ? data : new Uint8Array()));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+/g, '');
}

function base64UrlDecode(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * 带缓存的JWT验证函数
 * @param {string} JWT_TOKEN - JWT密钥
 * @param {string} cookieHeader - Cookie头
 * @returns {Promise<boolean|object>} 验证结果
 */
export async function verifyJwtWithCache(JWT_TOKEN, cookieHeader) {
  const token = (cookieHeader.split(';').find(s => s.trim().startsWith('iding-session=')) || '').split('=')[1] || '';
  if (!globalThis.__JWT_CACHE__) globalThis.__JWT_CACHE__ = new Map();

  const now = Date.now();
  for (const [key, value] of globalThis.__JWT_CACHE__.entries()) {
    if (value.exp <= now) {
      globalThis.__JWT_CACHE__.delete(key);
    }
  }

  let payload = false;
  if (token && globalThis.__JWT_CACHE__.has(token)) {
    const cached = globalThis.__JWT_CACHE__.get(token);
    if (cached.exp > now) {
      payload = cached.payload;
    } else {
      globalThis.__JWT_CACHE__.delete(token);
    }
  }

  if (!payload) {
    payload = JWT_TOKEN ? await verifyJwt(JWT_TOKEN, cookieHeader) : false;
    if (token && payload) {
      globalThis.__JWT_CACHE__.set(token, { payload, exp: now + 30 * 60 * 1000 });
    }
  }

  return payload;
}

/**
 * 检查超级管理员权限覆盖
 * @param {Request} request - HTTP请求对象
 * @param {string} JWT_TOKEN - JWT密钥令牌
 * @returns {object|null} 超级管理员权限对象
 */
export function checkRootAdminOverride(request, JWT_TOKEN) {
  try {
    if (!JWT_TOKEN) return null;
    const auth = request.headers.get('Authorization') || request.headers.get('authorization') || '';
    const xToken = request.headers.get('X-Admin-Token') || request.headers.get('x-admin-token') || '';
    let urlToken = '';
    try {
      const u = new URL(request.url);
      urlToken = u.searchParams.get('admin_token') || '';
    } catch (_) { }
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (bearer && bearer === JWT_TOKEN) return { role: 'admin', username: '__root__', userId: 0 };
    if (xToken && xToken === JWT_TOKEN) return { role: 'admin', username: '__root__', userId: 0 };
    if (urlToken && urlToken === JWT_TOKEN) return { role: 'admin', username: '__root__', userId: 0 };
    return null;
  } catch (_) {
    return null;
  }
}

/**
 * 解析请求的认证负载信息
 * @param {Request} request - HTTP请求对象
 * @param {string} JWT_TOKEN - JWT密钥令牌
 * @returns {Promise<object|false>} 认证负载对象
 */
export async function resolveAuthPayload(request, JWT_TOKEN) {
  const root = checkRootAdminOverride(request, JWT_TOKEN);
  if (root) return root;
  return await verifyJwtWithCache(JWT_TOKEN, request.headers.get('Cookie') || '');
}

/**
 * 认证中间件
 * @param {object} context - 请求上下文
 * @returns {Promise<Response|null>} 认证失败返回401响应
 */
export async function authMiddleware(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const publicPaths = ['/api/login', '/api/logout'];
  if (publicPaths.includes(url.pathname)) {
    return null;
  }

  const JWT_TOKEN = env.JWT_TOKEN || env.JWT_SECRET || '';
  const root = checkRootAdminOverride(request, JWT_TOKEN);
  if (root) {
    context.authPayload = root;
    return null;
  }

  const payload = await verifyJwtWithCache(JWT_TOKEN, request.headers.get('Cookie') || '');
  if (!payload) {
    return new Response('Unauthorized', { status: 401 });
  }

  context.authPayload = payload;
  return null;
}
