/**
 * Freemail 主应用入口
 * @module app
 */

import { cacheGet, cacheSet, setCurrentUserKey, getCurrentUserKey } from './storage.js';
import { openForwardDialog, toggleFavorite, injectDialogStyles } from './mailbox-settings.js';
import IconHelper from './modules/icons.js';

// 导入模块
import { formatTs, formatTsMobile, extractCode, escapeHtml, escapeAttr } from './modules/app/ui-helpers.js';
import { mockApi, MOCK_STATE } from './modules/app/mock-api.js';
import { showConfirm } from './modules/app/confirm-dialog.js';
import { startAutoRefresh, stopAutoRefresh, initVisibilityTracking } from './modules/app/auto-refresh.js';
import { getCurrentMailbox, setCurrentMailbox, loadCurrentMailbox, clearCurrentMailbox, setCurrentMailboxInfo, getCurrentMailboxInfo } from './modules/app/mailbox-state.js';
import { renderPager, sliceByPage, prevPage, nextPage, resetPager, setView, isSentViewActive, renderEmailItem, markViewLoaded, isFirstLoad } from './modules/app/email-list.js';
import { renderMailboxList, renderMbPager, getCurrentPage, setCurrentPage, getPageSize, prevMbPage, nextMbPage, resetMbPage, setSearchTerm, getSearchTerm, setLoading, isLoadingMailboxes, setLastCount, getLastCount } from './modules/app/mailbox-list.js';
import { initSessionFromCache, validateSession, isGuest, isAdmin, applySessionUI, initGuestMode } from './modules/app/session.js';
import { loadDomains, getStoredLength, saveLength, updateRangeProgress, getSelectedDomainIndex, populateDomains, STORAGE_KEYS } from './modules/app/domains.js';
import { initCompose, showSentEmailDetail } from './modules/app/compose.js';
import { showEmailDetail, deleteEmailById, deleteSentById, copyFromEmailList, prefetchEmails } from './modules/app/email-viewer.js';
import { generateMailbox, generateNameMailbox, createCustomMailbox, updateEmailDisplay, selectMailboxAddress, toggleMailboxPin, deleteMailboxAddress, copyMailboxAddress, clearAllEmails, logout } from './modules/app/mailbox-actions.js';

// 全局状态
window.__GUEST_MODE__ = false;
window.__MOCK_STATE__ = MOCK_STATE;
try { if (sessionStorage.getItem('mf:just_logged_in') === '1') sessionStorage.removeItem('mf:just_logged_in'); } catch(_) {}

// 注入弹窗样式
injectDialogStyles();

// API 请求封装
async function api(path, options) {
  if (window.__GUEST_MODE__) return mockApi(path, options);
  const res = await fetch(path, options);
  if (res.status === 401) {
    if (location.pathname !== '/html/login.html') location.replace('/html/login.html');
    throw new Error('unauthorized');
  }
  return res;
}

// 加载模板
const app = document.getElementById('app');
const templateResp = await fetch('/html/app.html', { cache: 'force-cache' }).catch(() => null);
app.innerHTML = templateResp && templateResp.ok ? await templateResp.text() : await (await fetch('/html/app.html', { cache: 'no-cache' })).text();

