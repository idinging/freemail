import { initDatabase } from './db.js';
import { handleApiRequest, handleEmailReceive } from './handlers.js';
import { extractEmail } from './utils.js';
import { forwardByLocalPart } from './forwarder.js';
import { parseEmailBody } from './emailParser.js';
import { createJwt, verifyJwt, buildSessionCookie } from './auth.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const DB = env.TEMP_MAIL_DB;
    // 支持多个域名：使用逗号/空格分隔，创建地址时取第一个为默认显示
    const MAIL_DOMAINS = (env.MAIL_DOMAIN || 'temp.example.com')
      .split(/[,\s]+/)
      .map(d => d.trim())
      .filter(Boolean);
    const MAIL_DOMAIN = MAIL_DOMAINS[0] || 'temp.example.com';
    // 兼容多种命名，优先读取 Cloudflare Secrets/Vars
    const ADMIN_PASSWORD = env.ADMIN_PASSWORD || env.ADMIN_PASS || '';
    const GUEST_PASSWORD = env.GUEST_PASSWORD || '';
    const JWT_TOKEN = env.JWT_TOKEN || env.JWT_SECRET || '';
    const RESEND_API_KEY = env.RESEND_API_KEY || env.RESEND_TOKEN || env.RESEND || '';

    await initDatabase(DB);

    // Auth endpoints
    if (url.pathname === '/api/login' && request.method === 'POST') {
      try {
        const { password } = await request.json();
        if (!password) return new Response('Unauthorized', { status: 401 });
        // 管理员密码
        if (password === ADMIN_PASSWORD) {
          const token = await createJwt(JWT_TOKEN, { role: 'admin' });
          const headers = new Headers({ 'Content-Type': 'application/json' });
          headers.set('Set-Cookie', buildSessionCookie(token));
          return new Response(JSON.stringify({ success: true, role: 'admin' }), { headers });
        }
        // 访客密码
        if (GUEST_PASSWORD && password === GUEST_PASSWORD) {
          const token = await createJwt(JWT_TOKEN, { role: 'guest' });
          const headers = new Headers({ 'Content-Type': 'application/json' });
          headers.set('Set-Cookie', buildSessionCookie(token));
          return new Response(JSON.stringify({ success: true, role: 'guest' }), { headers });
        }
        // 错误密码
        return new Response('Unauthorized', { status: 401 });
      } catch (_) {
        return new Response('Bad Request', { status: 400 });
      }
    }
    if (url.pathname === '/api/logout' && request.method === 'POST') {
      const headers = new Headers({ 'Content-Type': 'application/json' });
      // expire cookie
      headers.set('Set-Cookie', 'mailfree-session=; HttpOnly; Secure; Path=/; SameSite=Strict; Max-Age=0');
      return new Response(JSON.stringify({ success: true }), { headers });
    }
    if (url.pathname === '/api/session' && request.method === 'GET') {
      const payload = JWT_TOKEN ? await verifyJwt(JWT_TOKEN, request.headers.get('Cookie') || '') : false;
      return payload ? Response.json({ authenticated: true, role: payload.role || 'admin' }) : new Response('Unauthorized', { status: 401 });
    }

    // Protect API routes
    if (url.pathname.startsWith('/api/')) {
      const payload = JWT_TOKEN ? await verifyJwt(JWT_TOKEN, request.headers.get('Cookie') || '') : false;
      if (!payload) return new Response('Unauthorized', { status: 401 });
      // 访客只允许读取模拟数据
      if ((payload.role || 'admin') === 'guest') {
        return handleApiRequest(request, DB, MAIL_DOMAINS, { mockOnly: true, resendApiKey: RESEND_API_KEY });
      }
      return handleApiRequest(request, DB, MAIL_DOMAINS, { mockOnly: false, resendApiKey: RESEND_API_KEY });
    }

    if (request.method === 'POST' && url.pathname === '/receive') {
      // 可选：保护该端点，避免被滥用
      const isOk = JWT_TOKEN ? await verifyJwt(JWT_TOKEN, request.headers.get('Cookie') || '') : false;
      if (!isOk) return new Response('Unauthorized', { status: 401 });
      return handleEmailReceive(request, DB);
    }

    // 访问首页（/ 或 /index.html）时，未认证跳登录
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const isOk = JWT_TOKEN ? await verifyJwt(JWT_TOKEN, request.headers.get('Cookie') || '') : false;
      if (!isOk) {
        const loginUrl = new URL('/login.html', url).toString();
        return Response.redirect(loginUrl, 302);
      }
    }

    // 其余请求交给静态资源（Workers + Assets）
    if (env.ASSETS && env.ASSETS.fetch) {
      // 兼容 /login 路由 → /login.html
      if (url.pathname === '/login') {
        const htmlUrl = new URL('/login.html', url);
        const req = new Request(htmlUrl.toString(), request);
        return env.ASSETS.fetch(req);
      }
      // 为前端注入域名列表到 index.html 的 meta，并禁用 HTML 缓存，避免旧版本被缓存
      if (url.pathname === '/' || url.pathname === '/index.html') {
        const resp = await env.ASSETS.fetch(request);
        try {
          const text = await resp.text();
          const injected = text.replace('<meta name="mail-domains" content="">', `<meta name="mail-domains" content="${MAIL_DOMAINS.join(',')}">`);
          return new Response(injected, { 
            headers: { 
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
            } 
          });
        } catch (_) {
          return resp;
        }
      }
      return env.ASSETS.fetch(request);
    }
    // 没有静态资源绑定时，统一跳登录页
    return Response.redirect(new URL('/login.html', url).toString(), 302);
  },

  async email(message, env, ctx) {
    const DB = env.TEMP_MAIL_DB;
    await initDatabase(DB);

    try {
      const headers = message.headers;
      const toHeader = headers.get('to') || headers.get('To') || '';
      const fromHeader = headers.get('from') || headers.get('From') || '';
      const subject = headers.get('subject') || headers.get('Subject') || '(无主题)';

      let envelopeTo = '';
      try {
        const toValue = message.to;
        if (Array.isArray(toValue) && toValue.length > 0) {
          envelopeTo = typeof toValue[0] === 'string' ? toValue[0] : (toValue[0].address || '');
        } else if (typeof toValue === 'string') {
          envelopeTo = toValue;
        }
      } catch (_) {}

      const resolvedRecipient = (envelopeTo || toHeader || '').toString();
      const resolvedRecipientAddr = extractEmail(resolvedRecipient);
      const localPart = (resolvedRecipientAddr.split('@')[0] || '').toLowerCase();

      forwardByLocalPart(message, localPart, ctx, env);

      let textContent = '';
      let htmlContent = '';
      try {
        const rawText = await new Response(message.raw).text();
        const parsed = parseEmailBody(rawText);
        textContent = parsed.text || '';
        htmlContent = parsed.html || '';
        // 极端情况下两者都为空，兜底将原文作为 text 保存，避免 NULL
        if (!textContent && !htmlContent) textContent = rawText.slice(0, 100000);
      } catch (_) {
        textContent = '';
        htmlContent = '';
      }

      const mailbox = extractEmail(resolvedRecipient || toHeader);
      const sender = extractEmail(fromHeader);

      // 写入新表结构
      const resMb = await DB.prepare('SELECT id FROM mailboxes WHERE address = ?').bind(mailbox.toLowerCase()).all();
      let mailboxId;
      if (Array.isArray(resMb?.results) && resMb.results.length) {
        mailboxId = resMb.results[0].id;
      } else {
        const [localPart, domain] = (mailbox || '').toLowerCase().split('@');
        if (localPart && domain) {
          await DB.prepare('INSERT INTO mailboxes (address, local_part, domain, last_accessed_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)')
            .bind((mailbox || '').toLowerCase(), localPart, domain).run();
          const created = await DB.prepare('SELECT id FROM mailboxes WHERE address = ?').bind((mailbox || '').toLowerCase()).all();
          mailboxId = created?.results?.[0]?.id;
        }
      }
      if (!mailboxId) throw new Error('无法解析或创建 mailbox 记录');

      await DB.prepare(`
        INSERT INTO messages (mailbox_id, sender, subject, content, html_content)
        VALUES (?, ?, ?, ?, ?)
      `).bind(mailboxId, sender, subject, textContent || htmlContent || '(无内容)', htmlContent || null).run();
    } catch (err) {
      console.error('Email event handling error:', err);
    }
  }
};

