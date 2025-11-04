/**
 * 静态资源管理器模块
 * @module assets/manager
 */

import { resolveAuthPayload } from '../middleware/auth.js';

/**
 * 静态资源管理器
 */
export class AssetManager {
  constructor() {
    this.allowedPaths = new Set([
      '/',
      '/index.html',
      '/login',
      '/login.html',
      '/admin.html',
      '/html/mailboxes.html',
      '/mailboxes.html',
      '/mailbox.html',
      '/html/mailbox.html',
      '/templates/app.html',
      '/templates/footer.html',
      '/templates/loading.html',
      '/templates/loading-inline.html',
      '/templates/toast.html',
      '/app.js',
      '/app.css',
      '/admin.js',
      '/admin.css',
      '/login.js',
      '/login.css',
      '/mailbox.js',
      '/mock.js',
      '/favicon.svg',
      '/route-guard.js',
      '/app-router.js',
      '/app-mobile.js',
      '/app-mobile.css',
      '/mailbox.css',
      '/auth-guard.js',
      '/storage.js'
    ]);

    this.allowedPrefixes = [
      '/assets/',
      '/pic/',
      '/templates/',
      '/public/',
      '/js/',
      '/css/',
      '/html/'
    ];

    this.protectedPaths = new Set([
      '/admin.html',
      '/admin',
      '/admin/',
      '/mailboxes.html',
      '/html/mailboxes.html',
      '/mailbox.html',
      '/mailbox',
      '/mailbox/'
    ]);

    this.guestOnlyPaths = new Set([
      '/login',
      '/login.html'
    ]);
  }

  isPathAllowed(pathname) {
    if (this.allowedPaths.has(pathname)) {
      return true;
    }
    return this.allowedPrefixes.some(prefix => pathname.startsWith(prefix));
  }

  isProtectedPath(pathname) {
    return this.protectedPaths.has(pathname);
  }

  isGuestOnlyPath(pathname) {
    return this.guestOnlyPaths.has(pathname);
  }

  async handleAssetRequest(request, env, mailDomains) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const JWT_TOKEN = env.JWT_TOKEN || env.JWT_SECRET || '';

    if (!this.isPathAllowed(pathname)) {
      return await this.handleIllegalPath(request, env, JWT_TOKEN);
    }

    if (this.isProtectedPath(pathname)) {
      const authResult = await this.checkProtectedPathAuth(request, JWT_TOKEN, url);
      if (authResult) return authResult;
    }

    if (this.isGuestOnlyPath(pathname)) {
      const guestResult = await this.checkGuestOnlyPath(request, JWT_TOKEN, url);
      if (guestResult) return guestResult;
    }

    if (!env.ASSETS || !env.ASSETS.fetch) {
      return Response.redirect(new URL('/login.html', url).toString(), 302);
    }

    const mappedRequest = this.handlePathMapping(request, url);

    if (pathname === '/' || pathname === '/index.html') {
      return await this.handleIndexPage(mappedRequest, env, mailDomains, JWT_TOKEN);
    }

    if (pathname === '/admin.html') {
      return await this.handleAdminPage(mappedRequest, env, JWT_TOKEN);
    }

    if (pathname === '/mailbox.html' || pathname === '/html/mailbox.html') {
      return await this.handleMailboxPage(mappedRequest, env, JWT_TOKEN);
    }
    if (pathname === '/mailboxes.html' || pathname === '/html/mailboxes.html') {
      return await this.handleAllMailboxesPage(mappedRequest, env, JWT_TOKEN);
    }

