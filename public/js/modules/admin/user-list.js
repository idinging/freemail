/**
 * 用户列表模块
 * @module modules/admin/user-list
 */

import { escapeHtml, escapeAttr } from '../app/ui-helpers.js';

/**
 * 格式化时间戳
 * @param {string} ts - 时间戳
 * @returns {string}
 */
export function formatTime(ts) {
  if (!ts) return '';
  try {
    const iso = ts.includes('T') ? ts : ts.replace(' ', 'T');
    const d = new Date(iso + 'Z');
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour12: false,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(d);
  } catch (_) {
    return ts;
  }
}

/**
 * 渲染用户表格行
 * @param {object} user - 用户数据
 * @returns {string}
 */
export function renderUserRow(user) {
  const id = user.id;
  const username = escapeHtml(user.username || '');
  const role = user.role === 'admin' ? '管理员' : '普通用户';
  const roleClass = user.role === 'admin' ? 'role-admin' : 'role-user';
  const mailboxLimit = user.mailbox_limit || 0;
  const mailboxCount = user.mailbox_count || 0;
  const canSend = user.can_send ? '✓' : '✗';
  const canSendClass = user.can_send ? 'can-send' : 'cannot-send';
  const createdAt = formatTime(user.created_at);
  
  return `
    <tr data-user-id="${id}" class="user-row clickable">
      <td class="col-id">${id}</td>
      <td class="col-username">${username}</td>
      <td class="col-role"><span class="role-badge ${roleClass}">${role}</span></td>
      <td class="col-mailbox">${mailboxCount} / ${mailboxLimit}</td>
      <td class="col-can"><span class="${canSendClass}">${canSend}</span></td>
      <td class="col-created">${createdAt}</td>
      <td class="col-actions">
        <div class="user-actions">
          <button class="btn btn-sm btn-edit" data-action="edit" data-user-id="${id}" title="编辑">✏️</button>
        </div>
      </td>
    </tr>
  `;
}

/**
 * 渲染用户列表
 * @param {Array} users - 用户列表
 * @param {HTMLElement} tbody - 表格 body 元素
 */
export function renderUserList(users, tbody) {
  if (!tbody) return;
  
  if (!users || users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">暂无用户</td></tr>';
    return;
  }
  
  tbody.innerHTML = users.map(u => renderUserRow(u)).join('');
}

/**
 * 生成骨架屏表格行
 * @param {number} count - 行数
 * @returns {string}
 */
export function generateSkeletonRows(count = 5) {
  const row = `
    <tr class="skeleton-row">
      <td><div class="skeleton-line"></div></td>
      <td><div class="skeleton-line"></div></td>
      <td><div class="skeleton-line"></div></td>
      <td><div class="skeleton-line"></div></td>
      <td><div class="skeleton-line"></div></td>
      <td><div class="skeleton-line"></div></td>
      <td><div class="skeleton-line"></div></td>
    </tr>
  `;
  return Array(count).fill(row).join('');
}

/**
 * 渲染分页控件
 * @param {number} currentPage - 当前页
 * @param {number} totalPages - 总页数
 * @param {number} total - 总数
 * @returns {string}
 */
export function renderPagination(currentPage, totalPages, total) {
  if (totalPages <= 1) {
    return `<span class="page-info">共 ${total} 条</span>`;
  }
  
  return `
    <span class="page-info">第 ${currentPage} / ${totalPages} 页，共 ${total} 条</span>
    <div class="page-buttons">
      <button class="btn btn-sm" data-action="prev-page" ${currentPage <= 1 ? 'disabled' : ''}>上一页</button>
      <button class="btn btn-sm" data-action="next-page" ${currentPage >= totalPages ? 'disabled' : ''}>下一页</button>
    </div>
  `;
}

// 导出默认对象
export default {
  formatTime,
  renderUserRow,
  renderUserList,
  generateSkeletonRows,
  renderPagination
};
