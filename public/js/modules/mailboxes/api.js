/**
 * 邮箱管理 API 模块
 * @module modules/mailboxes/api
 */

import { mockApi } from '../app/mock-api.js';

/**
 * API 请求封装
 * @param {string} path - API 路径
 * @param {object} options - fetch 选项
 * @returns {Promise<Response>}
 */
export async function api(path, options = {}) {
  // Guest 模式使用 mock API
  if (window.__GUEST_MODE__) {
    return mockApi(path, options);
  }
  
  const r = await fetch(path, { 
    ...options,
    headers: { 'Cache-Control': 'no-cache', ...options.headers } 
  });
  if (r.status === 401) {
    location.replace('/html/login.html');
    throw new Error('unauthorized');
  }
  return r;
}

/**
 * 加载邮箱列表
 * @param {object} params - 查询参数
 * @returns {Promise<object>}
 */
export async function loadMailboxes(params = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set('page', params.page);
  if (params.size) query.set('size', params.size);
  if (params.q) query.set('q', params.q);
  if (params.domain) query.set('domain', params.domain);
  if (params.login) query.set('login', params.login);
  if (params.favorite) query.set('favorite', params.favorite);
  if (params.forward) query.set('forward', params.forward);
  
  const r = await api(`/api/mailboxes?${query.toString()}`);
  return r.json();
}

/**
 * 加载域名列表
 * @returns {Promise<Array>}
 */
export async function loadDomains() {
  const r = await api('/api/domains');
  return r.json();
}

/**
 * 删除邮箱
 * @param {string} address - 邮箱地址
 * @returns {Promise<Response>}
 */
export async function deleteMailbox(address) {
  return api(`/api/mailboxes?address=${encodeURIComponent(address)}`, { method: 'DELETE' });
}

/**
 * 重置邮箱密码（恢复为默认密码）
 * @param {string} address - 邮箱地址
 * @returns {Promise<Response>}
 */
export async function resetPassword(address) {
  return api(`/api/mailboxes/reset-password?address=${encodeURIComponent(address)}`, {
    method: 'POST'
  });
}

/**
 * 修改邮箱密码
 * @param {string} address - 邮箱地址
 * @param {string} newPassword - 新密码
 * @returns {Promise<Response>}
 */
export async function changePassword(address, newPassword) {
  return api('/api/mailboxes/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, new_password: newPassword })
  });
}

/**
 * 切换登录状态
 * @param {string} address - 邮箱地址
 * @param {boolean} canLogin - 是否允许登录
 * @returns {Promise<Response>}
 */
export async function toggleLogin(address, canLogin) {
  return api('/api/mailboxes/toggle-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, can_login: canLogin ? 1 : 0 })
  });
}

/**
 * 批量切换登录状态
 * @param {Array<string>} addresses - 邮箱地址列表
 * @param {boolean} canLogin - 是否允许登录
 * @returns {Promise<Response>}
 */
export async function batchToggleLogin(addresses, canLogin) {
  return api('/api/mailboxes/batch-toggle-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ addresses, can_login: canLogin ? 1 : 0 })
  });
}

/**
 * 设置转发
 * @param {number} mailboxId - 邮箱 ID
 * @param {string} forwardTo - 转发目标
 * @returns {Promise<Response>}
 */
export async function setForward(mailboxId, forwardTo) {
  return api('/api/mailbox/forward', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mailbox_id: mailboxId, forward_to: forwardTo })
  });
}

/**
 * 设置收藏
 * @param {number} mailboxId - 邮箱 ID
 * @param {boolean} isFavorite - 是否收藏
 * @returns {Promise<Response>}
 */
export async function setFavorite(mailboxId, isFavorite) {
  return api('/api/mailbox/favorite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mailbox_id: mailboxId, is_favorite: isFavorite ? 1 : 0 })
  });
}

export default {
  api,
  loadMailboxes,
  loadDomains,
  deleteMailbox,
  resetPassword,
  changePassword,
  toggleLogin,
  batchToggleLogin,
  setForward,
  setFavorite
};
