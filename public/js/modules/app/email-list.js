/**
 * 邮件列表模块
 * @module modules/app/email-list
 */

import { formatTs, formatTsMobile, extractCode, escapeHtml } from './ui-helpers.js';
import { getCurrentMailbox } from './mailbox-state.js';

// 分页状态
const PAGE_SIZE = 8;
let currentPage = 1;
let lastLoadedEmails = [];
let isSentView = false;

// 邮件缓存
const emailCache = new Map();

// 视图加载状态
const viewLoaded = new Set();

/**
 * 获取视图 key
 * @returns {string}
 */
function getViewKey() {
  return `${getCurrentMailbox()}:${isSentView ? 'sent' : 'inbox'}`;
}

/**
 * 渲染分页器
 * @param {object} elements - DOM 元素
 */
export function renderPager(elements) {
  try {
    const total = Array.isArray(lastLoadedEmails) ? lastLoadedEmails.length : 0;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (!elements.pager) return;
    elements.pager.style.display = total > PAGE_SIZE ? 'flex' : 'none';
    if (elements.pageInfo) elements.pageInfo.textContent = `${currentPage} / ${totalPages}`;
    if (elements.prevPage) elements.prevPage.disabled = currentPage <= 1;
    if (elements.nextPage) elements.nextPage.disabled = currentPage >= totalPages;
  } catch(_) {}
}

/**
 * 分页切片
 * @param {Array} items - 邮件列表
 * @param {object} elements - DOM 元素
 * @returns {Array}
 */
export function sliceByPage(items, elements) {
  lastLoadedEmails = Array.isArray(items) ? items : [];
  const total = lastLoadedEmails.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  const start = (currentPage - 1) * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  renderPager(elements);
  return lastLoadedEmails.slice(start, end);
}

/**
 * 上一页
 * @param {Function} refresh - 刷新函数
 */
export function prevPage(refresh) {
  if (currentPage > 1) {
    currentPage -= 1;
    refresh();
  }
}

/**
 * 下一页
 * @param {Function} refresh - 刷新函数
 */
export function nextPage(refresh) {
  const total = lastLoadedEmails.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (currentPage < totalPages) {
    currentPage += 1;
    refresh();
  }
}

/**
 * 重置分页
 * @param {object} elements - DOM 元素
 */
export function resetPager(elements) {
  currentPage = 1;
  lastLoadedEmails = [];
  renderPager(elements);
}

/**
 * 切换视图
 * @param {boolean} sent - 是否为发件箱视图
 */
export function setView(sent) {
  isSentView = sent;
}

/**
 * 获取当前视图
 * @returns {boolean}
 */
export function isSentViewActive() {
  return isSentView;
}

/**
 * 渲染邮件状态 class
 * @param {string} status - 状态
 * @returns {string}
 */
export function statusClass(status) {
  const map = {
    'queued': 'status-queued',
    'delivered': 'status-delivered',
    'failed': 'status-failed',
    'processing': 'status-processing'
  };
  return map[status] || '';
}

/**
 * 渲染邮件列表项
 * @param {object} email - 邮件数据
 * @param {boolean} isMobile - 是否移动端
 * @returns {string}
 */
