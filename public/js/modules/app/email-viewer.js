/**
 * 邮件查看模块
 * @module modules/app/email-viewer
 */

import { escapeHtml, escapeAttr, extractCode } from './ui-helpers.js';
import { getEmailFromCache, setEmailCache } from './email-list.js';

/**
 * 显示邮件详情
 * @param {number} id - 邮件ID
 * @param {object} elements - DOM 元素
 * @param {Function} api - API 函数
 * @param {Function} showToast - 提示函数
 */
export async function showEmailDetail(id, elements, api, showToast) {
  const { modal, modalSubject, modalContent } = elements;
  
  try {
    let email = getEmailFromCache(id);
    if (!email || (!email.html_content && !email.content)) {
      const r = await api(`/api/email/${id}`);
      email = await r.json();
      setEmailCache(id, email);
    }

    modalSubject.innerHTML = `<span class="modal-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="/icons/sprites.svg#icon-mail"/></svg></span><span>${escapeHtml(email.subject || '(无主题)')}</span>`;

    const code = email.verification_code || extractCode(email.content || email.html_content || '');

    let metaHtml = `<div class="email-meta-inline">`;
    if (email.sender) metaHtml += `<span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="/icons/sprites.svg#icon-user"/></svg> ${escapeHtml(email.sender)}</span>`;
    if (email.received_at) {
      const d = new Date((email.received_at.includes('T') ? email.received_at : email.received_at.replace(' ', 'T')) + 'Z');
      const timeStr = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
      metaHtml += `<span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="/icons/sprites.svg#icon-clock"/></svg> ${timeStr}</span>`;
    }
    if (email.download) metaHtml += `<span><a href="${email.download}" download style="color:var(--primary);text-decoration:none"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="/icons/sprites.svg#icon-download"/></svg> 下载 EML</a></span>`;
    metaHtml += `</div>`;

    let codeHtml = '';
    if (code) {
      codeHtml = `<div class="code-highlight" onclick="navigator.clipboard.writeText('${escapeAttr(code)}').then(()=>showToast('验证码已复制','success'))" title="点击复制" style="cursor:pointer">${escapeHtml(code)}</div>`;
    }

    let bodyHtml = '';
    if (email.html_content) {
      bodyHtml = `<div class="email-content-area"><iframe srcdoc="${escapeAttr(email.html_content)}" sandbox="allow-same-origin allow-popups" style="width:100%;min-height:400px;border:none;display:block"></iframe></div>`;
    } else {
      bodyHtml = `<div class="email-content-area"><pre class="email-content-text" style="white-space:pre-wrap;word-break:break-word">${escapeHtml(email.content || '')}</pre></div>`;
    }

    modalContent.innerHTML = `<div class="email-detail-container">${metaHtml}${codeHtml}${bodyHtml}</div>`;
    modal.classList.add('show');
  } catch(e) {
    showToast(e.message || '加载失败', 'error');
  }
}

/**
 * 删除邮件
 * @param {number} id - 邮件ID
 * @param {Function} api - API 函数
 * @param {Function} showToast - 提示函数
 * @param {Function} showConfirm - 确认函数
 * @param {Function} refresh - 刷新函数
 */
export async function deleteEmailById(id, api, showToast, showConfirm, refresh) {
  const confirmed = await showConfirm('确定删除这封邮件？');
  if (!confirmed) return;
  
  try {
    const r = await api(`/api/email/${id}`, { method: 'DELETE' });
    if (r.ok) {
      showToast('邮件已删除', 'success');
      await refresh();
    }
  } catch(e) {
    showToast(e.message || '删除失败', 'error');
  }
}

/**
 * 删除已发送邮件
 * @param {number} id - 邮件ID
 * @param {Function} api - API 函数
 * @param {Function} showToast - 提示函数
 * @param {Function} showConfirm - 确认函数
 * @param {Function} refresh - 刷新函数
 */
export async function deleteSentById(id, api, showToast, showConfirm, refresh) {
  const confirmed = await showConfirm('确定删除这条发送记录？');
  if (!confirmed) return;
  
  try {
    const r = await api(`/api/sent/${id}`, { method: 'DELETE' });
    if (r.ok) {
      showToast('记录已删除', 'success');
      await refresh();
    }
  } catch(e) {
    showToast(e.message || '删除失败', 'error');
  }
}

/**
 * 从列表复制验证码或内容
 * @param {Event} event - 事件
 * @param {number} id - 邮件ID
 * @param {Function} api - API 函数
 * @param {Function} showToast - 提示函数
 */
export async function copyFromEmailList(event, id, api, showToast) {
  const btn = event.target.closest('button');
  const code = btn?.dataset?.code;
  
  if (code) {
    try {
      await navigator.clipboard.writeText(code);
      showToast(`验证码 ${code} 已复制`, 'success');
    } catch(_) {
      showToast('复制失败', 'error');
    }
  } else {
    let email = getEmailFromCache(id);
    if (!email) {
      const r = await api(`/api/email/${id}`);
      email = await r.json();
      setEmailCache(id, email);
    }
    const text = email.content || email.html_content?.replace(/<[^>]+>/g, ' ') || '';
    try {
      await navigator.clipboard.writeText(text.slice(0, 500));
      showToast('内容已复制', 'success');
    } catch(_) {
      showToast('复制失败', 'error');
    }
  }
}

/**
 * 预取邮件详情
 * @param {Array} emails - 邮件列表
 * @param {Function} api - API 函数
 */
export async function prefetchEmails(emails, api) {
  const top = emails.slice(0, 5);
  for (const e of top) {
    if (!getEmailFromCache(e.id)) {
      try {
        const r = await api(`/api/email/${e.id}`);
        const detail = await r.json();
        setEmailCache(e.id, detail);
      } catch(_) {}
    }
  }
}

export default {
  showEmailDetail,
  deleteEmailById,
  deleteSentById,
  copyFromEmailList,
  prefetchEmails
};
