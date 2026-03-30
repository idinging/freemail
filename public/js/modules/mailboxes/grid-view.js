/**
 * 邮箱网格视图模块
 * @module modules/mailboxes/grid-view
 */

import { escapeAttr, escapeHtml } from '../app/ui-helpers.js';

/**
 * 格式化时间戳
 * @param {string} ts - 时间戳
 * @returns {string}
 */
export function formatTime(ts) {
  if (!ts) return '';
  try {
    const d = new Date(String(ts).replace(' ', 'T') + 'Z');
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
    return '';
  }
}

/**
 * 生成骨架屏卡片
 * @returns {string}
 */
export function createSkeletonCard() {
  return `
    <div class="skeleton-card">
      <div class="skeleton-line title"></div>
      <div class="skeleton-line subtitle"></div>
      <div class="skeleton-line text"></div>
      <div class="skeleton-line time"></div>
    </div>
  `;
}

/**
 * 生成骨架屏内容
 * @param {number} count - 数量
 * @returns {string}
 */
export function generateSkeletonContent(count = 8) {
  return Array(count).fill(null).map(() => createSkeletonCard()).join('');
}

/**
 * 渲染邮箱卡片
 * @param {object} mailbox - 邮箱数据
 * @param {object} options - 选项
 * @returns {string}
 */
export function renderMailboxCard(mailbox, options = {}) {
  const { onCopy, onJump, onTogglePin, onDelete, onToggleFavorite, onSetForward, onToggleLogin, onChangePassword } = options;
  
  const address = mailbox.address || '';
  const createdAt = formatTime(mailbox.created_at);
  const isPinned = mailbox.is_pinned ? 1 : 0;
  const isFavorite = mailbox.is_favorite ? 1 : 0;
  const canLogin = mailbox.can_login ? 1 : 0;
  const forwardTo = mailbox.forward_to || '';
  const passwordIsDefault = mailbox.password_is_default ? 1 : 0;
  
  const escapedAddress = escapeAttr(address);
  const displayAddress = escapeHtml(address);
  
  return `
    <div class="mailbox-card ${isPinned ? 'pinned' : ''}" data-address="${escapedAddress}">
      <div class="card-header">
        <div class="pin-status" title="${isPinned ? '已置顶' : '未置顶'}">
          ${isPinned ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><use href="/icons/sprites.svg#icon-pin"/></svg>' : ''}
        </div>
        <div class="favorite-status ${isFavorite ? 'active' : ''}" title="${isFavorite ? '已收藏' : '未收藏'}">
          ${isFavorite ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><use href="/icons/sprites.svg#icon-star"/></svg>' : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="/icons/sprites.svg#icon-star-empty"/></svg>'}
        </div>
      </div>
      
      <div class="card-body">
        <div class="mailbox-address" title="${escapedAddress}">${displayAddress}</div>
        <div class="mailbox-meta">
          <span class="created-time">${createdAt}</span>
          ${forwardTo ? `<span class="forward-indicator" title="转发至: ${escapeAttr(forwardTo)}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="/icons/sprites.svg#icon-forward"/></svg></span>` : ''}
          ${canLogin ? '<span class="login-indicator" title="可登录"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="/icons/sprites.svg#icon-key"/></svg></span>' : '<span class="login-indicator disabled" title="禁止登录"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="/icons/sprites.svg#icon-lock"/></svg></span>'}
        </div>
      </div>

      <div class="card-actions">
        <button class="btn btn-sm btn-copy" data-action="copy" title="复制地址"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="/icons/sprites.svg#icon-copy"/></svg></button>
        <button class="btn btn-sm btn-jump" data-action="jump" title="查看邮件"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="/icons/sprites.svg#icon-mail"/></svg></button>
        <button class="btn btn-sm btn-pin ${isPinned ? 'active' : ''}" data-action="pin" title="${isPinned ? '取消置顶' : '置顶'}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="/icons/sprites.svg#icon-pin"/></svg></button>
        <button class="btn btn-sm btn-favorite ${isFavorite ? 'active' : ''}" data-action="favorite" title="${isFavorite ? '取消收藏' : '收藏'}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="/icons/sprites.svg#icon-star-${isFavorite ? '' : 'empty'}"/></svg></button>
        <button class="btn btn-sm btn-more" data-action="more" title="更多操作"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="/icons/sprites.svg#icon-more-horizontal"/></svg></button>
      </div>

      <div class="card-dropdown" style="display: none;">
        <button class="dropdown-item" data-action="forward"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="/icons/sprites.svg#icon-forward"/></svg> 设置转发</button>
        <button class="dropdown-item" data-action="toggle-login"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="/icons/sprites.svg#icon-key"/></svg> ${canLogin ? '禁止登录' : '允许登录'}</button>
        <button class="dropdown-item" data-action="change-password"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="/icons/sprites.svg#icon-lock"/></svg> ${passwordIsDefault ? '设置密码' : '修改密码'}</button>
        <button class="dropdown-item danger" data-action="delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="/icons/sprites.svg#icon-trash"/></svg> 删除邮箱</button>
      </div>
    </div>
  `;
}

/**
 * 渲染网格视图
 * @param {Array} mailboxes - 邮箱列表
 * @param {HTMLElement} container - 容器元素
 * @param {object} options - 选项
 */
export function renderGridView(mailboxes, container, options = {}) {
  if (!container) return;
  
  if (!mailboxes || mailboxes.length === 0) {
    container.innerHTML = '<div class="empty-state">暂无邮箱</div>';
    return;
  }
  
  container.innerHTML = mailboxes.map(m => renderMailboxCard(m, options)).join('');
  
  // 绑定更多按钮事件
  container.querySelectorAll('.btn-more').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const card = btn.closest('.mailbox-card');
      const dropdown = card.querySelector('.card-dropdown');
      
      // 关闭其他下拉菜单
      container.querySelectorAll('.card-dropdown').forEach(d => {
        if (d !== dropdown) d.style.display = 'none';
      });
      
      // 切换当前下拉菜单
      dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
    });
  });
  
  // 点击其他地方关闭下拉菜单
  document.addEventListener('click', () => {
    container.querySelectorAll('.card-dropdown').forEach(d => {
      d.style.display = 'none';
    });
  });
}

// 导出默认对象
export default {
  formatTime,
  createSkeletonCard,
  generateSkeletonContent,
  renderMailboxCard,
  renderGridView
};
