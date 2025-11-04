/**
 * UI 辅助函数模块
 * @module modules/app/ui-helpers
 */

/**
 * 格式化时间戳为东八区显示
 * @param {string} ts - 时间戳
 * @returns {string}
 */
export function formatTs(ts) {
  if (!ts) return '';
  try {
    const iso = ts.includes('T') ? ts : ts.replace(' ', 'T');
    const d = new Date(iso + 'Z');
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour12: false,
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).format(d);
  } catch (_) { return ts; }
}

/**
 * 移动端专用：将时间格式化为两行显示
 * @param {string} ts - 时间戳
 * @returns {string}
 */
export function formatTsMobile(ts) {
  if (!ts) return '<span></span><span></span>';
  try {
    const iso = ts.includes('T') ? ts : ts.replace(' ', 'T');
    const d = new Date(iso + 'Z');
    
    const dateStr = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric', month: 'numeric', day: 'numeric'
    }).format(d);
    
    const timeStr = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour12: false,
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).format(d);
    
    return `<span>${dateStr}</span><span>${timeStr}</span>`;
  } catch (_) { return `<span></span><span>${ts}</span>`; }
}

/**
 * HTML 转义
 * @param {string} str - 原始字符串
 * @returns {string}
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * HTML 属性转义
 * @param {string} str - 原始字符串
 * @returns {string}
 */
export function escapeAttr(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * 设置按钮加载态
 * @param {HTMLElement} button - 按钮元素
 * @param {string} loadingText - 加载文本
 */
export function setButtonLoading(button, loadingText = '处理中…') {
  if (!button) return;
  if (button.dataset.loading === '1') return;
  button.dataset.loading = '1';
  button.dataset.originalHtml = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `<div class="spinner"></div><span style="margin-left:8px">${loadingText}</span>`;
}

/**
 * 恢复按钮状态
 * @param {HTMLElement} button - 按钮元素
 */
export function restoreButton(button) {
  if (!button) return;
  const html = button.dataset.originalHtml;
  if (html) button.innerHTML = html;
  button.disabled = false;
  delete button.dataset.loading;
  delete button.dataset.originalHtml;
}

/**
 * 从文本中提取验证码
 * @param {string} text - 文本内容
 * @returns {string}
 */
export function extractCode(text) {
  if (!text) return '';
  const keywords = '(?:验证码|校验码|激活码|one[-\\s]?time\\s+code|verification\\s+code|security\\s+code|two[-\\s]?factor|2fa|otp|login\\s+code|code)';
  const notFollowAlnum = '(?![0-9A-Za-z])';

  // 1) 关键词附近的 4-8 位纯数字
  let m = text.match(new RegExp(
    keywords + "[^0-9A-Za-z]{0,20}(?:is(?:\\s*[:：])?|[:：]|为|是)?[^0-9A-Za-z]{0,10}(\\d{4,8})" + notFollowAlnum,
    'i'
  ));
  if (m) return m[1];

  // 2) 关键词附近的空格/横杠分隔数字
  m = text.match(new RegExp(
    keywords + "[^0-9A-Za-z]{0,20}(?:is(?:\\s*[:：])?|[:：]|为|是)?[^0-9A-Za-z]{0,10}((?:\\d[ \\t-]){3,7}\\d)",
    'i'
  ));
  if (m) {
    const digits = m[1].replace(/\D/g, '');
    if (digits.length >= 4 && digits.length <= 8) return digits;
  }

  // 3) 关键词附近的 4-8 位字母数字混合
  m = text.match(new RegExp(
    keywords + "[^0-9A-Za-z]{0,40}((?=[0-9A-Za-z]*\\d)[0-9A-Za-z]{4,8})" + notFollowAlnum,
    'i'
  ));
  if (m) return m[1];

  // 4) 全局 6 位数字
  m = text.match(/(?<!\d)(\d{6})(?!\d)/);
  if (m) return m[1];

  // 5) 空格/横杠分隔的 6-8 位数字
  m = text.match(/(\d(?:[ \t-]\d){5,7})/);
  if (m) {
    const digits = m[1].replace(/\D/g, '');
    if (digits.length >= 4 && digits.length <= 8) return digits;
  }

  return '';
}

/**
 * 应用会话 UI
 * @param {object} session - 会话数据
 * @param {object} elements - DOM 元素引用
 */
export function applySessionUI(session, elements = {}) {
  try {
    const badge = document.getElementById('role-badge');
    if (badge) {
      badge.className = 'role-badge';
      if (session.strictAdmin) {
        badge.classList.add('role-super');
        badge.textContent = '超级管理员';
      } else if (session.role === 'admin') {
        badge.classList.add('role-admin');
        badge.textContent = `高级用户：${session.username || ''}`;
      } else if (session.role === 'user') {
        badge.classList.add('role-user');
        badge.textContent = `用户：${session.username || ''}`;
      } else if (session.role === 'guest') {
        badge.classList.add('role-user');
        badge.textContent = '演示模式';
      }
    }
    
    const adminLink = document.getElementById('admin');
    const allMailboxesLink = document.getElementById('all-mailboxes');
    
    if (session && (session.strictAdmin || session.role === 'guest')) {
      if (adminLink) adminLink.style.display = 'inline-flex';
      if (allMailboxesLink) allMailboxesLink.style.display = 'inline-flex';
    } else {
      if (adminLink) adminLink.style.display = 'none';
      if (allMailboxesLink) allMailboxesLink.style.display = 'none';
    }
  } catch (_) {}
}

/**
 * 显示内联提示（使用 toast）
 * @param {HTMLElement} anchorEl - 锚点元素（未使用）
 * @param {string} message - 消息
 * @param {string} type - 类型
 */
export function showInlineTip(anchorEl, message, type = 'info') {
  try {
    if (typeof showToast === 'function') {
      showToast(message, type);
    }
  } catch (_) {}
}

/**
 * 创建骨架屏邮件项
 * @returns {string}
 */
export function createSkeletonEmailItem() {
  return `
    <div class="email-item skeleton-item">
      <div class="skeleton-avatar"></div>
      <div class="email-content">
        <div class="skeleton-line sender-line"></div>
        <div class="skeleton-line subject-line"></div>
        <div class="skeleton-line preview-line"></div>
      </div>
      <div class="skeleton-line time-line"></div>
    </div>
  `;
}

/**
 * 生成骨架屏列表
 * @param {number} count - 数量
 * @returns {string}
 */
export function generateSkeletonList(count = 5) {
  return Array(count).fill(null).map(() => createSkeletonEmailItem()).join('');
}

// 导出默认对象
export default {
  formatTs,
  formatTsMobile,
  escapeHtml,
  escapeAttr,
  setButtonLoading,
  restoreButton,
  extractCode,
  applySessionUI,
  showInlineTip,
  createSkeletonEmailItem,
  generateSkeletonList
};
