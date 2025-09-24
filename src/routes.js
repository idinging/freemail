import { handleApiRequest, handleEmailReceive } from './apiHandlers.js';
import { createJwt, verifyJwt, buildSessionCookie, verifyMailboxLogin } from './authentication.js';
import { extractEmail } from './commonUtils.js';
import { getDatabaseWithValidation } from './dbConnectionHelper.js';

/**
 * 路由处理器类，用于管理所有API路由
 */
export class Router {
  constructor() {
    this.routes = [];
    this.middlewares = [];
  }

  /**
   * 添加中间件
   * @param {Function} middleware - 中间件函数
   */
  use(middleware) {
    this.middlewares.push(middleware);
  }

  /**
   * 添加GET路由
   * @param {string} path - 路径
   * @param {Function} handler - 处理函数
   */
  get(path, handler) {
    this.addRoute('GET', path, handler);
  }

  /**
   * 添加POST路由
   * @param {string} path - 路径
   * @param {Function} handler - 处理函数
   */
  post(path, handler) {
    this.addRoute('POST', path, handler);
  }

  /**
   * 添加PATCH路由
   * @param {string} path - 路径
   * @param {Function} handler - 处理函数
   */
  patch(path, handler) {
    this.addRoute('PATCH', path, handler);
  }

  /**
   * 添加PUT路由
   * @param {string} path - 路径
   * @param {Function} handler - 处理函数
   */
  put(path, handler) {
    this.addRoute('PUT', path, handler);
  }

  /**
   * 添加DELETE路由
   * @param {string} path - 路径
   * @param {Function} handler - 处理函数
   */
  delete(path, handler) {
    this.addRoute('DELETE', path, handler);
  }

  /**
   * 添加路由
   * @param {string} method - HTTP方法
   * @param {string} path - 路径模式
   * @param {Function} handler - 处理函数
   */
  addRoute(method, path, handler) {
    // 将路径转换为正则表达式，支持参数捕获
    const paramNames = [];
    const regexPath = path
      .replace(/:\w+/g, (match) => {
        paramNames.push(match.slice(1)); // 移除冒号
        return '([^/]+)';
      })
      .replace(/\*/g, '.*');

    this.routes.push({
      method: method.toUpperCase(),
      path,
      regex: new RegExp(`^${regexPath}$`),
      paramNames,
      handler
    });
  }

  /**
   * 处理请求
   * @param {Request} request - HTTP请求
   * @param {object} context - 上下文对象
   * @returns {Promise<Response>} HTTP响应
   */
  async handle(request, context) {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const pathname = url.pathname;

    // 查找匹配的路由
    for (const route of this.routes) {
      if (route.method === method) {
        const match = pathname.match(route.regex);
        if (match) {
          // 构建参数对象
          const params = {};
          route.paramNames.forEach((name, index) => {
            params[name] = match[index + 1];
          });

          // 创建增强的请求上下文
          const enhancedContext = {
            ...context,
            params,
            query: Object.fromEntries(url.searchParams.entries()),
            request,
            url
          };

          // 执行中间件
          for (const middleware of this.middlewares) {
            const result = await middleware(enhancedContext);
            if (result) return result; // 如果中间件返回响应，直接返回
          }

          // 执行路由处理函数
          return await route.handler(enhancedContext);
        }
      }
    }

    // 未找到匹配的路由
    return null;
  }
}

/**
 * 计算文本的SHA-256哈希值并返回十六进制字符串
 * @param {string} text - 需要计算哈希的文本内容
 * @returns {Promise<string>} 十六进制格式的SHA-256哈希值
 */
