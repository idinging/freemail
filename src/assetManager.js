import { resolveAuthPayload } from './routes.js';

/**
 * 静态资源管理器
 * 负责处理静态资源的访问控制、路径验证和安全拦截
 */
export class AssetManager {
  constructor() {
    // 定义允许访问的静态资源路径
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

    // 定义允许的路径前缀
    this.allowedPrefixes = [
      '/assets/',
      '/pic/',
      '/templates/',
      '/public/',
      '/js/',
      '/css/',
      '/html/'
    ];

    // 需要权限验证的路径
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

    // 需要未登录状态的路径（登录页）
    this.guestOnlyPaths = new Set([
      '/login',
      '/login.html'
    ]);
  }

  /**
   * 检查路径是否被允许访问
   * @param {string} pathname - 请求路径
   * @returns {boolean} 是否允许访问
   */
  isPathAllowed(pathname) {
    // 检查精确匹配
    if (this.allowedPaths.has(pathname)) {
      return true;
    }

    // 检查前缀匹配
    return this.allowedPrefixes.some(prefix => pathname.startsWith(prefix));
  }

  /**
   * 检查路径是否需要权限验证
   * @param {string} pathname - 请求路径
   * @returns {boolean} 是否需要权限验证
   */
  isProtectedPath(pathname) {
    return this.protectedPaths.has(pathname);
  }

  /**
   * 检查路径是否只允许未登录用户访问
   * @param {string} pathname - 请求路径
   * @returns {boolean} 是否只允许未登录用户
   */
  isGuestOnlyPath(pathname) {
    return this.guestOnlyPaths.has(pathname);
  }

  /**
   * 处理静态资源请求
   * @param {Request} request - HTTP请求对象
   * @param {object} env - 环境变量
   * @param {string[]} mailDomains - 邮件域名列表
   * @returns {Promise<Response>} HTTP响应
   */
  async handleAssetRequest(request, env, mailDomains) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const JWT_TOKEN = env.JWT_TOKEN || env.JWT_SECRET || '';

    // 检查路径是否被允许
    if (!this.isPathAllowed(pathname)) {
      return await this.handleIllegalPath(request, env, JWT_TOKEN);
    }

    // 处理受保护的路径（需要管理员权限）
    if (this.isProtectedPath(pathname)) {
      const authResult = await this.checkProtectedPathAuth(request, JWT_TOKEN, url);
      if (authResult) return authResult;
    }

    // 处理只允许未登录用户的路径（登录页）
    if (this.isGuestOnlyPath(pathname)) {
      const guestResult = await this.checkGuestOnlyPath(request, JWT_TOKEN, url);
      if (guestResult) return guestResult;
    }

    // 如果没有Assets绑定，重定向到登录页
    if (!env.ASSETS || !env.ASSETS.fetch) {
      return Response.redirect(new URL('/login.html', url).toString(), 302);
    }

    // 处理路径映射
    const mappedRequest = this.handlePathMapping(request, url);

    // 处理特殊页面（需要注入数据或权限检查）
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