// DOM 元素
const els = {
  email: document.getElementById('email'), gen: document.getElementById('gen'), genName: document.getElementById('gen-name'),
  copy: document.getElementById('copy'), clear: document.getElementById('clear'), list: document.getElementById('list'),
  listCard: document.getElementById('list-card'), tabInbox: document.getElementById('tab-inbox'), tabSent: document.getElementById('tab-sent'),
  boxTitle: document.getElementById('box-title'), boxIcon: document.getElementById('box-icon'), refresh: document.getElementById('refresh'),
  logout: document.getElementById('logout'), modal: document.getElementById('email-modal'), modalClose: document.getElementById('modal-close'),
  modalSubject: document.getElementById('modal-subject'), modalContent: document.getElementById('modal-content'),
  mbList: document.getElementById('mb-list'), mbSearch: document.getElementById('mb-search'), mbLoading: document.getElementById('mb-loading'),
  toast: document.getElementById('toast'), mbPager: document.getElementById('mb-pager'), mbPrev: document.getElementById('mb-prev'),
  mbNext: document.getElementById('mb-next'), mbPageInfo: document.getElementById('mb-page-info'), listLoading: document.getElementById('list-status'),
  confirmModal: document.getElementById('confirm-modal'), confirmClose: document.getElementById('confirm-close'),
  confirmMessage: document.getElementById('confirm-message'), confirmCancel: document.getElementById('confirm-cancel'), confirmOk: document.getElementById('confirm-ok'),
  emailActions: document.getElementById('email-actions'), toggleCustom: document.getElementById('toggle-custom'),
  customOverlay: document.getElementById('custom-overlay'), customLocalOverlay: document.getElementById('custom-local-overlay'),
  createCustomOverlay: document.getElementById('create-custom-overlay'), compose: document.getElementById('compose'),
  composeModal: document.getElementById('compose-modal'), composeClose: document.getElementById('compose-close'),
  composeTo: document.getElementById('compose-to'), composeSubject: document.getElementById('compose-subject'),
  composeHtml: document.getElementById('compose-html') || document.getElementById('compose-body'),
  composeFromName: document.getElementById('compose-from-name'), composeCancel: document.getElementById('compose-cancel'), composeSend: document.getElementById('compose-send'),
  pager: document.getElementById('list-pager'), prevPage: document.getElementById('prev-page'), nextPage: document.getElementById('next-page'), pageInfo: document.getElementById('page-info'),
  sidebarToggle: document.getElementById('sidebar-toggle'), sidebarToggleIcon: document.getElementById('sidebar-toggle-icon'),
  sidebar: document.querySelector('.sidebar'), container: document.querySelector('.container'),
  forwardSetting: document.getElementById('forward-setting'), toggleFavorite: document.getElementById('toggle-favorite'),
  favoriteIcon: document.getElementById('favorite-icon'), favoriteText: document.getElementById('favorite-text')
};
const lenRange = document.getElementById('len-range'), lenVal = document.getElementById('len-val'), domainSelect = document.getElementById('domain-select');

// 初始化
initSessionFromCache();
// showToast 由 toast-utils.js 全局提供
const showToast = window.showToast || ((msg, type) => console.log(`[${type}] ${msg}`));

// 刷新状态
const REFRESH_INTERVAL = 15;
let countdown = REFRESH_INTERVAL;
function showHeaderLoading(t) { if (els.listLoading) { els.listLoading.innerHTML = `<span class="spinner"></span>${t || '加载中…'}`; els.listLoading.style.display = 'flex'; }}
function hideHeaderLoading() { if (els.listLoading) els.listLoading.style.display = 'none'; }
function showCountdown() { if (els.listLoading) { els.listLoading.innerHTML = `<span class="countdown-icon">⏱</span>${countdown}s 后刷新`; els.listLoading.style.display = 'flex'; }}

// 刷新邮件列表
async function refresh() {
  const mailbox = getCurrentMailbox();
  if (!mailbox) return;
  try {
    showHeaderLoading(isFirstLoad() ? '加载中…' : '正在更新…');
    if (isFirstLoad() && els.list) els.list.innerHTML = '';
    const url = !isSentViewActive() ? `/api/emails?mailbox=${encodeURIComponent(mailbox)}` : `/api/sent?from=${encodeURIComponent(mailbox)}`;
    const ctrl = new AbortController(); const timeout = setTimeout(() => ctrl.abort(), 8000);
    let emails = [];
    try { const r = await api(url, { signal: ctrl.signal }); emails = await r.json(); } finally { clearTimeout(timeout); }
    if (!Array.isArray(emails) || !emails.length) {
      els.list.innerHTML = `<div class="empty-state">
        <svg class="empty-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <use href="/icons/sprites.svg#icon-inbox"/>
        </svg>
        <span class="empty-text">暂无邮件</span>
      </div>`;
      if (els.pager) els.pager.style.display = 'none';
      return;
    }
    const isMobile = window.matchMedia?.('(max-width: 900px)').matches;
    els.list.innerHTML = sliceByPage(emails, els).map(e => renderEmailItem(e, isMobile)).join('');
    if (!isSentViewActive()) prefetchEmails(emails, api);
    markViewLoaded();
  } catch (_) {}
  finally { hideHeaderLoading(); if (getCurrentMailbox()) { countdown = REFRESH_INTERVAL; showCountdown(); } }
}

