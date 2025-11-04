/**
 * 路由配置模块
 * @module routes
 */

import { Router, createJwt, buildSessionCookie, verifyMailboxLogin, authMiddleware } from '../middleware/index.js';
import { handleApiRequest } from '../api/index.js';
import { getDatabaseWithValidation } from '../db/index.js';
import { verifyPassword } from '../utils/common.js';
import { handleEmailReceive } from '../email/receiver.js';

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
    // 从环境变量读取会话过期天数，默认7天
    const SESSION_EXPIRE_DAYS = parseInt(env.SESSION_EXPIRE_DAYS, 10) || 7;

    try {
      const body = await request.json();
      const name = String(body.username || '').trim().toLowerCase();
      const password = String(body.password || '').trim();

      if (!name || !password) {
        return new Response('用户名或密码不能为空', { status: 400 });
      }

      // 1) 管理员
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

        const token = await createJwt(JWT_TOKEN, { role: 'admin', username: ADMIN_NAME, userId: adminUserId }, SESSION_EXPIRE_DAYS);
        const headers = new Headers({ 'Content-Type': 'application/json' });
        headers.set('Set-Cookie', buildSessionCookie(token, request.url, SESSION_EXPIRE_DAYS));
        return new Response(JSON.stringify({ success: true, role: 'admin', can_send: 1, mailbox_limit: 9999 }), { headers });
      }

      // 2) 访客
      if (name === 'guest' && GUEST_PASSWORD && password === GUEST_PASSWORD) {
        const token = await createJwt(JWT_TOKEN, { role: 'guest', username: 'guest' }, SESSION_EXPIRE_DAYS);
        const headers = new Headers({ 'Content-Type': 'application/json' });
        headers.set('Set-Cookie', buildSessionCookie(token, request.url, SESSION_EXPIRE_DAYS));
        return new Response(JSON.stringify({ success: true, role: 'guest' }), { headers });
      }

      // 3) 普通用户
      try {
        const { results } = await DB.prepare('SELECT id, password_hash, role, mailbox_limit, can_send FROM users WHERE username = ?').bind(name).all();
        if (results && results.length) {
          const row = results[0];
          const ok = await verifyPassword(password, row.password_hash || '');
          if (ok) {
            const role = (row.role === 'admin') ? 'admin' : 'user';
            const token = await createJwt(JWT_TOKEN, { role, username: name, userId: row.id }, SESSION_EXPIRE_DAYS);
            const headers = new Headers({ 'Content-Type': 'application/json' });
            headers.set('Set-Cookie', buildSessionCookie(token, request.url, SESSION_EXPIRE_DAYS));
            const canSend = role === 'admin' ? 1 : (row.can_send ? 1 : 0);
            const mailboxLimit = role === 'admin' ? (row.mailbox_limit || 20) : (row.mailbox_limit || 10);
            return new Response(JSON.stringify({ success: true, role, can_send: canSend, mailbox_limit: mailboxLimit }), { headers });
          }
        }
      } catch (_) {
        // 继续尝试邮箱登录
      }

      // 4) 邮箱登录
      try {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (emailRegex.test(name)) {
          const mailboxInfo = await verifyMailboxLogin(name, password, DB);
          if (mailboxInfo) {
            const token = await createJwt(JWT_TOKEN, {
              role: 'mailbox',
              username: name,
              mailboxId: mailboxInfo.id,
              mailboxAddress: mailboxInfo.address
            }, SESSION_EXPIRE_DAYS);
            const headers = new Headers({ 'Content-Type': 'application/json' });
            headers.set('Set-Cookie', buildSessionCookie(token, request.url, SESSION_EXPIRE_DAYS));
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
        // 继续
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

    const response = {
      authenticated: true,
      role: authPayload.role || 'admin',
      username: authPayload.username || '',
      strictAdmin
    };

    // 邮箱用户返回邮箱地址
    if (authPayload.role === 'mailbox' && authPayload.mailboxAddress) {
      response.mailboxAddress = authPayload.mailboxAddress;
    }

    return Response.json(response);
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

    const { handleEmailReceive } = await import('../email/receiver.js');
    return handleEmailReceive(request, DB, env);
  });

  return router;
}

/**
 * 委托API请求到处理器
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

  const MAIL_DOMAINS = (env.MAIL_DOMAIN || 'temp.example.com')
    .split(/[,\s]+/)
    .map(d => d.trim())
    .filter(Boolean);

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

export { authMiddleware };
