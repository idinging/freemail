/**
 * API 辅助函数模块
 * @module api/helpers
 */

import { sha256Hex } from '../utils/common.js';

/**
 * 从请求中提取 JWT 载荷
 * @param {Request} request - HTTP 请求对象
 * @param {object} options - 选项对象
 * @returns {object|null} JWT 载荷或 null
 */
export function getJwtPayload(request, options = {}) {
  // 优先使用服务端传入的已解析身份（支持 __root__ 超管）
  if (options && options.authPayload) return options.authPayload;
  try {
    const cookie = request.headers.get('Cookie') || '';
    const token = (cookie.split(';').find(s => s.trim().startsWith('iding-session=')) || '').split('=')[1] || '';
    const parts = token.split('.');
    if (parts.length === 3) {
      const json = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
      return JSON.parse(json);
    }
  } catch (_) { }
  return null;
}

/**
 * 检查是否为严格管理员
 * @param {Request} request - HTTP 请求对象
 * @param {object} options - 选项对象
 * @returns {boolean} 是否为严格管理员
 */
export function isStrictAdmin(request, options = {}) {
  const p = getJwtPayload(request, options);
  if (!p) return false;
  if (p.role !== 'admin') return false;
  // __root__（根管理员）视为严格管理员
  if (String(p.username || '') === '__root__') return true;
  if (options?.adminName) {
    return String(p.username || '').toLowerCase() === String(options.adminName || '').toLowerCase();
  }
  return true;
}

/**
 * 创建标准 JSON 响应
 * @param {any} data - 响应数据
 * @param {number} status - HTTP 状态码
 * @returns {Response} HTTP 响应对象
 */
export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * 创建错误响应
 * @param {string} message - 错误消息
 * @param {number} status - HTTP 状态码
 * @returns {Response} HTTP 响应对象
 */
export function errorResponse(message, status = 400) {
  return new Response(message, { status });
}

export { sha256Hex };
