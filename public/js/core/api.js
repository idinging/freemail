/**
 * API 请求封装模块
 * @module core/api
 */

/**
 * 基础 API 请求函数
 * @param {string} path - API 路径
 * @param {object} options - fetch 选项
 * @returns {Promise<Response>}
 */
export async function fetchApi(path, options = {}) {
  const defaultHeaders = {
    'Cache-Control': 'no-cache'
  };
  
  const config = {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers
    }
  };
  
  const response = await fetch(path, config);
  
  // 401 未授权时跳转到登录页
  if (response.status === 401) {
    const currentPath = window.location.pathname;
    // 避免在登录页循环重定向
    if (!currentPath.includes('login')) {
      window.location.replace('/html/login.html');
    }
    throw new Error('unauthorized');
  }
  
  return response;
}

/**
 * GET 请求
 * @param {string} path - API 路径
 * @returns {Promise<any>}
 */
export async function get(path) {
  const response = await fetchApi(path);
  return response.json();
}

/**
 * POST 请求
 * @param {string} path - API 路径
 * @param {object} data - 请求数据
 * @returns {Promise<any>}
 */
export async function post(path, data = {}) {
  const response = await fetchApi(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return response.json();
}

/**
 * PUT 请求
 * @param {string} path - API 路径
 * @param {object} data - 请求数据
 * @returns {Promise<any>}
 */
export async function put(path, data = {}) {
  const response = await fetchApi(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return response.json();
}

/**
 * PATCH 请求
 * @param {string} path - API 路径
 * @param {object} data - 请求数据
 * @returns {Promise<any>}
 */
export async function patch(path, data = {}) {
  const response = await fetchApi(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return response.json();
}

/**
 * DELETE 请求
 * @param {string} path - API 路径
 * @returns {Promise<any>}
 */
export async function del(path) {
  const response = await fetchApi(path, { method: 'DELETE' });
  return response.json();
}

/**
 * 获取域名列表
 */
export async function getDomains() {
  return get('/api/domains');
}

/**
 * 生成随机邮箱
 * @param {number} length - 长度
 * @param {number} domainIndex - 域名索引
 */
export async function generateMailbox(length = 8, domainIndex = 0) {
  return get(`/api/generate?length=${length}&domainIndex=${domainIndex}`);
}

/**
 * 创建自定义邮箱
 * @param {string} local - 本地部分
 * @param {number} domainIndex - 域名索引
 */
export async function createMailbox(local, domainIndex = 0) {
  return post('/api/create', { local, domainIndex });
}

/**
 * 获取邮箱列表
 * @param {object} params - 查询参数
 */
export async function getMailboxes(params = {}) {
  const query = new URLSearchParams(params).toString();
  return get(`/api/mailboxes${query ? '?' + query : ''}`);
}

/**
 * 删除邮箱
 * @param {string} address - 邮箱地址
 */
export async function deleteMailbox(address) {
  return del(`/api/mailboxes?address=${encodeURIComponent(address)}`);
}

/**
 * 切换邮箱置顶
 * @param {string} address - 邮箱地址
 */
export async function toggleMailboxPin(address) {
  const response = await fetchApi(`/api/mailboxes/pin?address=${encodeURIComponent(address)}`, {
    method: 'POST'
  });
  return response.json();
}

/**
 * 获取邮件列表
 * @param {string} mailbox - 邮箱地址
 * @param {number} limit - 限制数量
 */
export async function getEmails(mailbox, limit = 20) {
  return get(`/api/emails?mailbox=${encodeURIComponent(mailbox)}&limit=${limit}`);
}

/**
 * 获取邮件详情
 * @param {number|string} id - 邮件 ID
 */
export async function getEmailDetail(id) {
  return get(`/api/email/${id}`);
}

/**
 * 删除邮件
 * @param {number|string} id - 邮件 ID
 */
export async function deleteEmail(id) {
  return del(`/api/email/${id}`);
}

/**
 * 清空邮箱所有邮件
 * @param {string} mailbox - 邮箱地址
 */
export async function clearEmails(mailbox) {
  return del(`/api/emails?mailbox=${encodeURIComponent(mailbox)}`);
}

/**
 * 获取用户配额
 */
export async function getUserQuota() {
  return get('/api/user/quota');
}

/**
 * 获取会话信息
 */
export async function getSession() {
  return get('/api/session');
}

/**
 * 登出
 */
export async function logout() {
  return post('/api/logout');
}

/**
 * 设置邮箱转发
 * @param {number} mailboxId - 邮箱 ID
 * @param {string} forwardTo - 转发目标地址
 */
export async function setForward(mailboxId, forwardTo) {
  return post('/api/mailbox/forward', { mailbox_id: mailboxId, forward_to: forwardTo });
}

/**
 * 切换邮箱收藏
 * @param {number} mailboxId - 邮箱 ID
 * @param {boolean} isFavorite - 是否收藏
 */
export async function setFavorite(mailboxId, isFavorite) {
  return post('/api/mailbox/favorite', { mailbox_id: mailboxId, is_favorite: isFavorite });
}

// 导出默认对象
export default {
  fetchApi,
  get,
  post,
  put,
  patch,
  del,
  getDomains,
  generateMailbox,
  createMailbox,
  getMailboxes,
  deleteMailbox,
  toggleMailboxPin,
  getEmails,
  getEmailDetail,
  deleteEmail,
  clearEmails,
  getUserQuota,
  getSession,
  logout,
  setForward,
  setFavorite
};
