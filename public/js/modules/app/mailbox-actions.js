/**
 * 邮箱操作模块
 * @module modules/app/mailbox-actions
 */

import { setCurrentMailbox, getCurrentMailbox, clearCurrentMailbox, setCurrentMailboxInfo } from './mailbox-state.js';
import { setButtonLoading, restoreButton } from './ui-helpers.js';
import { generateRandomId } from './random-name.js';
import { getStoredLength, saveLength, getSelectedDomainIndex } from './domains.js';
import { startAutoRefresh, stopAutoRefresh } from './auto-refresh.js';
import { resetPager } from './email-list.js';
import { resetMbPage } from './mailbox-list.js';

async function responseError(response, fallback) {
  try {
    const body = await response.json();
    if (body?.error || body?.message) return body.error || body.message;
  } catch (_) { }
  return fallback;
}

/**
 * 生成随机邮箱
 * @param {object} elements - DOM 元素
 * @param {HTMLInputElement} lenRange - 长度滑块
 * @param {HTMLSelectElement} domainSelect - 域名选择器
 * @param {Function} api - API 函数
 * @param {Function} showToast - 提示函数
 * @param {Function} refresh - 刷新函数
 * @param {Function} loadMailboxes - 加载邮箱函数
 * @param {Function} autoRefreshCallback - 自动刷新回调
 */
export async function generateMailbox(elements, lenRange, domainSelect, api, showToast, refresh, loadMailboxes, autoRefreshCallback, updateMailboxInfoUI) {
  const { gen, email, emailActions, listCard } = elements;
  
  try {
    setButtonLoading(gen, '生成中…');
    const len = Number(lenRange?.value || getStoredLength());
    const domainIndex = getSelectedDomainIndex(domainSelect);
    
    const r = await api(`/api/generate?length=${len}&domainIndex=${domainIndex}`);
    if (!r.ok) throw new Error(await r.text());
    
    const data = await r.json();
    saveLength(len);
    
    setCurrentMailbox(data.email);
    updateEmailDisplay(elements, data.email);
    
    // 获取完整的邮箱信息（包括 id、is_favorite 等）
    try {
      const infoRes = await api(`/api/mailbox/info?address=${encodeURIComponent(data.email)}`);
      if (infoRes.ok) {
        const info = await infoRes.json();
        setCurrentMailboxInfo(info);
        if (updateMailboxInfoUI) updateMailboxInfoUI(info);
      }
    } catch(_) {}
    
    showToast('邮箱生成成功！', 'success');
    startAutoRefresh(autoRefreshCallback);
    await refresh();
    
    resetMbPage();
    await loadMailboxes({ forceFresh: true });
  } catch(e) {
    showToast(e.message || '生成失败', 'error');
  } finally {
    restoreButton(gen);
  }
}

/**
 * 批量生成随机邮箱
 */
