import { initDatabase } from './database.js';
import { handleApiRequest, handleEmailReceive } from './apiHandlers.js';
import { extractEmail } from './commonUtils.js';
import { forwardByLocalPart } from './emailForwarder.js';
import { parseEmailBody, extractVerificationCode } from './emailParser.js';
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

// JWT缓存验证函数
async function verifyJwtWithCache(JWT_TOKEN, cookieHeader){
  const token = (cookieHeader.split(';').find(s=>s.trim().startsWith('mailfree-session='))||'').split('=')[1] || '';
  if (!globalThis.__JWT_CACHE__) globalThis.__JWT_CACHE__ = new Map();
  
  // 清理过期缓存项
  const now = Date.now();
  for (const [key, value] of globalThis.__JWT_CACHE__.entries()) {
    if (value.exp <= now) {
      globalThis.__JWT_CACHE__.delete(key);
    }
  }
  
  let payload = false;
  if (token && globalThis.__JWT_CACHE__.has(token)){
    const cached = globalThis.__JWT_CACHE__.get(token);
    if (cached.exp > now) {
      payload = cached.payload;
    } else {
      globalThis.__JWT_CACHE__.delete(token);
    }
  }
  
  if (!payload){
    payload = JWT_TOKEN ? await verifyJwt(JWT_TOKEN, cookieHeader) : false;
    if (token && payload){ 
      globalThis.__JWT_CACHE__.set(token, { payload, exp: now + 30*60*1000 }); 
    }
  }
  
  return payload;
}

// 超级管理员直通：当请求携带与 env.JWT_TOKEN 相同的令牌时，直接视为最高管理员
function checkRootAdminOverride(request, JWT_TOKEN){
  try{
    if (!JWT_TOKEN) return null;
    const auth = request.headers.get('Authorization') || request.headers.get('authorization') || '';
    const xToken = request.headers.get('X-Admin-Token') || request.headers.get('x-admin-token') || '';
    let urlToken = '';
    try{ const u = new URL(request.url); urlToken = u.searchParams.get('admin_token') || ''; }catch(_){ }
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (bearer && bearer === JWT_TOKEN) return { role: 'admin', username: '__root__', userId: 0 };
    if (xToken && xToken === JWT_TOKEN) return { role: 'admin', username: '__root__', userId: 0 };
    if (urlToken && urlToken === JWT_TOKEN) return { role: 'admin', username: '__root__', userId: 0 };
    return null;
  }catch(_){ return null; }
}