async function sha256Hex(text) {
  const enc = new TextEncoder();
  const data = enc.encode(String(text || ''));
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * 验证原始密码与哈希密码是否匹配
 * @param {string} rawPassword - 原始明文密码
 * @param {string} hashed - 已哈希的密码
 * @returns {Promise<boolean>} 验证结果，true表示密码匹配
 */
async function verifyPassword(rawPassword, hashed) {
  if (!hashed) return false;
  try {
    const hex = (await sha256Hex(rawPassword)).toLowerCase();
    return hex === String(hashed || '').toLowerCase();
  } catch (_) {
    return false;
  }
}

/**
 * 认证中间件
 * @param {object} context - 请求上下文
 * @returns {Promise<Response|null>} 如果认证失败返回401响应，否则返回null继续处理
 */
export async function authMiddleware(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  
  // 跳过不需要认证的路由
  const publicPaths = ['/api/login', '/api/logout'];
  if (publicPaths.includes(url.pathname)) {
    return null;
  }

  // 检查超级管理员权限覆盖
  const JWT_TOKEN = env.JWT_TOKEN || env.JWT_SECRET || '';
  const root = checkRootAdminOverride(request, JWT_TOKEN);
  if (root) {
    context.authPayload = root;
    return null;
  }

  // 验证JWT令牌
  const payload = await verifyJwtWithCache(JWT_TOKEN, request.headers.get('Cookie') || '');
  if (!payload) {
    return new Response('Unauthorized', { status: 401 });
  }

  context.authPayload = payload;
  return null;
}

/**
 * 带缓存的JWT验证函数，提高验证性能
 * @param {string} JWT_TOKEN - JWT密钥
 * @param {string} cookieHeader - 包含认证信息的Cookie头
 * @returns {Promise<boolean|object>} 验证结果，false表示验证失败，object表示验证成功的用户信息
 */
async function verifyJwtWithCache(JWT_TOKEN, cookieHeader) {
  const token = (cookieHeader.split(';').find(s => s.trim().startsWith('iding-session=')) || '').split('=')[1] || '';
  if (!globalThis.__JWT_CACHE__) globalThis.__JWT_CACHE__ = new Map();

  // 清理过期缓存项
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
 * 当请求携带与env.JWT_TOKEN相同的令牌时，直接视为最高管理员
 * @param {Request} request - HTTP请求对象
 * @param {string} JWT_TOKEN - JWT密钥令牌
 * @returns {object|null} 超级管理员权限对象，如果不是超级管理员则返回null
 */
function checkRootAdminOverride(request, JWT_TOKEN) {
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
 * 解析请求的认证负载信息（导出给server.js使用）
 * @param {Request} request - HTTP请求对象
 * @param {string} JWT_TOKEN - JWT密钥令牌
 * @returns {Promise<object|false>} 认证负载对象，验证失败返回false
 */
export async function resolveAuthPayload(request, JWT_TOKEN) {
  const root = checkRootAdminOverride(request, JWT_TOKEN);
  if (root) return root;
  return await verifyJwtWithCache(JWT_TOKEN, request.headers.get('Cookie') || '');
}

/**
 * 创建并配置路由器
 * @returns {Router} 配置好的路由器实例
 */
export function createRouter() {
  const router = new Router();

  // =================== 认证相关路由 ===================
  router.post('/api/login', async (context) => {
    const { request, env } = context;
    let DB;
    try {
      DB = await getDatabaseWithValidation(env);
    } catch (error) {
      console.error('登录时数据库连接失败:', error.message);
      return new Response('数据库连接失败', { status: 500 });
    }
    const ADMIN_NAME = String(env.ADMIN_NAME || 'admin').trim().toLowerCase();
    const ADMIN_PASSWORD = env.ADMIN_PASSWORD || env.ADMIN_PASS || '';
    const GUEST_PASSWORD = env.GUEST_PASSWORD || '';
    const JWT_TOKEN = env.JWT_TOKEN || env.JWT_SECRET || '';

    try {
      const body = await request.json();
      const name = String(body.username || '').trim().toLowerCase();
      const password = String(body.password || '').trim();
      
      if (!name || !password) {
        return new Response('用户名或密码不能为空', { status: 400 });
      }

      // 1) 管理员：用户名匹配 ADMIN_NAME + 密码匹配 ADMIN_PASSWORD
      if (name === ADMIN_NAME && ADMIN_PASSWORD && password === ADMIN_PASSWORD) {
        let adminUserId = 0;
        try {
          const u = await DB.prepare('SELECT id FROM users WHERE username = ?').bind(ADMIN_NAME).all();
          if (u?.results?.length) {
            adminUserId = Number(u.results[0].id);
          } else {
            await DB.prepare("INSERT INTO users (username, role, can_send, mailbox_limit) VALUES (?, 'admin', 1, 9999)").bind(ADMIN_NAME).run();
            const again = await DB.prepare('SELECT id FROM users WHERE username = ?').bind(ADMIN_NAME).all();
            adminUserId = Number(again?.results?.[0]?.id || 0);
          }
        } catch (_) {
          adminUserId = 0;
        }

        const token = await createJwt(JWT_TOKEN, { role: 'admin', username: ADMIN_NAME, userId: adminUserId });
        const headers = new Headers({ 'Content-Type': 'application/json' });
        headers.set('Set-Cookie', buildSessionCookie(token, request.url));
        return new Response(JSON.stringify({ success: true, role: 'admin', can_send: 1, mailbox_limit: 9999 }), { headers });
      }

      // 2) 访客：用户名为 guest 且密码匹配 GUEST_PASSWORD
      if (name === 'guest' && GUEST_PASSWORD && password === GUEST_PASSWORD) {
        const token = await createJwt(JWT_TOKEN, { role: 'guest', username: 'guest' });
        const headers = new Headers({ 'Content-Type': 'application/json' });
        headers.set('Set-Cookie', buildSessionCookie(token, request.url));
        return new Response(JSON.stringify({ success: true, role: 'guest' }), { headers });
      }

      // 3) 普通用户：查询 users 表校验用户名与密码
      try {
        const { results } = await DB.prepare('SELECT id, password_hash, role, mailbox_limit, can_send FROM users WHERE username = ?').bind(name).all();
        if (results && results.length) {
          const row = results[0];
          const ok = await verifyPassword(password, row.password_hash || '');
          if (ok) {
            const role = (row.role === 'admin') ? 'admin' : 'user';
            const token = await createJwt(JWT_TOKEN, { role, username: name, userId: row.id });
            const headers = new Headers({ 'Content-Type': 'application/json' });
            headers.set('Set-Cookie', buildSessionCookie(token, request.url));
            const canSend = role === 'admin' ? 1 : (row.can_send ? 1 : 0);
            const mailboxLimit = role === 'admin' ? (row.mailbox_limit || 20) : (row.mailbox_limit || 10);
            return new Response(JSON.stringify({ success: true, role, can_send: canSend, mailbox_limit: mailboxLimit }), { headers });
          }
        }
      } catch (_) {
        // ignore and fallback to mailbox login
      }

      // 4) 邮箱登录：检查是否为有效邮箱地址，密码为邮箱地址本身
      try {
        // 检查是否为邮箱格式
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (emailRegex.test(name)) {
          const mailboxInfo = await verifyMailboxLogin(name, password, DB);
          if (mailboxInfo) {
            const token = await createJwt(JWT_TOKEN, { 
              role: 'mailbox', 
              username: name, 
              mailboxId: mailboxInfo.id,
              mailboxAddress: mailboxInfo.address
            });
            const headers = new Headers({ 'Content-Type': 'application/json' });
            headers.set('Set-Cookie', buildSessionCookie(token, request.url));
            return new Response(JSON.stringify({ 
              success: true, 
              role: 'mailbox', 
              mailbox: mailboxInfo.address,
              can_send: 0,
              mailbox_limit: 1
            }), { headers });
          }
        }
      } catch (_) {
        // ignore and fallback unauthorized
      }

      return new Response('用户名或密码错误', { status: 401 });
    } catch (_) {
      return new Response('Bad Request', { status: 400 });
    }
  });

  router.post('/api/logout', async (context) => {
    const { request } = context;
    const headers = new Headers({ 'Content-Type': 'application/json' });
    
    try {
      const u = new URL(request.url);
      const isHttps = (u.protocol === 'https:');
      const secureFlag = isHttps ? ' Secure;' : '';
      headers.set('Set-Cookie', `iding-session=; HttpOnly;${secureFlag} Path=/; SameSite=Strict; Max-Age=0`);
    } catch (_) {
      headers.set('Set-Cookie', 'iding-session=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0');
    }
    
    return new Response(JSON.stringify({ success: true }), { headers });
  });

  router.get('/api/session', async (context) => {
    const { request, env, authPayload } = context;
    const ADMIN_NAME = String(env.ADMIN_NAME || 'admin').trim().toLowerCase();
    
    if (!authPayload) {
      return new Response('Unauthorized', { status: 401 });
    }
    
    const strictAdmin = (authPayload.role === 'admin') && (
      String(authPayload.username || '').trim().toLowerCase() === ADMIN_NAME || 
      String(authPayload.username || '') === '__root__'
    );
    
    return Response.json({ 
      authenticated: true, 
      role: authPayload.role || 'admin', 
      username: authPayload.username || '', 
      strictAdmin 
    });
  });

  // =================== API路由委托 ===================
  router.get('/api/*', async (context) => {
    return await delegateApiRequest(context);
  });

  router.post('/api/*', async (context) => {
    return await delegateApiRequest(context);
  });

  router.patch('/api/*', async (context) => {
    return await delegateApiRequest(context);
  });

  // 支持 PUT 方法（如修改密码）
  router.put('/api/*', async (context) => {
    return await delegateApiRequest(context);
  });

  router.delete('/api/*', async (context) => {
    return await delegateApiRequest(context);
  });

  // =================== 邮件接收路由 ===================
  router.post('/receive', async (context) => {
    const { request, env, authPayload } = context;
    
    if (authPayload === false) {
      return new Response('Unauthorized', { status: 401 });
    }
    
    let DB;
    try {
      DB = await getDatabaseWithValidation(env);
    } catch (error) {
      console.error('邮件接收时数据库连接失败:', error.message);
      return new Response('数据库连接失败', { status: 500 });
    }
    
    return handleEmailReceive(request, DB, env);
  });

  return router;
}

/**
 * 委托API请求到原有的处理器
 * @param {object} context - 请求上下文
 * @returns {Promise<Response>} HTTP响应
 */
async function delegateApiRequest(context) {
  const { request, env, authPayload } = context;
  let DB;
  try {
    DB = await getDatabaseWithValidation(env);
  } catch (error) {
    console.error('API请求时数据库连接失败:', error.message);
    return new Response('数据库连接失败', { status: 500 });
  }
  
  // 支持多个域名：使用逗号/空格分隔
  const MAIL_DOMAINS = (env.MAIL_DOMAIN || 'temp.example.com')
    .split(/[,\s]+/)
    .map(d => d.trim())
    .filter(Boolean);
    
  // RESEND配置支持多种格式：
  // 1. 单一API密钥：直接填写密钥
  // 2. 多域名配置：域名=密钥的键值对格式，如 "domain1.com=key1,domain2.com=key2"
  // 3. JSON格式：{"domain1.com": "key1", "domain2.com": "key2"}
  const RESEND_API_KEY = env.RESEND_API_KEY || env.RESEND_TOKEN || env.RESEND || '';
  const ADMIN_NAME = String(env.ADMIN_NAME || 'admin').trim().toLowerCase();

  // 访客只允许读取模拟数据
  if ((authPayload.role || 'admin') === 'guest') {
    return handleApiRequest(request, DB, MAIL_DOMAINS, { 
      mockOnly: true, 
      resendApiKey: RESEND_API_KEY, 
      adminName: ADMIN_NAME, 
      r2: env.MAIL_EML, 
      authPayload 
    });
  }

  // 邮箱用户只能访问自己的邮箱数据
  if (authPayload.role === 'mailbox') {
    return handleApiRequest(request, DB, MAIL_DOMAINS, { 
      mockOnly: false, 
      resendApiKey: RESEND_API_KEY, 
      adminName: ADMIN_NAME, 
      r2: env.MAIL_EML, 
      authPayload,
      mailboxOnly: true
    });
  }
  
  return handleApiRequest(request, DB, MAIL_DOMAINS, { 
    mockOnly: false, 
    resendApiKey: RESEND_API_KEY, 
    adminName: ADMIN_NAME, 
    r2: env.MAIL_EML, 
    authPayload 
  });
}