function autoRefreshCallback() { if (countdown > 0) { countdown--; showCountdown(); if (countdown <= 0) refresh().finally(() => { countdown = REFRESH_INTERVAL; showCountdown(); }); }}

// 加载邮箱列表
async function loadMailboxes(opts = {}) {
  if (isLoadingMailboxes() && !opts.forceFresh) return;
  setLoading(true);
  if (els.mbLoading) els.mbLoading.style.display = 'flex';
  try {
    let url = `/api/mailboxes?page=${getCurrentPage()}&size=${getPageSize()}`;
    const search = getSearchTerm(); if (search) url += `&q=${encodeURIComponent(search)}`;
    const r = await api(url); const data = await r.json();
    const list = Array.isArray(data) ? data : (data.list || []); const total = data.total || list.length;
    setLastCount(total); renderMailboxList(list, els.mbList); renderMbPager(els, total);
    try { const q = document.getElementById('quota'); if (q) q.textContent = `${total} 邮箱`; } catch(_) {}
  } catch(_) {}
  finally { setLoading(false); if (els.mbLoading) els.mbLoading.style.display = 'none'; }
}

function updateMailboxInfoUI(info) {
  if (!info) return;
  if (els.favoriteIcon && els.favoriteText) {
    els.favoriteIcon.innerHTML = IconHelper.star(18, 18, info.is_favorite);
    els.favoriteText.textContent = info.is_favorite ? '已收藏' : '收藏邮箱';
  }
}

// 全局函数
window.selectMailbox = (addr) => selectMailboxAddress(addr, els, api, refresh, autoRefreshCallback, updateMailboxInfoUI);
window.togglePin = (e, addr) => toggleMailboxPin(e, addr, api, showToast, loadMailboxes);
window.deleteMailbox = (e, addr) => deleteMailboxAddress(e, addr, els, api, showToast, showConfirm, loadMailboxes);
window.showEmail = (id) => showEmailDetail(id, els, api, showToast);
window.showSentEmail = async (id) => { try { const r = await api(`/api/sent/${id}`); showSentEmailDetail(await r.json(), els); } catch(e) { showToast(e.message || '加载失败', 'error'); }};
window.deleteEmail = (id) => deleteEmailById(id, api, showToast, showConfirm, refresh);
window.deleteSent = (id) => deleteSentById(id, api, showToast, showConfirm, refresh);
window.copyFromList = (e, id) => copyFromEmailList(e, id, api, showToast);
window.refreshEmails = refresh;

// 事件绑定
if (els.gen) els.gen.onclick = () => generateMailbox(els, lenRange, domainSelect, api, showToast, refresh, loadMailboxes, autoRefreshCallback, updateMailboxInfoUI);
if (els.genName) els.genName.onclick = () => generateNameMailbox(els, lenRange, domainSelect, api, showToast, refresh, loadMailboxes, autoRefreshCallback, updateMailboxInfoUI);
if (els.copy) els.copy.onclick = () => copyMailboxAddress(showToast);
if (els.clear) els.clear.onclick = () => clearAllEmails(api, showToast, showConfirm, refresh);
if (els.refresh) els.refresh.onclick = refresh;
if (els.logout) els.logout.addEventListener('click', async () => {
  try { await fetch('/api/logout', { method: 'POST' }); } catch(_) {}
  location.replace('/html/login.html');
});
if (els.modalClose) els.modalClose.onclick = () => els.modal?.classList.remove('show');
els.modal?.addEventListener('click', (e) => { if (e.target === els.modal) els.modal.classList.remove('show'); });

// 视图切换
if (els.tabInbox) els.tabInbox.onclick = () => { setView(false); els.tabInbox.classList.add('active'); els.tabSent?.classList.remove('active'); if (els.boxTitle) els.boxTitle.textContent = '收件箱'; if (els.boxIcon) els.boxIcon.textContent = '📥'; resetPager(els); refresh(); };
if (els.tabSent) els.tabSent.onclick = () => { setView(true); els.tabSent.classList.add('active'); els.tabInbox?.classList.remove('active'); if (els.boxTitle) els.boxTitle.textContent = '发件箱'; if (els.boxIcon) els.boxIcon.textContent = '📤'; resetPager(els); refresh(); };