async function resolveAuthPayload(request, JWT_TOKEN){
  const root = checkRootAdminOverride(request, JWT_TOKEN);
  if (root) return root;
  return await verifyJwtWithCache(JWT_TOKEN, request.headers.get('Cookie') || '');
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

    // 缓存数据库初始化，避免每次请求重复执行
    if (!globalThis.__DB_INITED__) {
      await initDatabase(DB);
      globalThis.__DB_INITED__ = true;
    }

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
          headers.set('Set-Cookie', buildSessionCookie(token, request.url));
          return new Response(JSON.stringify({ success: true, role: 'admin', can_send: 1, mailbox_limit: 9999 }), { headers });
        }

        // 2) 访客：用户名为 guest 且密码匹配 GUEST_PASSWORD
        if (name === 'guest' && GUEST_PASSWORD && password === GUEST_PASSWORD){
          const token = await createJwt(JWT_TOKEN, { role: 'guest', username: 'guest' });
          const headers = new Headers({ 'Content-Type': 'application/json' });
          headers.set('Set-Cookie', buildSessionCookie(token, request.url));
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
              headers.set('Set-Cookie', buildSessionCookie(token, request.url));
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
      // expire cookie（与设置时相同的 Secure 规则）
      try{
        const u = new URL(request.url);
        const isHttps = (u.protocol === 'https:');
        const secureFlag = isHttps ? ' Secure;' : '';
        headers.set('Set-Cookie', `mailfree-session=; HttpOnly;${secureFlag} Path=/; SameSite=Strict; Max-Age=0`);
      }catch(_){
        headers.set('Set-Cookie', 'mailfree-session=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0');
      }
      return new Response(JSON.stringify({ success: true }), { headers });
    }
    if (url.pathname === '/api/session' && request.method === 'GET') {
      const payload = await resolveAuthPayload(request, JWT_TOKEN);
      if (!payload) return new Response('Unauthorized', { status: 401 });
      const strictAdmin = (payload.role === 'admin') && (
        String(payload.username || '').trim().toLowerCase() === ADMIN_NAME || String(payload.username||'') === '__root__'
      );
      return Response.json({ authenticated: true, role: payload.role || 'admin', username: payload.username || '', strictAdmin });
    }

    // Protect API routes
    if (url.pathname.startsWith('/api/')) {
      const payload = await resolveAuthPayload(request, JWT_TOKEN);
      if (!payload) return new Response('Unauthorized', { status: 401 });
      // 访客只允许读取模拟数据
      if ((payload.role || 'admin') === 'guest') {
        return handleApiRequest(request, DB, MAIL_DOMAINS, { mockOnly: true, resendApiKey: RESEND_API_KEY, adminName: String(env.ADMIN_NAME || 'admin').trim().toLowerCase(), r2: env.MAIL_EML, authPayload: payload });
      }
      return handleApiRequest(request, DB, MAIL_DOMAINS, { mockOnly: false, resendApiKey: RESEND_API_KEY, adminName: String(env.ADMIN_NAME || 'admin').trim().toLowerCase(), r2: env.MAIL_EML, authPayload: payload });
    }

    if (request.method === 'POST' && url.pathname === '/receive') {
      // 可选：保护该端点，避免被滥用
      const payload = await resolveAuthPayload(request, JWT_TOKEN);
      if (payload === false) return new Response('Unauthorized', { status: 401 });
      return handleEmailReceive(request, DB, env);
    }

    // 访问首页直接交给静态资源处理（由前端再判断登录态），避免新登录后缓存未热导致的循环跳转
    // （下方 Assets 分支会再做一次未认证时的模板替换，以兜底首次进入场景）

    // 访问管理页（/admin、/admin/ 或 /admin.html）时进行鉴权（未认证/权限不足均不直出）
    if (url.pathname === '/admin' || url.pathname === '/admin/' || url.pathname === '/admin.html') {
      const payload = await resolveAuthPayload(request, JWT_TOKEN);
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
      const payload = await resolveAuthPayload(request, JWT_TOKEN);
      if (payload !== false) {
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
        // 对未知路径，先检查登录状态
        const payload = await resolveAuthPayload(request, JWT_TOKEN);
        if (payload !== false) {
          // 已登录用户：重定向到首页而不是loading页面
          return Response.redirect(new URL('/', url).toString(), 302);
        }
        // 未登录：进入loading页面进行认证检查
        return Response.redirect(new URL('/templates/loading.html', url).toString(), 302);
      }
      // 兼容 /login 路由 → /login.html（登录状态检查已在上方处理）
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
          const payload = await resolveAuthPayload(request, JWT_TOKEN);
          // 若未认证，由前端路由守卫完成跳转，避免登录后因为缓存未热而循环；此处直接返回 index
          if (payload === false) {
            const injected2 = text.replace('<meta name="mail-domains" content="">', `<meta name="mail-domains" content="${MAIL_DOMAINS.join(',')}">`);
            return new Response(injected2, {
              headers: {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
              }
            });
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
        const payload = await resolveAuthPayload(request, JWT_TOKEN);
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

      // 读取原始 EML（用于存入 R2）与解析文本/HTML 以生成摘要
      let textContent = '';
      let htmlContent = '';
      let rawBuffer = null;
      try {
        const resp = new Response(message.raw);
        rawBuffer = await resp.arrayBuffer();
        const rawText = await new Response(rawBuffer).text();
        const parsed = parseEmailBody(rawText);
        textContent = parsed.text || '';
        htmlContent = parsed.html || '';
        if (!textContent && !htmlContent) textContent = (rawText || '').slice(0, 100000);
      } catch (_) {
        textContent = '';
        htmlContent = '';
      }

      const mailbox = extractEmail(resolvedRecipient || toHeader);
      const sender = extractEmail(fromHeader);

      // 写入到 R2：完整 EML
      const r2 = env.MAIL_EML;
      let objectKey = '';
      try {
        const now = new Date();
        const y = now.getUTCFullYear();
        const m = String(now.getUTCMonth() + 1).padStart(2, '0');
        const d = String(now.getUTCDate()).padStart(2, '0');
        const hh = String(now.getUTCHours()).padStart(2, '0');
        const mm = String(now.getUTCMinutes()).padStart(2, '0');
        const ss = String(now.getUTCSeconds()).padStart(2, '0');
        const keyId = (globalThis.crypto?.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const safeMailbox = (mailbox || 'unknown').toLowerCase().replace(/[^a-z0-9@._-]/g, '_');
        objectKey = `${y}/${m}/${d}/${safeMailbox}/${hh}${mm}${ss}-${keyId}.eml`;
        if (r2 && rawBuffer) {
          await r2.put(objectKey, new Uint8Array(rawBuffer), { httpMetadata: { contentType: 'message/rfc822' } });
        }
      } catch (e) {
        console.error('R2 put failed:', e);
      }

      // 生成摘要与验证码（可选）
      const preview = (() => {
        const plain = textContent && textContent.trim() ? textContent : (htmlContent || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        return String(plain || '').slice(0, 120);
      })();
      let verificationCode = '';
      try {
        verificationCode = extractVerificationCode({ subject, text: textContent, html: htmlContent });
      } catch (_) {}

      // 写入新表结构（仅主要信息 + R2 引用）
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

      // 收件人（逗号拼接）
      let toAddrs = '';
      try {
        const toValue = message.to;
        if (Array.isArray(toValue)) {
          toAddrs = toValue.map(v => (typeof v === 'string' ? v : (v?.address || ''))).filter(Boolean).join(',');
        } else if (typeof toValue === 'string') {
          toAddrs = toValue;
        } else {
          toAddrs = resolvedRecipient || toHeader || '';
        }
      } catch (_) {
        toAddrs = resolvedRecipient || toHeader || '';
      }

      // 检测表列，兼容旧结构（content NOT NULL）和新结构
      let cols = [];
      try {
        const info = await DB.prepare('PRAGMA table_info(messages)').all();
        cols = (info?.results || []).map(r => ({ name: (r.name || r['name']), notnull: r.notnull ? 1 : 0 }));
      } catch (_) {}
      const colSet = new Set(cols.map(c => c.name));
      const requiresContent = cols.some(c => c.name === 'content' && c.notnull === 1);

      const insertCols = ['mailbox_id', 'sender'];
      const values = [mailboxId, sender];
      if (colSet.has('to_addrs')) { insertCols.push('to_addrs'); values.push(String(toAddrs || '')); }
      insertCols.push('subject'); values.push(subject || '(无主题)');
      if (colSet.has('verification_code')) { insertCols.push('verification_code'); values.push(verificationCode || null); }
      if (colSet.has('preview')) { insertCols.push('preview'); values.push(preview || null); }
      if (colSet.has('r2_bucket')) { insertCols.push('r2_bucket'); values.push('mail-eml'); }
      if (colSet.has('r2_object_key')) { insertCols.push('r2_object_key'); values.push(objectKey || ''); }
      if (requiresContent || colSet.has('content')) { insertCols.push('content'); values.push(textContent || htmlContent || subject || '(无内容)'); }
      if (colSet.has('html_content')) { insertCols.push('html_content'); values.push(htmlContent || null); }

      const placeholders = insertCols.map(()=>'?').join(', ');
      const sql = `INSERT INTO messages (${insertCols.join(', ')}) VALUES (${placeholders})`;
      await DB.prepare(sql).bind(...values).run();
    } catch (err) {
      console.error('Email event handling error:', err);
    }
  }
};