    // 其他静态资源直接返回
    return env.ASSETS.fetch(mappedRequest);
  }

  /**
   * 处理非法路径访问
   * @param {Request} request - HTTP请求对象
   * @param {object} env - 环境变量
   * @param {string} JWT_TOKEN - JWT令牌
   * @returns {Promise<Response>} HTTP响应
   */
  async handleIllegalPath(request, env, JWT_TOKEN) {
    const url = new URL(request.url);
    
    // 先检查登录状态
    const payload = await resolveAuthPayload(request, JWT_TOKEN);
    
    if (payload !== false) {
      // 已登录用户：根据角色重定向到合适的页面
      if (payload.role === 'mailbox') {
        return Response.redirect(new URL('/html/mailbox.html', url).toString(), 302);
      } else {
        return Response.redirect(new URL('/', url).toString(), 302);
      }
    }
    
    // 未登录：进入loading页面进行认证检查
    return Response.redirect(new URL('/templates/loading.html', url).toString(), 302);
  }

  /**
   * 检查受保护路径的权限
   * @param {Request} request - HTTP请求对象
   * @param {string} JWT_TOKEN - JWT令牌
   * @param {URL} url - 请求URL
   * @returns {Promise<Response|null>} 如果需要重定向则返回Response，否则返回null
   */
  async checkProtectedPathAuth(request, JWT_TOKEN, url) {
    const payload = await resolveAuthPayload(request, JWT_TOKEN);
    
    if (!payload) {
      const loading = new URL('/templates/loading.html', url);
      // 根据访问的路径设置重定向目标
      if (url.pathname.includes('mailbox')) {
        loading.searchParams.set('redirect', '/html/mailbox.html');
      } else {
        loading.searchParams.set('redirect', '/admin.html');
      }
      return Response.redirect(loading.toString(), 302);
    }
    
    // 根据路径和角色进行权限检查
    if (url.pathname.includes('mailbox')) {
      // 邮箱页面只允许邮箱用户访问
      if (payload.role !== 'mailbox') {
        return Response.redirect(new URL('/', url).toString(), 302);
      }
      // 限制邮箱用户访问首页：如果访问 '/' 或 '/index.html'，重定向到邮箱页
      if (url.pathname === '/' || url.pathname === '/index.html') {
        return Response.redirect(new URL('/html/mailbox.html', url).toString(), 302);
      }
    } else {
      // 其他受保护页面
      const isAllowed = (payload.role === 'admin' || payload.role === 'guest' || payload.role === 'mailbox');
      if (!isAllowed) {
        // 已登录但权限不足：引导回首页
        return Response.redirect(new URL('/', url).toString(), 302);
      }
    }
    
    return null;
  }

  /**
   * 检查只允许未登录用户的路径
   * @param {Request} request - HTTP请求对象
   * @param {string} JWT_TOKEN - JWT令牌
   * @param {URL} url - 请求URL
   * @returns {Promise<Response|null>} 如果需要重定向则返回Response，否则返回null
   */
  async checkGuestOnlyPath(request, JWT_TOKEN, url) {
    const payload = await resolveAuthPayload(request, JWT_TOKEN);
    
    if (payload !== false) {
      // 已登录：服务端直接重定向到首页，避免先渲染登录页
      return Response.redirect(new URL('/', url).toString(), 302);
    }
    
    return null;
  }

  /**
   * 处理路径映射
   * @param {Request} request - 原始请求
   * @param {URL} url - 请求URL
   * @returns {Request} 映射后的请求
   */
  handlePathMapping(request, url) {
    let targetUrl = url.toString();

    // 兼容 /login 路由 → /login.html
    if (url.pathname === '/login') {
      targetUrl = new URL('/login.html', url).toString();
    }
    
    // 兼容 /admin 路由 → /admin.html
    if (url.pathname === '/admin') {
      targetUrl = new URL('/admin.html', url).toString();
    }
    
    // 兼容 /mailbox 路由 → /html/mailbox.html
    if (url.pathname === '/mailbox') {
      targetUrl = new URL('/html/mailbox.html', url).toString();
    }
    // 将 /mailbox.html 统一映射到 /html/mailbox.html（真实文件路径）
    if (url.pathname === '/mailbox.html') {
      targetUrl = new URL('/html/mailbox.html', url).toString();
    }
    // 将 /mailboxes.html 统一映射到 /html/mailboxes.html
    if (url.pathname === '/mailboxes.html') {
      targetUrl = new URL('/html/mailboxes.html', url).toString();
    }

    return new Request(targetUrl, request);
  }

  /**
   * 处理首页请求
   * @param {Request} request - HTTP请求对象
   * @param {object} env - 环境变量
   * @param {string[]} mailDomains - 邮件域名列表
   * @param {string} JWT_TOKEN - JWT令牌
   * @returns {Promise<Response>} HTTP响应
   */
  async handleIndexPage(request, env, mailDomains, JWT_TOKEN) {
    const url = new URL(request.url);
    const payload = await resolveAuthPayload(request, JWT_TOKEN);
    
    // 检查用户角色，邮箱用户重定向到专用页面
    if (payload && payload.role === 'mailbox') {
      return Response.redirect(new URL('/html/mailbox.html', url).toString(), 302);
    }
    
    const resp = await env.ASSETS.fetch(request);
    
    try {
      const text = await resp.text();
      
      // 注入域名列表到 meta 标签，并禁用 HTML 缓存
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

  /**
   * 处理管理页请求
   * @param {Request} request - HTTP请求对象
   * @param {object} env - 环境变量
   * @param {string} JWT_TOKEN - JWT令牌
   * @returns {Promise<Response>} HTTP响应
   */
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
      // 返回首页
      return Response.redirect(new URL('/', url).toString(), 302);
    }
    
    return env.ASSETS.fetch(request);
  }

  /**
   * 处理邮箱用户页面 (mailbox.html) 的请求
   * @param {Request} request - HTTP请求对象
   * @param {object} env - 环境变量
   * @param {string} JWT_TOKEN - JWT令牌
   * @returns {Promise<Response>} HTTP响应
   */
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
    
    // 只有邮箱用户可以访问此页面
    if (payload.role !== 'mailbox') {
      // 非邮箱用户重定向到相应页面
      if (payload.role === 'admin' || payload.role === 'guest') {
        return Response.redirect(new URL('/', url).toString(), 302);
      } else {
        return Response.redirect(new URL('/login.html', url).toString(), 302);
      }
    }
    
    return env.ASSETS.fetch(request);
  }

  /**
   * 处理所有邮箱管理页（仅超级管理员和游客）
   */
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
    if (!isStrictAdmin && !isGuest){
      return Response.redirect(new URL('/', url).toString(), 302);
    }
    return env.ASSETS.fetch(request);
  }

  /**
   * 添加允许的路径
   * @param {string} path - 路径
   */
  addAllowedPath(path) {
    this.allowedPaths.add(path);
  }

  /**
   * 添加允许的路径前缀
   * @param {string} prefix - 路径前缀
   */
  addAllowedPrefix(prefix) {
    this.allowedPrefixes.push(prefix);
  }

  /**
   * 移除允许的路径
   * @param {string} path - 路径
   */
  removeAllowedPath(path) {
    this.allowedPaths.delete(path);
  }

  /**
   * 检查路径是否为API路径
   * @param {string} pathname - 请求路径
   * @returns {boolean} 是否为API路径
   */
  isApiPath(pathname) {
    return pathname.startsWith('/api/') || pathname === '/receive';
  }

  /**
   * 获取资源访问日志信息
   * @param {Request} request - HTTP请求对象
   * @returns {object} 日志信息
   */
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

