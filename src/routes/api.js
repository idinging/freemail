/**
 * API 路由：全部委托到 src/api/index.js
 * @module routes/api
 */

import { Hono } from 'hono';
import { getInitializedDatabase } from '../db/index.js';
import { handleApiRequest } from '../api/index.js';

const router = new Hono();

router.get('/api/session', (c) => {
  const p = c.get('authPayload');
  if (!p) return c.text('Unauthorized', 401);
  const ADMIN_NAME = String(c.env.ADMIN_NAME || 'admin').trim().toLowerCase();
  const resp = {
    authenticated: true,
    role: p.role || 'admin',
    username: p.username || '',
    strictAdmin: (p.role === 'admin') && (
      String(p.username || '').trim().toLowerCase() === ADMIN_NAME ||
      String(p.username || '') === '__root__'
    )
  };
  if (p.role === 'mailbox' && p.mailboxAddress) resp.mailboxAddress = p.mailboxAddress;
  return c.json(resp);
});

router.all('/api/*', async (c) => {
  const authPayload = c.get('authPayload');
  let DB;
  try { DB = await getInitializedDatabase(c.env); } catch (_) { return c.text('数据库连接失败', 500); }

  const MAIL_DOMAINS = (c.env.MAIL_DOMAIN || 'temp.example.com').split(/[,\s]+/).map(d => d.trim()).filter(Boolean);
  const baseOpts = {
    mockOnly: false,
    resendApiKey: c.env.RESEND_API_KEY || c.env.RESEND_TOKEN || c.env.RESEND || '',
    sendflareApiKey: c.env.SENDFLARE_API_KEY || c.env.SENDFLARE_TOKEN || '',
    cyberpersonsApiKey: c.env.CYBERPERSONS_API_KEY || c.env.CYBERPERSONS_API_TOKEN || c.env.CYBERPERSONS || '',
    adminName: String(c.env.ADMIN_NAME || 'admin').trim().toLowerCase(),
    r2: c.env.MAIL_EML,
    authPayload
  };

  if ((authPayload?.role || 'admin') === 'guest') {
    return handleApiRequest(c.req.raw, DB, MAIL_DOMAINS, { ...baseOpts, mockOnly: true });
  }
  if (authPayload?.role === 'mailbox') {
    return handleApiRequest(c.req.raw, DB, MAIL_DOMAINS, { ...baseOpts, mailboxOnly: true });
  }
  return handleApiRequest(c.req.raw, DB, MAIL_DOMAINS, baseOpts);
});

export default router;