    return env.ASSETS.fetch(mappedRequest);
  }

  async handleIllegalPath(request, env, JWT_TOKEN) {
    const url = new URL(request.url);
    const payload = await resolveAuthPayload(request, JWT_TOKEN);

    if (payload !== false) {
      if (payload.role === 'mailbox') {
        return Response.redirect(new URL('/html/mailbox.html', url).toString(), 302);
      } else {
        return Response.redirect(new URL('/', url).toString(), 302);
      }
    }

    return Response.redirect(new URL('/templates/loading.html', url).toString(), 302);
  }

  async checkProtectedPathAuth(request, JWT_TOKEN, url) {
    const payload = await resolveAuthPayload(request, JWT_TOKEN);

    if (!payload) {
      const loading = new URL('/templates/loading.html', url);
      if (url.pathname.includes('mailbox')) {
        loading.searchParams.set('redirect', '/html/mailbox.html');
      } else {
        loading.searchParams.set('redirect', '/admin.html');
      }
      return Response.redirect(loading.toString(), 302);
    }

    if (url.pathname.includes('mailbox')) {
      if (payload.role !== 'mailbox') {
        return Response.redirect(new URL('/', url).toString(), 302);
      }
      if (url.pathname === '/' || url.pathname === '/index.html') {
        return Response.redirect(new URL('/html/mailbox.html', url).toString(), 302);
      }
    } else {
      const isAllowed = (payload.role === 'admin' || payload.role === 'guest' || payload.role === 'mailbox');
      if (!isAllowed) {
        return Response.redirect(new URL('/', url).toString(), 302);
      }
    }

    return null;
  }

  async checkGuestOnlyPath(request, JWT_TOKEN, url) {
    const payload = await resolveAuthPayload(request, JWT_TOKEN);

    if (payload !== false) {
      return Response.redirect(new URL('/', url).toString(), 302);
    }

    return null;
  }

  handlePathMapping(request, url) {
    let targetUrl = url.toString();

    if (url.pathname === '/login') {
      targetUrl = new URL('/login.html', url).toString();
    }

    if (url.pathname === '/admin') {
      targetUrl = new URL('/html/admin.html', url).toString();
    }
    if (url.pathname === '/admin.html') {
      targetUrl = new URL('/html/admin.html', url).toString();
    }

    if (url.pathname === '/mailbox') {
      targetUrl = new URL('/html/mailbox.html', url).toString();
    }
    if (url.pathname === '/mailbox.html') {
      targetUrl = new URL('/html/mailbox.html', url).toString();
    }
    if (url.pathname === '/mailboxes.html') {
      targetUrl = new URL('/html/mailboxes.html', url).toString();
    }

    return new Request(targetUrl, request);
  }

  async handleIndexPage(request, env, mailDomains, JWT_TOKEN) {
    const url = new URL(request.url);
    const payload = await resolveAuthPayload(request, JWT_TOKEN);

    if (payload && payload.role === 'mailbox') {
      return Response.redirect(new URL('/html/mailbox.html', url).toString(), 302);
    }

    const resp = await env.ASSETS.fetch(request);

    try {
      const text = await resp.text();

      const injected = text.replace(
        '<meta name="mail-domains" content="">',
        `<meta name="mail-domains" content="${mailDomains.join(',')}">`
      );

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

  async handleAdminPage(request, env, JWT_TOKEN) {
    const url = new URL(request.url);
    const payload = await resolveAuthPayload(request, JWT_TOKEN);

    if (!payload) {
      const loadingReq = new Request(
        new URL('/templates/loading.html?redirect=%2Fadmin.html', url).toString(),
        request
      );
      return env.ASSETS.fetch(loadingReq);
    }

    const isAllowed = (payload.role === 'admin' || payload.role === 'guest' || payload.role === 'mailbox');
    if (!isAllowed) {
      return Response.redirect(new URL('/', url).toString(), 302);
    }

    return env.ASSETS.fetch(request);
  }

  async handleMailboxPage(request, env, JWT_TOKEN) {
    const url = new URL(request.url);
    const payload = await resolveAuthPayload(request, JWT_TOKEN);

    if (!payload) {
      const loadingReq = new Request(
        new URL('/templates/loading.html?redirect=%2Fhtml%2Fmailbox.html', url).toString(),
        request
      );
      return env.ASSETS.fetch(loadingReq);
    }

    if (payload.role !== 'mailbox') {
      if (payload.role === 'admin' || payload.role === 'guest') {
        return Response.redirect(new URL('/', url).toString(), 302);
      } else {
        return Response.redirect(new URL('/login.html', url).toString(), 302);
      }
    }

    return env.ASSETS.fetch(request);
  }

  async handleAllMailboxesPage(request, env, JWT_TOKEN) {
    const url = new URL(request.url);
    const payload = await resolveAuthPayload(request, JWT_TOKEN);
    if (!payload) {
      const loadingReq = new Request(
        new URL('/templates/loading.html?redirect=%2Fhtml%2Fmailboxes.html', url).toString(),
        request
      );
      return env.ASSETS.fetch(loadingReq);
    }
    const isStrictAdmin = (payload.role === 'admin' && (payload.username === '__root__' || payload.username));
    const isGuest = (payload.role === 'guest');
    if (!isStrictAdmin && !isGuest) {
      return Response.redirect(new URL('/', url).toString(), 302);
    }
    return env.ASSETS.fetch(request);
  }

  addAllowedPath(path) {
    this.allowedPaths.add(path);
  }

  addAllowedPrefix(prefix) {
    this.allowedPrefixes.push(prefix);
  }

  removeAllowedPath(path) {
    this.allowedPaths.delete(path);
  }

  isApiPath(pathname) {
    return pathname.startsWith('/api/') || pathname === '/receive';
  }

  getAccessLog(request) {
    const url = new URL(request.url);
    return {
      timestamp: new Date().toISOString(),
      method: request.method,
      path: url.pathname,
      userAgent: request.headers.get('User-Agent') || '',
      referer: request.headers.get('Referer') || '',
      ip: request.headers.get('CF-Connecting-IP') ||
        request.headers.get('X-Forwarded-For') ||
        request.headers.get('X-Real-IP') || 'unknown'
    };
  }
}

/**
 * 创建默认的资源管理器实例
 * @returns {AssetManager} 资源管理器实例
 */
export function createAssetManager() {
  return new AssetManager();
}