export async function generateBatchMailboxes(elements, lenRange, domainSelect, api, showToast, refresh, loadMailboxes, autoRefreshCallback, updateMailboxInfoUI) {
  const { genBatch, batchCount } = elements;
  const count = Number(batchCount?.value || 0);
  if (!Number.isInteger(count) || count < 1 || count > 100) {
    showToast('生成数量必须是 1 到 100 之间的整数', 'warn');
    return;
  }

  try {
    setButtonLoading(genBatch, '批量生成中…');
    const length = Number(lenRange?.value || getStoredLength());
    const domainIndex = getSelectedDomainIndex(domainSelect);
    const response = await api('/api/generate/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count, length, domainIndex })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || '批量生成失败');
    const emails = Array.isArray(data.emails) ? data.emails : [];
    if (!emails.length) throw new Error('没有成功生成邮箱');

    saveLength(length);
    const selected = emails[emails.length - 1];
    setCurrentMailbox(selected);
    updateEmailDisplay(elements, selected);

    try {
      const infoResponse = await api(`/api/mailbox/info?address=${encodeURIComponent(selected)}`);
      if (infoResponse.ok) {
        const info = await infoResponse.json();
        setCurrentMailboxInfo(info);
        if (updateMailboxInfoUI) updateMailboxInfoUI(info);
      }
    } catch (_) { }

    const failed = Number(data.fail_count || 0);
    showToast(
      failed ? `已生成 ${emails.length} 个邮箱，${failed} 个失败` : `已生成 ${emails.length} 个邮箱`,
      failed ? 'warn' : 'success'
    );
    startAutoRefresh(autoRefreshCallback);
    await refresh();
    resetMbPage();
    await loadMailboxes({ forceFresh: true });
  } catch (error) {
    showToast(error.message || '批量生成失败', 'error');
  } finally {
    restoreButton(genBatch);
  }
}

/**
 * 生成随机人名邮箱
 * @param {object} elements - DOM 元素
 * @param {HTMLInputElement} lenRange - 长度滑块
 * @param {HTMLSelectElement} domainSelect - 域名选择器
 * @param {Function} api - API 函数
 * @param {Function} showToast - 提示函数
 * @param {Function} refresh - 刷新函数
 * @param {Function} loadMailboxes - 加载邮箱函数
 * @param {Function} autoRefreshCallback - 自动刷新回调
 */
export async function generateNameMailbox(elements, lenRange, domainSelect, api, showToast, refresh, loadMailboxes, autoRefreshCallback, updateMailboxInfoUI) {
  const { genName } = elements;
  
  try {
    setButtonLoading(genName, '生成中…');
    const len = Number(lenRange?.value || getStoredLength());
    const domainIndex = getSelectedDomainIndex(domainSelect);
    const localName = generateRandomId(len);
    
    const r = await api('/api/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ local: localName, domainIndex })
    });
    
    if (!r.ok) throw new Error(await r.text());
    const data = await r.json();
    saveLength(len);
    
    setCurrentMailbox(data.email);
    updateEmailDisplay(elements, data.email);
    
    // 获取完整的邮箱信息（包括 id、is_favorite 等）
    try {
      const infoRes = await api(`/api/mailbox/info?address=${encodeURIComponent(data.email)}`);
      if (infoRes.ok) {
        const info = await infoRes.json();
        setCurrentMailboxInfo(info);
        if (updateMailboxInfoUI) updateMailboxInfoUI(info);
      }
    } catch(_) {}
    
    showToast('随机人名邮箱生成成功！', 'success');
    startAutoRefresh(autoRefreshCallback);
    await refresh();
    
    resetMbPage();
    await loadMailboxes({ forceFresh: true });
  } catch(e) {
    showToast(e.message || '生成失败', 'error');
  } finally {
    restoreButton(genName);
  }
}

/**
 * 创建自定义邮箱
 * @param {object} elements - DOM 元素
 * @param {HTMLSelectElement} domainSelect - 域名选择器
 * @param {Function} api - API 函数
 * @param {Function} showToast - 提示函数
 * @param {Function} loadMailboxes - 加载邮箱函数
 */
export async function createCustomMailbox(elements, domainSelect, api, showToast, loadMailboxes) {
  const { customLocalOverlay, customOverlay } = elements;
  
  try {
    const local = (customLocalOverlay?.value || '').trim();
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(local)) {
      showToast('用户名不合法，仅限字母/数字/._-', 'warn');
      return;
    }
    const domainIndex = getSelectedDomainIndex(domainSelect);
    
    const r = await api('/api/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ local, domainIndex })
    });
    
    if (!r.ok) throw new Error(await r.text());
    const data = await r.json();
    
    setCurrentMailbox(data.email);
    updateEmailDisplay(elements, data.email);
    if (customOverlay) customOverlay.style.display = 'none';
    
    showToast('已创建邮箱：' + data.email, 'success');
    await loadMailboxes({ forceFresh: true });
  } catch(e) {
    showToast(e.message || '创建失败', 'error');
  }
}

/**
 * 更新邮箱显示
 * @param {object} elements - DOM 元素
 * @param {string} address - 邮箱地址
 */
export function updateEmailDisplay(elements, address) {
  const { email, emailActions, listCard } = elements;
  const emailText = document.getElementById('email-text');
  if (emailText) emailText.textContent = address;
  else if (email) email.textContent = address;
  
  email?.classList.add('has-email');
  if (emailActions) emailActions.style.display = 'grid';
  if (listCard) listCard.style.display = 'block';
}

/**
 * 选择邮箱
 * @param {string} address - 邮箱地址
 * @param {object} elements - DOM 元素
 * @param {Function} api - API 函数
 * @param {Function} refresh - 刷新函数
 * @param {Function} autoRefreshCallback - 自动刷新回调
 * @param {Function} updateMailboxInfoUI - 更新邮箱信息UI函数
 */
export async function selectMailboxAddress(address, elements, api, refresh, autoRefreshCallback, updateMailboxInfoUI) {
  setCurrentMailbox(address);
  updateEmailDisplay(elements, address);
  
  // 更新侧边栏选中状态
  document.querySelectorAll('.mailbox-item').forEach(el => {
    el.classList.toggle('selected', el.querySelector('.address')?.textContent === address);
  });
  
  // 加载邮箱信息
  try {
    const r = await api(`/api/mailbox/info?address=${encodeURIComponent(address)}`);
    if (r.ok) {
      const info = await r.json();
      setCurrentMailboxInfo(info);
      updateMailboxInfoUI(info);
    }
  } catch(_) {}
  
  // 重置分页并刷新
  resetPager(elements);
  startAutoRefresh(autoRefreshCallback);
  await refresh();
}

