/**
 * Hono 应用中间件
 * @module middleware/app
 * 
 */

import { verifyJwtWithCache, checkRootAdminOverride } from './auth.js';

export function authMiddleware() {
  return async (c, next) => {
    const token = c.env.JWT_TOKEN || c.env.JWT_SECRET || '';
    const root = checkRootAdminOverride(c.req.raw, token);
    if (root) { c.set('authPayload', root); return next(); }
    const payload = await verifyJwtWithCache(token, c.req.header('Cookie') || '');
    if (!payload) return c.text('Unauthorized', 401);
    c.set('authPayload', payload);
    return next();
  };
}

export function rateLimiter({ windowMs = 60_000, max = 100 } = {}) {
  const store = new Map();
  const banned = new Map();
  let cleanupCounter = 0;
  return async (c, next) => {
    const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
    const now = Date.now();

    // 检查临时封禁
    const banEntry = banned.get(ip);
    if (banEntry && banEntry.until > now) {
      return c.text('Too Many Requests', 429);
    }
    if (banEntry && banEntry.until <= now) {
      banned.delete(ip);
    }

    const key = `${ip}:${c.req.path}`;
    let e = store.get(key);
    if (!e || e.resetAt < now) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (++e.count > max) {
      // 超额后临时封禁该 IP（指数退避：首次 30s，后续加倍）
      const prevBan = banned.get(ip);
      const duration = prevBan ? Math.min((prevBan.duration || 30_000) * 2, 600_000) : 30_000;
      banned.set(ip, { until: now + duration, duration });
      return c.text('Too Many Requests', 429);
    }

    // 每 10 次请求清理过期条目，防止内存泄漏
    cleanupCounter++;
    if (cleanupCounter % 10 === 0) {
      const cutoff = now - windowMs;
      for (const [k, v] of store) {
        if (v.resetAt < cutoff) store.delete(k);
      }
      for (const [k, v] of banned) {
        if (v.until < now) banned.delete(k);
      }
    }

    return next();
  };
}
