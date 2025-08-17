import { initDatabase } from './database.js';
import { handleApiRequest, handleEmailReceive } from './apiHandlers.js';
import { extractEmail } from './commonUtils.js';
import { forwardByLocalPart } from './emailForwarder.js';
import { parseEmailBody } from './emailParser.js';
import { createJwt, verifyJwt, buildSessionCookie } from './authentication.js';

async function sha256Hex(text){
  const enc = new TextEncoder();
  const data = enc.encode(String(text || ''));
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

async function verifyPassword(rawPassword, hashed){
  if (!hashed) return false;
  try{
    const hex = (await sha256Hex(rawPassword)).toLowerCase();
    return hex === String(hashed || '').toLowerCase();
  }catch(_){ return false; }
}

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
    const ADMIN_NAME = String(env.ADMIN_NAME || 'admin').trim().toLowerCase();
    const GUEST_PASSWORD = env.GUEST_PASSWORD || '';
    const JWT_TOKEN = env.JWT_TOKEN || env.JWT_SECRET || '';
    const RESEND_API_KEY = env.RESEND_API_KEY || env.RESEND_TOKEN || env.RESEND || '';

    await initDatabase(DB);

    // Auth endpoints
    if (url.pathname === '/api/login' && request.method === 'POST') {
      try {
        const body = await request.json();
        const name = String(body.username || '').trim().toLowerCase();
        const password = String(body.password || '').trim();
        if (!name || !password) return new Response('用户名或密码不能为空', { status: 400 });

        // 1) 管理员：用户名匹配 ADMIN_NAME + 密码匹配 ADMIN_PASSWORD
        if (name === ADMIN_NAME && ADMIN_PASSWORD && password === ADMIN_PASSWORD){
          // 为严格管理员确保有一个数据库中的用户行，以便使用用户级功能（如置顶）
          let adminUserId = 0;
          try{
            const u = await DB.prepare('SELECT id FROM users WHERE username = ?').bind(ADMIN_NAME).all();
            if (u?.results?.length){
              adminUserId = Number(u.results[0].id);
            } else {
              await DB.prepare("INSERT INTO users (username, role, can_send, mailbox_limit) VALUES (?, 'admin', 1, 9999)").bind(ADMIN_NAME).run();
              const again = await DB.prepare('SELECT id FROM users WHERE username = ?').bind(ADMIN_NAME).all();
              adminUserId = Number(again?.results?.[0]?.id || 0);
            }
          }catch(_){ adminUserId = 0; }

          const token = await createJwt(JWT_TOKEN, { role: 'admin', username: ADMIN_NAME, userId: adminUserId });
          const headers = new Headers({ 'Content-Type': 'application/json' });
          headers.set('Set-Cookie', buildSessionCookie(token));
          return new Response(JSON.stringify({ success: true, role: 'admin', can_send: 1, mailbox_limit: 9999 }), { headers });
        }

        // 2) 访客：用户名为 guest 且密码匹配 GUEST_PASSWORD
        if (name === 'guest' && GUEST_PASSWORD && password === GUEST_PASSWORD){
          const token = await createJwt(JWT_TOKEN, { role: 'guest', username: 'guest' });
          const headers = new Headers({ 'Content-Type': 'application/json' });
          headers.set('Set-Cookie', buildSessionCookie(token));
          return new Response(JSON.stringify({ success: true, role: 'guest' }), { headers });
        }

        // 3) 普通用户：查询 users 表校验用户名与密码
        try{
          const { results } = await DB.prepare('SELECT id, password_hash, role, mailbox_limit, can_send FROM users WHERE username = ?').bind(name).all();
          if (results && results.length){
            const row = results[0];
            const ok = await verifyPassword(password, row.password_hash || '');
            if (ok){
              const role = (row.role === 'admin') ? 'admin' : 'user';
              const token = await createJwt(JWT_TOKEN, { role, username: name, userId: row.id });
              const headers = new Headers({ 'Content-Type': 'application/json' });
              headers.set('Set-Cookie', buildSessionCookie(token));
              // 二级管理员 admin 默认允许发件；普通用户 user 默认不允许发件
              const canSend = role === 'admin' ? 1 : (row.can_send ? 1 : 0);
              const mailboxLimit = role === 'admin' ? (row.mailbox_limit || 20) : (row.mailbox_limit || 10);
              return new Response(JSON.stringify({ success: true, role, can_send: canSend, mailbox_limit: mailboxLimit }), { headers });
            }
          }
        }catch(_){ /* ignore and fallback unauthorized */ }

        return new Response('用户名或密码错误', { status: 401 });
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
      if (!payload) return new Response('Unauthorized', { status: 401 });
      const strictAdmin = (payload.role === 'admin') && (String(payload.username || '').trim().toLowerCase() === ADMIN_NAME);
      return Response.json({ authenticated: true, role: payload.role || 'admin', username: payload.username || '', strictAdmin });
    }

    // Protect API routes
    if (url.pathname.startsWith('/api/')) {
      const payload = JWT_TOKEN ? await verifyJwt(JWT_TOKEN, request.headers.get('Cookie') || '') : false;
      if (!payload) return new Response('Unauthorized', { status: 401 });
      // 访客只允许读取模拟数据
      if ((payload.role || 'admin') === 'guest') {
        return handleApiRequest(request, DB, MAIL_DOMAINS, { mockOnly: true, resendApiKey: RESEND_API_KEY, adminName: String(env.ADMIN_NAME || 'admin').trim().toLowerCase() });
      }
      return handleApiRequest(request, DB, MAIL_DOMAINS, { mockOnly: false, resendApiKey: RESEND_API_KEY, adminName: String(env.ADMIN_NAME || 'admin').trim().toLowerCase() });
    }

    if (request.method === 'POST' && url.pathname === '/receive') {
      // 可选：保护该端点，避免被滥用
      const isOk = JWT_TOKEN ? await verifyJwt(JWT_TOKEN, request.headers.get('Cookie') || '') : false;
      if (!isOk) return new Response('Unauthorized', { status: 401 });
      return handleEmailReceive(request, DB);
    }

    // 访问首页（/ 或 /index.html）时，未认证跳转到加载页面
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const isOk = JWT_TOKEN ? await verifyJwt(JWT_TOKEN, request.headers.get('Cookie') || '') : false;
      if (!isOk) {
        const loadingUrl = new URL('/templates/loading.html', url).toString();
        return Response.redirect(loadingUrl, 302);
      }
    }

    // 访问管理页（/admin、/admin/ 或 /admin.html）时进行鉴权（未认证/权限不足均不直出）
    if (url.pathname === '/admin' || url.pathname === '/admin/' || url.pathname === '/admin.html') {
      const payload = JWT_TOKEN ? await verifyJwt(JWT_TOKEN, request.headers.get('Cookie') || '') : false;
      if (!payload) {
        const loading = new URL('/templates/loading.html', url);
        loading.searchParams.set('redirect', '/admin.html');
        return Response.redirect(loading.toString(), 302);
      }
      const isAllowed = (payload.role === 'admin' || payload.role === 'guest');
      if (!isAllowed) {
        // 已登录但权限不足：引导回首页，防止管理页直出
        return Response.redirect(new URL('/', url).toString(), 302);
      }
    }

    // 访问登录页（/login 或 /login.html）时，若已登录则跳转到首页
    if (url.pathname === '/login' || url.pathname === '/login.html') {
      const isOk = JWT_TOKEN ? await verifyJwt(JWT_TOKEN, request.headers.get('Cookie') || '') : false;
      if (isOk) {
        // 已登录：服务端直接重定向到首页，避免先渲染登录页
        return Response.redirect(new URL('/', url).toString(), 302);
      }
    }

    // 其余请求交给静态资源（Workers + Assets）
    if (env.ASSETS && env.ASSETS.fetch) {
      // 简单非法路径拦截：对明显不存在的页面引导到 loading（前端再判断登录态）
      const known = new Set([
        '/', '/index.html', '/login', '/login.html', '/admin.html',
        '/templates/app.html', '/templates/footer.html', '/templates/loading.html',
        '/app.js', '/app.css', '/admin.js', '/admin.css', '/mock.js', '/favicon.svg', '/route-guard.js'
      ]);
      if (!known.has(url.pathname)
          && !url.pathname.startsWith('/api/')
          && !url.pathname.startsWith('/assets/')
          && !url.pathname.startsWith('/pic/')
          && !url.pathname.startsWith('/templates/')
          && !url.pathname.startsWith('/public/')
      ){
        return Response.redirect(new URL('/templates/loading.html', url).toString(), 302);
      }
      // 兼容 /login 路由 → /login.html
      if (url.pathname === '/login') {
        const htmlUrl = new URL('/login.html', url);
        const req = new Request(htmlUrl.toString(), request);
        return env.ASSETS.fetch(req);
      }
      // 兼容 /admin 路由 → /admin.html（仅作为静态路由映射；鉴权在上方逻辑已处理）
      if (url.pathname === '/admin') {
        const htmlUrl = new URL('/admin.html', url);
        const req = new Request(htmlUrl.toString(), request);
        return env.ASSETS.fetch(req);
      }
      // 为前端注入域名列表到 index.html 的 meta，并禁用 HTML 缓存；
      // 若未认证则直接改写 index.html 为 loading.html，以完全避免首页闪现
      if (url.pathname === '/' || url.pathname === '/index.html') {
        const resp = await env.ASSETS.fetch(request);
        try {
          const text = await resp.text();
          const isOk = JWT_TOKEN ? await verifyJwt(JWT_TOKEN, request.headers.get('Cookie') || '') : false;
          if (!isOk) {
            // 未认证用户直接返回 loading 模板内容
            const loadingReq = new Request(new URL('/templates/loading.html', url).toString(), request);
            return env.ASSETS.fetch(loadingReq);
          }
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
      // 管理页：未认证或权限不足直接返回 loading 或重定向，防止静态文件直出
      if (url.pathname === '/admin.html') {
        const payload = JWT_TOKEN ? await verifyJwt(JWT_TOKEN, request.headers.get('Cookie') || '') : false;
        if (!payload) {
          const loadingReq = new Request(new URL('/templates/loading.html?redirect=%2Fadmin.html', url).toString(), request);
          return env.ASSETS.fetch(loadingReq);
        }
        const isAllowed = (payload.role === 'admin' || payload.role === 'guest');
        if (!isAllowed) {
          // 返回首页
          return Response.redirect(new URL('/', url).toString(), 302);
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

