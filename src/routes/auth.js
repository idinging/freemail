/**
 * 认证相关路由：登录、登出、会话
 * @module routes/auth
 */

import { Hono } from 'hono';
import { getInitializedDatabase } from '../db/index.js';
import { createJwt, buildSessionCookie, verifyMailboxLogin, verifyPassword } from '../middleware/auth.js';
import { rateLimiter } from '../middleware/app.js';
import { invalidateSystemStatCache } from '../utils/cache.js';

const router = new Hono();

router.post('/api/logout', (c) => {
  const u = new URL(c.req.url);
  const isHttps = (u.protocol === 'https:');
  c.header('Set-Cookie', `iding-session=; HttpOnly;${isHttps ? ' Secure;' : ''} Path=/; SameSite=Strict; Max-Age=0`);
  return c.json({ success: true });
});

router.post('/api/login', rateLimiter({ windowMs: 60_000, max: 10 }), async (c) => {
  let DB;
  try {
    DB = await getInitializedDatabase(c.env);
  } catch (_) {
    return c.text('数据库连接失败', 500);
  }

  const ADMIN_NAME = String(c.env.ADMIN_NAME || 'admin').trim().toLowerCase();
  const ADMIN_PASSWORD = c.env.ADMIN_PASSWORD || c.env.ADMIN_PASS || '';
  const GUEST_PASSWORD = c.env.GUEST_PASSWORD || '';
  const JWT_TOKEN = c.env.JWT_TOKEN || c.env.JWT_SECRET || '';
  const SESSION_EXPIRE_DAYS = parseInt(c.env.SESSION_EXPIRE_DAYS, 10) || 7;

  let body;
  try { body = await c.req.json(); } catch (_) { return c.text('Bad Request', 400); }

  const name = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '').trim();
  if (!name || !password) return c.text('用户名或密码不能为空', 400);

  // 管理员
  if (name === ADMIN_NAME && ADMIN_PASSWORD && password === ADMIN_PASSWORD) {
    let adminUserId = 0;
    try {
      const u = await DB.prepare('SELECT id FROM users WHERE username = ?').bind(ADMIN_NAME).all();
      if (u?.results?.length) {
        adminUserId = Number(u.results[0].id);
      } else {
        await DB.prepare("INSERT INTO users (username, role, can_send, mailbox_limit) VALUES (?, 'admin', 1, 9999)")
          .bind(ADMIN_NAME).run();
        invalidateSystemStatCache('user_stats');
        const again = await DB.prepare('SELECT id FROM users WHERE username = ?').bind(ADMIN_NAME).all();
        adminUserId = Number(again?.results?.[0]?.id || 0);
      }
    } catch (_) { adminUserId = 0; }
    const token = await createJwt(JWT_TOKEN, { role: 'admin', username: ADMIN_NAME, userId: adminUserId }, SESSION_EXPIRE_DAYS);
    c.header('Set-Cookie', buildSessionCookie(token, c.req.url, SESSION_EXPIRE_DAYS));
    return c.json({ success: true, role: 'admin', can_send: 1, mailbox_limit: 9999 });
  }

  // 访客
  if (name === 'guest' && GUEST_PASSWORD && password === GUEST_PASSWORD) {
    const token = await createJwt(JWT_TOKEN, { role: 'guest', username: 'guest' }, SESSION_EXPIRE_DAYS);
    c.header('Set-Cookie', buildSessionCookie(token, c.req.url, SESSION_EXPIRE_DAYS));
    return c.json({ success: true, role: 'guest' });
  }

  // 普通用户
  try {
    const { results } = await DB.prepare(
      'SELECT id, password_hash, role, mailbox_limit, can_send FROM users WHERE username = ?'
    ).bind(name).all();
    if (results?.length) {
      const row = results[0];
      const pwResult = await verifyPassword(password, row.password_hash || '');
      if (pwResult.valid) {
        const role = (row.role === 'admin') ? 'admin' : 'user';
        const token = await createJwt(JWT_TOKEN, { role, username: name, userId: row.id }, SESSION_EXPIRE_DAYS);
        c.header('Set-Cookie', buildSessionCookie(token, c.req.url, SESSION_EXPIRE_DAYS));
        const canSend = role === 'admin' ? 1 : (row.can_send ? 1 : 0);
        const mailboxLimit = role === 'admin' ? (row.mailbox_limit || 20) : (row.mailbox_limit || 10);
        // 旧版 SHA-256 哈希自动迁移到 PBKDF2
        if (pwResult.newHash) {
          try { await DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(pwResult.newHash, row.id).run(); }
          catch (_) { /* 迁移失败不影响登录 */ }
        }
        return c.json({ success: true, role, can_send: canSend, mailbox_limit: mailboxLimit });
      }
    }
  } catch (_) { /* 继续 */ }

  // 邮箱登录
  try {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(name)) {
      const info = await verifyMailboxLogin(name, password, DB);
      if (info) {
        const token = await createJwt(JWT_TOKEN, {
          role: 'mailbox', username: name, mailboxId: info.id, mailboxAddress: info.address
        }, SESSION_EXPIRE_DAYS);
        c.header('Set-Cookie', buildSessionCookie(token, c.req.url, SESSION_EXPIRE_DAYS));
        return c.json({ success: true, role: 'mailbox', mailbox: info.address, can_send: 0, mailbox_limit: 1 });
      }
    }
  } catch (_) { /* 继续 */ }

  return c.text('用户名或密码错误', 401);
});

export default router;