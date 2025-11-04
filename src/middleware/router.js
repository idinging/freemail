/**
 * 路由器模块
 * @module middleware/router
 */

/**
 * 路由处理器类，用于管理所有API路由
 */
export class Router {
  constructor() {
    this.routes = [];
    this.middlewares = [];
  }

  /**
   * 添加中间件
   * @param {Function} middleware - 中间件函数
   */
  use(middleware) {
    this.middlewares.push(middleware);
  }

  /**
   * 添加GET路由
   */
  get(path, handler) {
    this.addRoute('GET', path, handler);
  }

  /**
   * 添加POST路由
   */
  post(path, handler) {
    this.addRoute('POST', path, handler);
  }

  /**
   * 添加PATCH路由
   */
  patch(path, handler) {
    this.addRoute('PATCH', path, handler);
  }

  /**
   * 添加PUT路由
   */
  put(path, handler) {
    this.addRoute('PUT', path, handler);
  }

  /**
   * 添加DELETE路由
   */
  delete(path, handler) {
    this.addRoute('DELETE', path, handler);
  }

  /**
   * 添加路由
   * @param {string} method - HTTP方法
   * @param {string} path - 路径模式
   * @param {Function} handler - 处理函数
   */
  addRoute(method, path, handler) {
    const paramNames = [];
    const regexPath = path
      .replace(/:\w+/g, (match) => {
        paramNames.push(match.slice(1));
        return '([^/]+)';
      })
      .replace(/\*/g, '.*');

    this.routes.push({
      method: method.toUpperCase(),
      path,
      regex: new RegExp(`^${regexPath}$`),
      paramNames,
      handler
    });
  }

  /**
   * 处理请求
   * @param {Request} request - HTTP请求
   * @param {object} context - 上下文对象
   * @returns {Promise<Response>} HTTP响应
   */
  async handle(request, context) {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const pathname = url.pathname;

    for (const route of this.routes) {
      if (route.method === method) {
        const match = pathname.match(route.regex);
        if (match) {
          const params = {};
          route.paramNames.forEach((name, index) => {
            params[name] = match[index + 1];
          });

          const enhancedContext = {
            ...context,
            params,
            query: Object.fromEntries(url.searchParams.entries()),
            request,
            url
          };

          for (const middleware of this.middlewares) {
            const result = await middleware(enhancedContext);
            if (result) return result;
          }

          return await route.handler(enhancedContext);
        }
      }
    }

    return null;
  }
}
