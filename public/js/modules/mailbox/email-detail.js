/**
 * 邮件详情模块
 * @module modules/mailbox/email-detail
 */

import { escapeHtml, escapeAttr } from '../app/ui-helpers.js';
import { formatTime } from './email-list.js';

/**
 * 渲染邮件详情
 * @param {object} email - 邮件数据
 * @returns {string}
 */
export function renderEmailDetail(email) {
  if (!email) {
    return '<div class="empty-detail">请选择一封邮件</div>';
  }
  
  const sender = escapeHtml(email.sender || '未知发件人');
  const to = escapeHtml(email.to_addrs || '');
  const subject = escapeHtml(email.subject || '(无主题)');
  const receivedAt = formatTime(email.received_at);
  const verificationCode = email.verification_code || '';
  
  // 优先使用 HTML 内容
  let content = '';
  if (email.html_content) {
    // 对 HTML 内容进行安全处理
    content = sanitizeHtml(email.html_content);
  } else {
    content = `<pre style="white-space: pre-wrap; word-break: break-word;">${escapeHtml(email.content || '')}</pre>`;
  }
  
  return `
    <div class="email-detail">
      <div class="detail-header">
        <h2 class="detail-subject">${subject}</h2>
        <div class="detail-meta">
          <div class="meta-row">
            <span class="meta-label">发件人：</span>
            <span class="meta-value">${sender}</span>
          </div>
          ${to ? `
            <div class="meta-row">
              <span class="meta-label">收件人：</span>
              <span class="meta-value">${to}</span>
            </div>
          ` : ''}
          <div class="meta-row">
            <span class="meta-label">时间：</span>
            <span class="meta-value">${receivedAt}</span>
          </div>
          ${verificationCode ? `
            <div class="meta-row verification-code">
              <span class="meta-label">验证码：</span>
              <span class="meta-value code-value" title="点击复制">${escapeHtml(verificationCode)}</span>
            </div>
          ` : ''}
        </div>
      </div>
      <div class="detail-body">
        ${content}
      </div>
    </div>
  `;
}

/**
 * 简单的 HTML 清理（移除危险标签和属性）
 * @param {string} html - 原始 HTML
 * @returns {string}
 */
export function sanitizeHtml(html) {
  if (!html) return '';
  
  // 创建一个临时容器
  const temp = document.createElement('div');
  temp.innerHTML = html;
  
  // 移除危险标签
  const dangerousTags = ['script', 'style', 'iframe', 'object', 'embed', 'form'];
  dangerousTags.forEach(tag => {
    const elements = temp.querySelectorAll(tag);
    elements.forEach(el => el.remove());
  });
  
  // 移除危险属性
  const dangerousAttrs = ['onclick', 'onerror', 'onload', 'onmouseover', 'onfocus', 'onblur'];
  const allElements = temp.querySelectorAll('*');
  allElements.forEach(el => {
    dangerousAttrs.forEach(attr => {
      el.removeAttribute(attr);
    });
    
    // 处理 href 和 src 中的 javascript:
    if (el.hasAttribute('href') && el.getAttribute('href').toLowerCase().startsWith('javascript:')) {
      el.removeAttribute('href');
    }
    if (el.hasAttribute('src') && el.getAttribute('src').toLowerCase().startsWith('javascript:')) {
      el.removeAttribute('src');
    }
  });
  
  return temp.innerHTML;
}

/**
 * 渲染邮件模态框内容
 * @param {object} email - 邮件数据
 * @returns {string}
 */
export function renderEmailModal(email) {
  if (!email) return '';
  
  const subject = escapeHtml(email.subject || '(无主题)');
  const sender = escapeHtml(email.sender || '未知发件人');
  const to = escapeHtml(email.to_addrs || '');
  const receivedAt = formatTime(email.received_at);
  const verificationCode = email.verification_code || '';
  
  let content = '';
  if (email.html_content) {
    content = sanitizeHtml(email.html_content);
  } else {
    content = `<pre style="white-space: pre-wrap; word-break: break-word;">${escapeHtml(email.content || '')}</pre>`;
  }
  
  return `
    <div class="modal-header">
      <h3 class="modal-title">${subject}</h3>
      <button class="modal-close" data-action="close">&times;</button>
    </div>
    <div class="modal-meta">
      <p><strong>发件人：</strong>${sender}</p>
      ${to ? `<p><strong>收件人：</strong>${to}</p>` : ''}
      <p><strong>时间：</strong>${receivedAt}</p>
      ${verificationCode ? `
        <p class="verification-code">
          <strong>验证码：</strong>
          <span class="code-value" data-code="${escapeAttr(verificationCode)}" title="点击复制">${escapeHtml(verificationCode)}</span>
        </p>
      ` : ''}
    </div>
    <div class="modal-body">
      ${content}
    </div>
    <div class="modal-footer">
      <button class="btn btn-danger" data-action="delete" data-email-id="${email.id}">删除邮件</button>
      <button class="btn btn-secondary" data-action="close">关闭</button>
    </div>
  `;
}

/**
 * 提取邮件中的验证码
 * @param {string} text - 邮件内容
 * @returns {string}
 */
export function extractVerificationCode(text) {
  if (!text) return '';
  
  const keywords = '(?:验证码|校验码|激活码|verification\\s+code|security\\s+code|otp|code)';
  
  // 关键词后的 4-8 位数字
  let m = text.match(new RegExp(keywords + '[^0-9]{0,20}(\\d{4,8})', 'i'));
  if (m) return m[1];
  
  // 全局 6 位数字
  m = text.match(/(?<!\d)(\d{6})(?!\d)/);
  if (m) return m[1];
  
  return '';
}

// 导出默认对象
export default {
  renderEmailDetail,
  sanitizeHtml,
  renderEmailModal,
  extractVerificationCode
};