/**
 * 置顶/取消置顶邮箱
 * @param {Event} event - 事件
 * @param {string} address - 邮箱地址
 * @param {Function} api - API 函数
 * @param {Function} showToast - 提示函数
 * @param {Function} loadMailboxes - 加载邮箱函数
 */
export async function toggleMailboxPin(event, address, api, showToast, loadMailboxes) {
  event.stopPropagation();
  try {
    const r = await api(`/api/mailboxes/pin?address=${encodeURIComponent(address)}`, { method: 'POST' });
    if (r.ok) {
      showToast('操作成功', 'success');
      await loadMailboxes({ forceFresh: true });
    }
  } catch(e) {
    showToast(e.message || '操作失败', 'error');
  }
}

/**
 * 删除邮箱
 * @param {Event} event - 事件
 * @param {string} address - 邮箱地址
 * @param {object} elements - DOM 元素
 * @param {Function} api - API 函数
 * @param {Function} showToast - 提示函数
 * @param {Function} showConfirm - 确认函数
 * @param {Function} loadMailboxes - 加载邮箱函数
 */
export async function deleteMailboxAddress(event, address, elements, api, showToast, showConfirm, loadMailboxes) {
  event.stopPropagation();
  const confirmed = await showConfirm(`确定删除邮箱 ${address}？收件箱和发件箱中的所有邮件都会被删除。`);
  if (!confirmed) return;
  
  try {
    const r = await api(`/api/mailboxes?address=${encodeURIComponent(address)}`, { method: 'DELETE' });
    if (!r.ok) throw new Error(await responseError(r, '删除失败'));
    showToast('邮箱已删除', 'success');
    if (getCurrentMailbox() === address) {
      clearCurrentMailbox();
      const emailText = document.getElementById('email-text');
      if (emailText) emailText.textContent = '点击生成邮箱';
      elements.email?.classList.remove('has-email');
      if (elements.emailActions) elements.emailActions.style.display = 'none';
      if (elements.listCard) elements.listCard.style.display = 'none';
      if (elements.list) elements.list.innerHTML = '';
      stopAutoRefresh();
    }
    await loadMailboxes({ forceFresh: true });
  } catch(e) {
    showToast(e.message || '删除失败', 'error');
  }
}

/**
 * 复制邮箱地址
 * @param {Function} showToast - 提示函数
 */
export async function copyMailboxAddress(showToast) {
  const mailbox = getCurrentMailbox();
  if (!mailbox) {
    showToast('请先生成或选择一个邮箱', 'warn');
    return;
  }
  try {
    await navigator.clipboard.writeText(mailbox);
    showToast(`已复制：${mailbox}`, 'success');
  } catch(_) {
    showToast('复制失败', 'error');
  }
}

/**
 * 清空邮件
 * @param {Function} api - API 函数
 * @param {Function} showToast - 提示函数
 * @param {Function} showConfirm - 确认函数
 * @param {Function} refresh - 刷新函数
 */
export async function clearAllEmails(api, showToast, showConfirm, refresh) {
  const mailbox = getCurrentMailbox();
  if (!mailbox) {
    showToast('请先选择一个邮箱', 'warn');
    return;
  }
  const confirmed = await showConfirm(`确定清空 ${mailbox} 的收件箱和发件箱？`);
  if (!confirmed) return;
  
  try {
    const r = await api(`/api/emails?mailbox=${encodeURIComponent(mailbox)}`, { method: 'DELETE' });
    if (!r.ok) throw new Error(await responseError(r, '清空失败'));
    showToast('邮件已清空', 'success');
    await refresh();
  } catch(e) {
    showToast(e.message || '清空失败', 'error');
  }
}

/**
 * 登出
 * @param {Function} api - API 函数
 */
export async function logout(api) {
  try {
    await api('/api/logout', { method: 'POST' });
  } catch(_) {}
  
  try {
    clearCurrentMailbox();
  } catch(_) {}
  
  try {
    stopAutoRefresh();
  } catch(_) {}
  
  // 确保跳转一定执行
  window.location.replace('/html/login.html');
}

export default {
  generateMailbox,
  generateBatchMailboxes,
  generateNameMailbox,
  createCustomMailbox,
  updateEmailDisplay,
  selectMailboxAddress,
  toggleMailboxPin,
  deleteMailboxAddress,
  copyMailboxAddress,
  clearAllEmails,
  logout
};
