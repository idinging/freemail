/**
 * Freemail 主入口
 * @module server
 */

import { Hono } from 'hono';
import { authMiddleware } from './middleware/app.js';
import authRoutes from './routes/auth.js';
import apiRoutes from './routes/api.js';
import staticRoutes from './routes/static.js';
import { handleEmailEvent } from './email/handler.js';

const app = new Hono();

// 全局安全响应头
app.use('*', async (c, next) => {
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'same-origin');
  c.header('X-Frame-Options', 'DENY');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (c.req.url.startsWith('https:')) {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  await next();
});

// 公开认证路由（/api/logout, /api/login）
app.route('/', authRoutes);

// 认证中间件
app.use('/api/*', authMiddleware());

// 受保护 API 路由（/api/session, /api/*）
app.route('/', apiRoutes);

// 静态资源路由（必须在最后）
app.route('/', staticRoutes);

export default {
  fetch: app.fetch,
  async email(message, env, ctx) {
    return handleEmailEvent(message, env, ctx);
  }
};