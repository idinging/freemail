/**
 * 邮箱列表视图模块
 * @module modules/mailboxes/list-view
 */

import { escapeAttr, escapeHtml } from '../app/ui-helpers.js';
import { formatTime } from './grid-view.js';

/**
 * 生成骨架屏列表项
 * @returns {string}
 */
export function createSkeletonListItem() {
  return `
    <div class="skeleton-list-item">
      <div class="skeleton-line skeleton-pin"></div>
      <div class="skeleton-content">
        <div class="skeleton-line title"></div>
        <div class="skeleton-line subtitle"></div>
      </div>
      <div class="skeleton-actions">
        <div class="skeleton-line"></div>
        <div class="skeleton-line"></div>
        <div class="skeleton-line"></div>
        <div class="skeleton-line"></div>
      </div>
    </div>
  `;
}

/**
 * 生成骨架屏内容
 * @param {number} count - 数量
 * @returns {string}
 */
export function generateSkeletonContent(count = 8) {
  return Array(count).fill(null).map(() => createSkeletonListItem()).join('');
}

/**
 * 渲染邮箱列表项
 * @param {object} mailbox - 邮箱数据
 * @param {object} options - 选项
 * @returns {string}
 */
export function renderMailboxListItem(mailbox, options = {}) {
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
    <div class="mailbox-list-item ${isPinned ? 'pinned' : ''}" data-address="${escapedAddress}">
      <div class="item-pin ${isPinned ? 'active' : ''}" data-action="pin" title="${isPinned ? '取消置顶' : '置顶'}">
        ${isPinned ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><use href="/icons/sprites.svg#icon-pin"/></svg>' : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="/icons/sprites.svg#icon-pin"/></svg>'}
      </div>

      <div class="item-content">
        <div class="item-address" title="${escapedAddress}">${displayAddress}</div>
        <div class="item-meta">
          <span class="item-time">${createdAt}</span>
          <span class="item-indicators">
            ${isFavorite ? '<span class="indicator favorite" title="已收藏"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><use href="/icons/sprites.svg#icon-star"/></svg></span>' : ''}
            ${forwardTo ? `<span class="indicator forward" title="转发至: ${escapeAttr(forwardTo)}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="/icons/sprites.svg#icon-forward"/></svg></span>` : ''}
            ${canLogin ? '<span class="indicator login" title="可登录"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="/icons/sprites.svg#icon-key"/></svg></span>' : '<span class="indicator login-disabled" title="禁止登录"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="/icons/sprites.svg#icon-lock"/></svg></span>'}
          </span>
        </div>
      </div>

      <div class="item-actions">
        <button class="btn btn-sm" data-action="copy" title="复制"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="/icons/sprites.svg#icon-copy"/></svg></button>
        <button class="btn btn-sm" data-action="jump" title="查看"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="/icons/sprites.svg#icon-mail"/></svg></button>
        <button class="btn btn-sm ${isFavorite ? 'active' : ''}" data-action="favorite" title="${isFavorite ? '取消收藏' : '收藏'}"><svg width="14" height="14" viewBox="0 0 24 24" fill="${isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><use href="/icons/sprites.svg#icon-star-${isFavorite ? '' : 'empty'}"/></svg></button>
        <button class="btn btn-sm" data-action="forward" title="转发设置"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="/icons/sprites.svg#icon-forward"/></svg></button>
        <button class="btn btn-sm" data-action="toggle-login" title="${canLogin ? '禁止登录' : '允许登录'}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="/icons/sprites.svg#icon-key"/></svg></button>
        <button class="btn btn-sm danger" data-action="delete" title="删除"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="/icons/sprites.svg#icon-trash"/></svg></button>
      </div>
    </div>
  `;
}

/**
 * 渲染列表视图
 * @param {Array} mailboxes - 邮箱列表
 * @param {HTMLElement} container - 容器元素
 * @param {object} options - 选项
 */
export function renderListView(mailboxes, container, options = {}) {
  if (!container) return;
  
  if (!mailboxes || mailboxes.length === 0) {
    container.innerHTML = '<div class="empty-state">暂无邮箱</div>';
    return;
  }
  
  container.innerHTML = mailboxes.map(m => renderMailboxListItem(m, options)).join('');
}

/**
 * 渲染表格视图头部
 * @returns {string}
 */
export function renderTableHeader() {
  return `
    <div class="table-header">
      <div class="col-pin">📌</div>
      <div class="col-address">邮箱地址</div>
      <div class="col-status">状态</div>
      <div class="col-time">创建时间</div>
      <div class="col-actions">操作</div>
    </div>
  `;
}

/**
 * 渲染表格行
 * @param {object} mailbox - 邮箱数据
 * @returns {string}
 */
export function renderTableRow(mailbox) {
  const address = mailbox.address || '';
  const createdAt = formatTime(mailbox.created_at);
  const isPinned = mailbox.is_pinned ? 1 : 0;
  const isFavorite = mailbox.is_favorite ? 1 : 0;
  const canLogin = mailbox.can_login ? 1 : 0;
  const forwardTo = mailbox.forward_to || '';
  
  const escapedAddress = escapeAttr(address);
  const displayAddress = escapeHtml(address);
  
  const statusIcons = [
    isFavorite ? '⭐' : '',
    forwardTo ? '📤' : '',
    canLogin ? '🔑' : ''
  ].filter(Boolean).join(' ');
  
  return `
    <div class="table-row ${isPinned ? 'pinned' : ''}" data-address="${escapedAddress}">
      <div class="col-pin">
        <button class="btn btn-sm ${isPinned ? 'active' : ''}" data-action="pin">${isPinned ? '📌' : '📍'}</button>
      </div>
      <div class="col-address" title="${escapedAddress}">${displayAddress}</div>
      <div class="col-status">${statusIcons || '-'}</div>
      <div class="col-time">${createdAt}</div>
      <div class="col-actions">
        <button class="btn btn-sm" data-action="copy" title="复制">📋</button>
        <button class="btn btn-sm" data-action="jump" title="查看">📧</button>
        <button class="btn btn-sm" data-action="more" title="更多">⋯</button>
      </div>
    </div>
  `;
}

// 导出默认对象
export default {
  createSkeletonListItem,
  generateSkeletonContent,
  renderMailboxListItem,
  renderListView,
  renderTableHeader,
  renderTableRow
};