export function renderEmailItem(email, isMobile = false) {
  const e = email;
  
  // 智能内容预览处理
  let rawContent = isSentView ? (e.text_content || e.html_content || '') : (e.preview || e.content || e.html_content || '');
  let preview = '';
  
  if (rawContent) {
    preview = rawContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const codeMatch = (e.verification_code || '').toString().trim() || extractCode(rawContent);
    if (codeMatch) {
      preview = `验证码: ${codeMatch} | ${preview}`;
    }
    preview = preview.slice(0, 40);
  }
  
  const hasContent = preview.length > 0;
  const listCode = (e.verification_code || '').toString().trim() || extractCode(rawContent || '');
  const senderText = escapeHtml(e.sender || '');
  
  // 解析收件人地址（用于发件箱和收件箱）
  let recipientsDisplay = '';
  const rawToAddrs = (e.recipients || e.to_addrs || '').toString();
  const toAddrsArr = rawToAddrs.split(',').map(s => s.trim()).filter(Boolean);
  if (toAddrsArr.length) {
    recipientsDisplay = toAddrsArr.slice(0, 2).join(', ');
    if (toAddrsArr.length > 2) recipientsDisplay += ` 等${toAddrsArr.length}人`;
  } else {
    recipientsDisplay = rawToAddrs;
  }
  
  const subjectText = escapeHtml(e.subject || '(无主题)');
  const previewText = escapeHtml(preview);
  const metaLabel = isSentView ? '收件人' : '发件人';
  const metaText = isSentView ? escapeHtml(recipientsDisplay) : senderText;
  const timeDisplay = isMobile ? formatTsMobile(e.received_at || e.created_at) : formatTs(e.received_at || e.created_at);
  // 收件箱视图时显示收件人地址（别名地址）
  const toAddrDisplay = !isSentView && recipientsDisplay ? escapeHtml(recipientsDisplay) : '';
  
  return `
    <div class="email-item clickable" onclick="${isSentView ? `showSentEmail(${e.id})` : `showEmail(${e.id})`}">
      <div class="email-meta">
        <span class="meta-from"><span class="meta-label">${metaLabel}</span><span class="meta-from-text">${metaText}</span></span>
        ${!isSentView && toAddrDisplay ? `<span class="meta-to"><span class="meta-label">收件人</span><span class="meta-to-text">${toAddrDisplay}</span></span>` : ''}
        <span class="email-time"><span class="time-icon">🕐</span>${timeDisplay}</span>
      </div>
      <div class="email-content">
        <div class="email-main">
          <div class="email-line"><span class="label-chip">主题</span><span class="value-text subject">${subjectText}</span></div>
          <div class="email-line"><span class="label-chip">内容</span>${hasContent ? `<span class="email-preview value-text">${previewText}</span>` : '<span class="email-preview value-text" style="color:#94a3b8">(暂无预览)</span>'}</div>
        </div>
        <div class="email-actions">
          ${isSentView ? `
            <span class="status-badge ${statusClass(e.status)}">${e.status || 'unknown'}</span>
            <button class="btn btn-danger btn-sm" onclick="deleteSent(${e.id});event.stopPropagation()" title="删除记录"><span class="btn-icon">🗑️</span></button>
          ` : `
            <button class="btn btn-secondary btn-sm" data-code="${listCode || ''}" onclick="copyFromList(event, ${e.id});event.stopPropagation()" title="复制内容或验证码"><span class="btn-icon">📋</span></button>
            <button class="btn btn-danger btn-sm" onclick="deleteEmail(${e.id});event.stopPropagation()" title="删除邮件"><span class="btn-icon">🗑️</span></button>
          `}
        </div>
      </div>
    </div>`;
}

/**
 * 获取邮件缓存
 * @param {number} id - 邮件ID
 * @returns {object|undefined}
 */
export function getEmailFromCache(id) {
  return emailCache.get(id);
}

/**
 * 设置邮件缓存
 * @param {number} id - 邮件ID
 * @param {object} email - 邮件数据
 */
export function setEmailCache(id, email) {
  emailCache.set(id, email);
}

/**
 * 清除邮件缓存
 */
export function clearEmailCache() {
  emailCache.clear();
}

/**
 * 标记视图已加载
 */
export function markViewLoaded() {
  viewLoaded.add(getViewKey());
}

/**
 * 检查视图是否首次加载
 * @returns {boolean}
 */
export function isFirstLoad() {
  return !viewLoaded.has(getViewKey());
}

/**
 * 清除视图加载状态
 */
export function clearViewLoaded() {
  viewLoaded.clear();
}

export default {
  renderPager,
  sliceByPage,
  prevPage,
  nextPage,
  resetPager,
  setView,
  isSentViewActive,
  statusClass,
  renderEmailItem,
  getEmailFromCache,
  setEmailCache,
  clearEmailCache,
  markViewLoaded,
  isFirstLoad,
  clearViewLoaded
};