// 分页
if (els.prevPage) els.prevPage.onclick = () => prevPage(refresh);
if (els.nextPage) els.nextPage.onclick = () => nextPage(refresh);
if (els.mbPrev) els.mbPrev.onclick = () => prevMbPage(loadMailboxes);
if (els.mbNext) els.mbNext.onclick = () => nextMbPage(loadMailboxes, getLastCount());

// 搜索
if (els.mbSearch) { let t = null; els.mbSearch.oninput = () => { if (t) clearTimeout(t); t = setTimeout(() => { setSearchTerm(els.mbSearch.value); resetMbPage(); loadMailboxes(); }, 300); };}

// 长度滑块
if (lenRange && lenVal) { lenRange.value = String(getStoredLength()); lenVal.textContent = String(getStoredLength()); updateRangeProgress(lenRange); lenRange.oninput = () => { lenVal.textContent = lenRange.value; saveLength(Number(lenRange.value)); updateRangeProgress(lenRange); };}

// 自定义邮箱
if (els.toggleCustom) els.toggleCustom.onclick = () => { if (els.customOverlay) { const vis = els.customOverlay.style.display !== 'none'; els.customOverlay.style.display = vis ? 'none' : 'flex'; if (!vis) setTimeout(() => els.customLocalOverlay?.focus(), 50); }};
if (els.createCustomOverlay) els.createCustomOverlay.onclick = () => createCustomMailbox(els, domainSelect, api, showToast, loadMailboxes);

// 侧边栏
if (els.sidebarToggle) { els.sidebarToggle.onclick = () => { els.sidebar?.classList.toggle('collapsed'); els.container?.classList.toggle('sidebar-collapsed'); const c = els.sidebar?.classList.contains('collapsed'); if (els.sidebarToggleIcon) els.sidebarToggleIcon.textContent = c ? '▶' : '◀'; localStorage.setItem('sidebar-collapsed', c ? '1' : '0'); }; if (localStorage.getItem('sidebar-collapsed') === '1') { els.sidebar?.classList.add('collapsed'); els.container?.classList.add('sidebar-collapsed'); if (els.sidebarToggleIcon) els.sidebarToggleIcon.textContent = '▶'; }}

// 转发和收藏
if (els.forwardSetting) els.forwardSetting.onclick = () => { 
  const i = getCurrentMailboxInfo(); 
  if (i && i.id) openForwardDialog(i.id, i.address, i.forward_to); 
  else showToast('请先选择一个邮箱', 'warn'); 
};
if (els.toggleFavorite) els.toggleFavorite.onclick = async () => { 
  const i = getCurrentMailboxInfo(); 
  if (i && i.id) { 
    try { 
      const result = await toggleFavorite(i.id); 
      if (result.success) {
        const newInfo = { ...i, is_favorite: result.is_favorite };
        setCurrentMailboxInfo(newInfo); 
        updateMailboxInfoUI(newInfo);
      }
    } catch(_) {} 
  } else showToast('请先选择一个邮箱', 'warn'); 
};

// 撰写
initCompose(els, api, showToast);

// 会话验证
(async () => {
  const s = await validateSession();
  if (!s) { clearCurrentMailbox(); stopAutoRefresh(); location.replace('/html/login.html'); return; }
  if (s.role === 'guest') { initGuestMode(); if (domainSelect) { domainSelect.innerHTML = '<option value="0">example.com</option>'; domainSelect.disabled = true; } populateDomains(['example.com'], domainSelect); }
  else await loadDomains(domainSelect, api);
  try { const qr = await api('/api/user/quota'); const q = await qr.json(); const el = document.getElementById('quota'); if (el && q) { el.textContent = isAdmin() ? `${q.total || 0} 邮箱` : `${q.used || 0} / ${q.limit || 0}`; }} catch(_) {}
  await loadMailboxes();
  
  // 优先使用 URL 参数中的邮箱，其次使用本地存储的上次邮箱
  const urlParams = new URLSearchParams(window.location.search);
  const urlMailbox = urlParams.get('mailbox');
  if (urlMailbox) {
    await window.selectMailbox(urlMailbox);
    // 清除 URL 参数，避免刷新时重复选择
    window.history.replaceState({}, '', window.location.pathname);
  } else {
    const last = loadCurrentMailbox(); 
    if (last) await window.selectMailbox(last);
  }
  
  initVisibilityTracking();
})();