/**
 * 资源安全检查器 - 提供额外的安全检查功能
 */
export class AssetSecurityChecker {
  constructor() {
    // 危险文件扩展名
    this.dangerousExtensions = new Set([
      '.php', '.jsp', '.asp', '.aspx', '.py', '.rb', '.pl', '.sh', '.bat', '.cmd',
      '.exe', '.scr', '.com', '.pif', '.msi', '.dll', '.jar'
    ]);

    // 危险路径模式
    this.dangerousPatterns = [
      /\.\.\//, // 路径遍历
      /\/\.\./,
      /\.\.\//,
      /\/etc\//, // 系统文件
      /\/proc\//,
      /\/sys\//,
      /\/var\/log\//,
      /\/root\//,
      /\/home\//,
      /\.env/, // 环境变量文件
      /\.git/, // Git 文件
      /\.svn/, // SVN 文件
      /\/config\//,
      /\/admin\//, // 除了允许的admin.html
      /\/private\//,
      /\/secret\//
    ];
  }

  /**
   * 检查路径是否安全
   * @param {string} pathname - 请求路径
   * @returns {boolean} 是否安全
   */
  isPathSafe(pathname) {
    const normalizedPath = pathname.toLowerCase();

    // 检查危险扩展名
    for (const ext of this.dangerousExtensions) {
      if (normalizedPath.endsWith(ext)) {
        return false;
      }
    }

    // 检查危险模式
    for (const pattern of this.dangerousPatterns) {
      if (pattern.test(normalizedPath)) {
        return false;
      }
    }

    return true;
  }

  /**
   * 检查请求头是否安全
   * @param {Request} request - HTTP请求对象
   * @returns {boolean} 是否安全
   */
  areHeadersSafe(request) {
    const userAgent = request.headers.get('User-Agent') || '';
    const referer = request.headers.get('Referer') || '';

    // 检查可疑的User-Agent
    const suspiciousUAPatterns = [
      /bot/i,
      /crawler/i,
      /spider/i,
      /scanner/i,
      /sqlmap/i,
      /nikto/i,
      /nmap/i
    ];

    for (const pattern of suspiciousUAPatterns) {
      if (pattern.test(userAgent)) {
        return false;
      }
    }

    return true;
  }

  /**
   * 获取安全风险评估
   * @param {Request} request - HTTP请求对象
   * @returns {object} 风险评估结果
   */
  assessRisk(request) {
    const url = new URL(request.url);
    const risks = [];

    if (!this.isPathSafe(url.pathname)) {
      risks.push('dangerous_path');
    }

    if (!this.areHeadersSafe(request)) {
      risks.push('suspicious_headers');
    }

    return {
      isHighRisk: risks.length > 0,
      risks,
      riskLevel: risks.length === 0 ? 'low' : risks.length === 1 ? 'medium' : 'high'
    };
  }
}
