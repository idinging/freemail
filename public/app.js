import { cacheGet, cacheSet, readPrefetch, setCurrentUserKey } from './storage.js';

window.__GUEST_MODE__ = false;
window.__MOCK_STATE__ = { domains: ['example.com'], mailboxes: [], emailsByMailbox: new Map() };

async function mockApi(path, options){
  const url = new URL(path, location.origin);
  const jsonHeaders = { 'Content-Type': 'application/json' };
  // domains
  if (url.pathname === '/api/domains'){
    return new Response(JSON.stringify(window.__MOCK_STATE__.domains), { headers: jsonHeaders });
  }
  // generate
  if (url.pathname === '/api/generate'){
    const len = Number(url.searchParams.get('length') || '8');
    const id = (window.MockData?.mockGenerateId ? window.MockData.mockGenerateId(len) : String(Math.random()).slice(2,10));
    const domain = window.__MOCK_STATE__.domains[Number(url.searchParams.get('domainIndex')||0)] || 'example.com';
    const email = `${id}@${domain}`;
    // 记录至内存历史
    window.__MOCK_STATE__.mailboxes.unshift({ address: email, created_at: new Date().toISOString().replace('T',' ').slice(0,19), is_pinned: 0 });
    return new Response(JSON.stringify({ email, expires: Date.now() + 3600000 }), { headers: jsonHeaders });
  }
  // emails list
  if (url.pathname === '/api/emails' && (!options || options.method === undefined || options.method === 'GET')){
    const mailbox = url.searchParams.get('mailbox') || '';
    let list = window.__MOCK_STATE__.emailsByMailbox.get(mailbox);
    if (!list) {
      const built = window.MockData?.buildMockEmails ? window.MockData.buildMockEmails(6) : [];
      window.__MOCK_STATE__.emailsByMailbox.set(mailbox, built);
      list = built;
    }
    return new Response(JSON.stringify(list), { headers: jsonHeaders });
  }
  // email detail
  if (url.pathname.startsWith('/api/email/') && (!options || options.method === undefined || options.method === 'GET')){
    const id = Number(url.pathname.split('/')[3]);
    const firstMailbox = window.__MOCK_STATE__.emailsByMailbox.keys().next().value;
    let list = firstMailbox ? window.__MOCK_STATE__.emailsByMailbox.get(firstMailbox) : null;
    if (!list || !list.length) {
      const built = window.MockData?.buildMockEmails ? window.MockData.buildMockEmails(6) : [];
      window.__MOCK_STATE__.emailsByMailbox.set('demo@example.com', built);
      list = built;
    }
    const found = (window.MockData?.buildMockEmailDetail ? window.MockData.buildMockEmailDetail(id) : (list.find(x=>x.id===id) || list[0]));
    return new Response(JSON.stringify(found), { headers: jsonHeaders });
  }
  // mailboxes list
  if (url.pathname === '/api/mailboxes' && (!options || options.method === undefined || options.method === 'GET')){
    const mb = window.__MOCK_STATE__.mailboxes.length ? window.__MOCK_STATE__.mailboxes : (window.MockData?.buildMockMailboxes ? window.MockData.buildMockMailboxes(6,0,window.__MOCK_STATE__.domains) : []);
    if (!window.__MOCK_STATE__.mailboxes.length) window.__MOCK_STATE__.mailboxes = mb;
    
    // 按置顶状态和时间排序
    const sortedMailboxes = mb.sort((a, b) => {
      // 首先按置顶状态排序（置顶的在前）
      if (a.is_pinned !== b.is_pinned) {
        return (b.is_pinned || 0) - (a.is_pinned || 0);
      }
      // 然后按创建时间排序（新的在前）
      return new Date(b.created_at) - new Date(a.created_at);
    });
    
    return new Response(JSON.stringify(sortedMailboxes.slice(0,10)), { headers: jsonHeaders });
  }

  // toggle pin (demo mode)
  if (url.pathname === '/api/mailboxes/pin' && options && options.method === 'POST'){
    const address = url.searchParams.get('address');
    if (!address) return new Response('缺少 address 参数', { status: 400 });
    
    // 在演示模式下，简单地切换置顶状态
    const mailbox = window.__MOCK_STATE__.mailboxes.find(m => m.address === address);
    if (mailbox) {
      mailbox.is_pinned = mailbox.is_pinned ? 0 : 1;
      return new Response(JSON.stringify({ success: true, is_pinned: mailbox.is_pinned }), { headers: jsonHeaders });
    }
    return new Response('邮箱不存在', { status: 404 });
  }

  // create custom mailbox (demo mode): accept POST /api/create
  if (url.pathname === '/api/create' && options && options.method === 'POST'){
    try{
      const bodyText = options.body || '{}';
      const body = typeof bodyText === 'string' ? JSON.parse(bodyText || '{}') : (bodyText || {});
      const local = String((body.local || '').trim());
      if (!/^[A-Za-z0-9._-]{1,64}$/.test(local)){
        return new Response('非法用户名', { status: 400 });
      }
      const domainIndex = Number(body.domainIndex || 0);
      const domain = (window.__MOCK_STATE__.domains || ['example.com'])[isNaN(domainIndex)?0:Math.max(0, Math.min((window.__MOCK_STATE__.domains||['example.com']).length-1, domainIndex))] || 'example.com';
      const email = `${local}@${domain}`;
      const item = { address: email, created_at: new Date().toISOString().replace('T',' ').slice(0,19), is_pinned: 0 };
      window.__MOCK_STATE__.mailboxes.unshift(item);
      return new Response(JSON.stringify({ email, expires: Date.now() + 3600000 }), { headers: jsonHeaders });
    }catch(_){ return new Response('Bad Request', { status: 400 }); }
  }
  // destructive operations in demo
  if ((url.pathname === '/api/emails' && (options?.method === 'DELETE')) ||
      (url.pathname.startsWith('/api/email/') && (options?.method === 'DELETE')) ||
      (url.pathname === '/api/mailboxes' && (options?.method === 'DELETE'))){
    return new Response('演示模式不可操作', { status: 403 });
  }
  // default: 404
  return new Response('Not Found', { status: 404 });
}

async function api(path, options){
  if (window.__GUEST_MODE__) return mockApi(path, options);
  const res = await fetch(path, options);
  if (res.status === 401) {
    // 避免重复跳转
    if (location.pathname !== '/login.html') {
      location.replace('/login.html');
    }
    throw new Error('unauthorized');
  }
  return res;
}

// 将 D1 返回的 UTC 时间（YYYY-MM-DD HH:MM:SS）格式化为东八区显示
function formatTs(ts){
  if (!ts) return '';
  try {
    // 统一转成 ISO 再追加 Z 标记为 UTC
    const iso = ts.includes('T') ? ts.replace(' ', 'T') : ts.replace(' ', 'T');
    const d = new Date(iso + 'Z');
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour12: false,
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).format(d);
  } catch (_) { return ts; }
}

// 从文本/HTML中尽量提取激活码/验证码（优先纯数字，避免误识别纯字母词如 "expires"/"Welcome"）
function extractCode(text){
  if (!text) return '';
  const keywords = '(?:验证码|校验码|激活码|one[-\\s]?time\\s+code|verification\\s+code|security\\s+code|two[-\\s]?factor|2fa|otp|login\\s+code|code)';
  const notFollowAlnum = '(?![0-9A-Za-z])';

  // 1) 关键词 + 连接词（是/为/冒号/is）附近的 4-8 位纯数字（避免截取邮箱中的长数字前缀）
  let m = text.match(new RegExp(
    keywords + "[^0-9A-Za-z]{0,20}(?:is(?:\s*[:：])?|[:：]|为|是)?[^0-9A-Za-z]{0,10}(\\d{4,8})" + notFollowAlnum,
    'i'
  ));
  if (m) return m[1];

  // 2) 关键词 + 连接词 附近的 空格/横杠 分隔数字（合并）
  m = text.match(new RegExp(
    keywords + "[^0-9A-Za-z]{0,20}(?:is(?:\s*[:：])?|[:：]|为|是)?[^0-9A-Za-z]{0,10}((?:\\d[ \\t-]){3,7}\\d)",
    'i'
  ));
  if (m){
    const digits = m[1].replace(/\\D/g, '');
    if (digits.length >= 4 && digits.length <= 8) return digits;
  }

  // 3) 关键词附近的 4-8 位字母数字，但必须含数字，且末尾不跟字母数字（避免邮箱/长串）
  m = text.match(new RegExp(
    keywords + "[^0-9A-Za-z]{0,40}((?=[0-9A-Za-z]*\\d)[0-9A-Za-z]{4,8})" + notFollowAlnum,
    'i'
  ));
  if (m) return m[1];

  // 4) 全局常见 6 位数字（不位于更长数字串中）
  m = text.match(/(?<!\d)(\d{6})(?!\d)/);
  if (m) return m[1];

  // 5) 全局 空格/横杠 分隔的 6-8 位数字
  m = text.match(/(\d(?:[ \t-]\d){5,7})/);
  if (m){
    const digits = m[1].replace(/\D/g, '');
    if (digits.length >= 4 && digits.length <= 8) return digits;
  }

  return '';
}

// 初始化流程将会在模板加载后进行（见 init()）

const app = document.getElementById('app');
// 优先使用预加载缓存，加速首屏模板加载
const templateResp = await fetch('/templates/app.html', { cache: 'force-cache' }).catch(()=>null);
const __templateHtml = templateResp && templateResp.ok ? await templateResp.text() : await (await fetch('/templates/app.html', { cache: 'no-cache' })).text();
app.innerHTML = __templateHtml;

const els = {
  email: document.getElementById('email'),
  gen: document.getElementById('gen'),
  copy: document.getElementById('copy'),
  clear: document.getElementById('clear'),
  list: document.getElementById('list'),
  listCard: document.getElementById('list-card'),
  tabInbox: document.getElementById('tab-inbox'),
  tabSent: document.getElementById('tab-sent'),
  boxTitle: document.getElementById('box-title'),
  boxIcon: document.getElementById('box-icon'),
  refresh: document.getElementById('refresh'),
  logout: document.getElementById('logout'),
  modal: document.getElementById('email-modal'),
  modalClose: document.getElementById('modal-close'),
  modalSubject: document.getElementById('modal-subject'),
  modalContent: document.getElementById('modal-content'),
  mbList: document.getElementById('mb-list'),
  mbLoading: document.getElementById('mb-loading'),
  toast: document.getElementById('toast'),
  mbMore: document.getElementById('mb-more'),
  mbMoreText: document.getElementById('mb-more-text'),
  listLoading: document.getElementById('list-loading'),
  confirmModal: document.getElementById('confirm-modal'),
  confirmClose: document.getElementById('confirm-close'),
  confirmMessage: document.getElementById('confirm-message'),
  confirmCancel: document.getElementById('confirm-cancel'),
  confirmOk: document.getElementById('confirm-ok'),
  emailActions: document.getElementById('email-actions'),
  toggleCustom: document.getElementById('toggle-custom'),
  customOverlay: document.getElementById('custom-overlay'),
  customLocalOverlay: document.getElementById('custom-local-overlay'),
  createCustomOverlay: document.getElementById('create-custom-overlay'),
  compose: document.getElementById('compose'),
  composeModal: document.getElementById('compose-modal'),
  composeClose: document.getElementById('compose-close'),
  composeTo: document.getElementById('compose-to'),
  composeSubject: document.getElementById('compose-subject'),
  composeHtml: (document.getElementById('compose-html') || document.getElementById('compose-body')),
  composeFromName: document.getElementById('compose-from-name'),
  composeCancel: document.getElementById('compose-cancel'),
  composeSend: document.getElementById('compose-send')
};
// 管理入口（默认隐藏，登录后按角色显示）
const adminLink = document.getElementById('admin');

// ===== 本地缓存（按用户隔离）：已抽离到 storage.js =====

function applySessionUI(s){
  try{
    const badge = document.getElementById('role-badge');
    if (badge){
      badge.className = 'role-badge';
      if (s.strictAdmin){ badge.classList.add('role-super'); badge.textContent = '超级管理员'; }
      else if (s.role === 'admin'){ badge.classList.add('role-admin'); badge.textContent = `高级用户：${s.username||''}`; }
      else if (s.role === 'user'){ badge.classList.add('role-user'); badge.textContent = `用户：${s.username||''}`; }
      else if (s.role === 'guest'){ badge.classList.add('role-user'); badge.textContent = '演示模式'; }
    }
    if (s && (s.strictAdmin || s.role === 'guest') && adminLink){ adminLink.style.display = 'inline-flex'; } else if (adminLink){ adminLink.style.display = 'none'; }
  }catch(_){ }
}

// 页面初始化时尝试用缓存的会话渲染顶栏（stale-while-revalidate）
try{
  const cachedS = cacheGet('session', 24*60*60*1000);
  if (cachedS){
    setCurrentUserKey(`${cachedS.role || ''}:${cachedS.username || ''}`);
    applySessionUI(cachedS);
  }
}catch(_){ }

// 预取逻辑已抽离至 storage.js
async function showToast(message, type='info'){
  try{
    const res = await fetch('/templates/toast.html', { cache: 'no-cache' });
    const tpl = await res.text();
    const html = tpl.replace('{{type}}', String(type||'info')).replace('{{message}}', String(message||''));
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    // 注入样式（仅一次）
    const styleEl = wrapper.querySelector('#toast-style');
    if (styleEl && !document.getElementById('toast-style')){
      document.head.appendChild(styleEl);
    }
    // 插入 toast 元素
    const toastEl = wrapper.querySelector('.toast-item');
    if (toastEl){
      els.toast.appendChild(toastEl);
      setTimeout(()=>{
        toastEl.style.transition = 'opacity .3s ease';
        toastEl.style.opacity = '0';
        setTimeout(()=>toastEl.remove(), 300);
      }, 2000);
    }
  }catch(_){
    // 回退：若模板加载失败，使用最简文本提示
    const div = document.createElement('div');
    div.className = `toast-item ${type}`;
    div.textContent = message;
    els.toast.appendChild(div);
    setTimeout(()=>{ div.style.transition='opacity .3s ease'; div.style.opacity='0'; setTimeout(()=>div.remove(),300); }, 2000);
  }
}

// 统一按钮加载态
function setButtonLoading(button, loadingText){
  if (!button) return;
  if (button.dataset.loading === '1') return;
  button.dataset.loading = '1';
  button.dataset.originalHtml = button.innerHTML;
  button.disabled = true;
  const text = loadingText || '处理中…';
  button.innerHTML = `<div class="spinner"></div><span style="margin-left:8px">${text}</span>`;
}

function restoreButton(button){
  if (!button) return;
  const html = button.dataset.originalHtml;
  if (html){ button.innerHTML = html; }
  button.disabled = false;
  delete button.dataset.loading;
  delete button.dataset.originalHtml;
}

// 自定义确认对话框
function showConfirm(message, onConfirm, onCancel = null) {
  return new Promise((resolve) => {
    els.confirmMessage.textContent = message;
    els.confirmModal.classList.add('show');
    
    const handleConfirm = () => {
      els.confirmModal.classList.remove('show');
      cleanup();
      resolve(true);
      if (onConfirm) onConfirm();
    };
    
    const handleCancel = () => {
      els.confirmModal.classList.remove('show');
      cleanup();
      resolve(false);
      if (onCancel) onCancel();
    };
    
    const cleanup = () => {
      els.confirmOk.removeEventListener('click', handleConfirm);
      els.confirmCancel.removeEventListener('click', handleCancel);
      els.confirmClose.removeEventListener('click', handleCancel);
    };
    
    els.confirmOk.addEventListener('click', handleConfirm);
    els.confirmCancel.addEventListener('click', handleCancel);
    els.confirmClose.addEventListener('click', handleCancel);
  });
}


const lenRange = document.getElementById('len-range');
const lenVal = document.getElementById('len-val');
const domainSelect = document.getElementById('domain-select');
// 右侧自定义已移除，保留覆盖层方式
const STORAGE_KEYS = { domain: 'mailfree:lastDomain', length: 'mailfree:lastLen' };

function updateRangeProgress(input){
  if (!input) return;
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const val = Number(input.value || min);
  const percent = ((val - min) * 100) / (max - min);
  input.style.background = `linear-gradient(to right, var(--primary) ${percent}%, var(--border-light) ${percent}%)`;
}

// 右侧自定义入口已移除

// 切换自定义输入显隐
if (els.toggleCustom){
  els.toggleCustom.onclick = () => {
    if (els.customOverlay){
      // 始终允许展开/收起，与邮箱状态无关
      const style = getComputedStyle(els.customOverlay);
      const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      els.customOverlay.style.display = isVisible ? 'none' : 'flex';
      if (!isVisible) setTimeout(()=>els.customLocalOverlay?.focus(), 50);
    }
  };
}

// 覆盖层创建
if (els.createCustomOverlay){
  els.createCustomOverlay.onclick = async () => {
    try{
      const local = (els.customLocalOverlay?.value || '').trim();
      if (!/^[A-Za-z0-9._-]{1,64}$/.test(local)) { showToast('用户名不合法，仅限字母/数字/._-', 'warn'); return; }
      const domainIndex = Number(domainSelect?.value || 0);
      const r = await api('/api/create', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ local, domainIndex }) });
      if (!r.ok){ const t = await r.text(); throw new Error(t); }
      const data = await r.json();
      window.currentMailbox = data.email;
      // 如果已显示在邮箱框中，更新文本节点
      const t = document.getElementById('email-text');
      if (t) t.textContent = data.email; else els.email.textContent = data.email;
      els.email.classList.add('has-email');
      els.emailActions.style.display = 'flex';
      els.listCard.style.display = 'block';
      showToast('已创建邮箱：' + data.email, 'success');
      els.customOverlay.style.display = 'none';
      // 重置历史分页偏移，确保显示最新的第一页
      if (typeof mbOffset !== 'undefined') { mbOffset = 0; }
      await loadMailboxes(false);
    }catch(e){ showToast(String(e?.message || '已达到邮箱上限或创建失败'), 'warn'); }
  };
}

// 初始化长度：默认读取历史值（8-30 之间），否则为 8
if (lenRange && lenVal){
  const storedLen = Number(localStorage.getItem(STORAGE_KEYS.length) || '8');
  const clamped = Math.max(8, Math.min(30, isNaN(storedLen) ? 8 : storedLen));
  lenRange.value = String(clamped);
  lenVal.textContent = String(clamped);
  updateRangeProgress(lenRange);
  lenRange.addEventListener('input', ()=>{
    const v = Number(lenRange.value);
    const cl = Math.max(8, Math.min(30, isNaN(v) ? 8 : v));
    lenVal.textContent = String(cl);
    localStorage.setItem(STORAGE_KEYS.length, String(cl));
    updateRangeProgress(lenRange);
  });
}

// 将域名列表填充到下拉框，并恢复上次选择
function populateDomains(domains){
  if (!domainSelect) return;
  const list = Array.isArray(domains) ? domains : [];
  domainSelect.innerHTML = list.map((d,i)=>`<option value="${i}">${d}</option>`).join('');
  const stored = localStorage.getItem(STORAGE_KEYS.domain) || '';
  const idx = stored ? list.indexOf(stored) : -1;
  domainSelect.selectedIndex = idx >= 0 ? idx : 0;
  domainSelect.addEventListener('change', ()=>{
    const opt = domainSelect.options[domainSelect.selectedIndex];
    if (opt) localStorage.setItem(STORAGE_KEYS.domain, opt.textContent || '');
  }, { once: true });
}

// 拉取域名列表（后端在 server.js 解析自环境变量，前端通过一个轻量接口暴露）
async function loadDomains(){
  if (window.__GUEST_MODE__) {
    // 不发任何请求，直接使用 example.com 并且清空历史，避免旧域名显示
    populateDomains(['example.com']);
    try{ els.mbList && (els.mbList.innerHTML = ''); window.__MOCK_STATE__.mailboxes = []; }catch(_){ }
    try{ const quotaEl = document.getElementById('quota'); if (quotaEl) quotaEl.textContent = '0 / 10'; }catch(_){ }
    return;
  }
  let domainSet = false;
  try{
    const cached = cacheGet('domains', 24*60*60*1000);
    if (Array.isArray(cached) && cached.length){
      populateDomains(cached);
      domainSet = true;
    }
  }catch(_){ }
  try{
    const prefetched = readPrefetch('mf:prefetch:domains');
    if (Array.isArray(prefetched) && prefetched.length){
      populateDomains(prefetched);
      domainSet = true;
    }
  }catch(_){ }
  try{
    const r = await api('/api/domains');
    const domains = await r.json();
    if (Array.isArray(domains) && domains.length){
      populateDomains(domains);
      cacheSet('domains', domains);
      domainSet = true;
    }
  }catch(_){ }
  if (!domainSet){
    const meta = (document.querySelector('meta[name="mail-domains"]')?.getAttribute('content') || '').split(',').map(s=>s.trim()).filter(Boolean);
    const fallback = [];
    if (window.currentMailbox && window.currentMailbox.includes('@')) fallback.push(window.currentMailbox.split('@')[1]);
    if (!meta.length && location.hostname) fallback.push(location.hostname);
    const list = [...new Set(meta.length ? meta : fallback)].filter(Boolean);
    populateDomains(list);
  }
}
// 延迟到会话判定后再加载域名，避免访客模式提前请求真实接口

// 会话校验与访客模式处理（在模板装载并拿到 DOM 引用之后执行）
(async () => {
  try {
    const r = await fetch('/api/session');
    if (!r.ok) { 
      // 如果认证失败，跳转到登录页
      location.replace('/login.html'); 
      return; 
    }
    const s = await r.json();
    try{
      // 持久化会话到本地，用于下次快速渲染
      cacheSet('session', s);
      setCurrentUserKey(`${s.role || ''}:${s.username || ''}`);
    }catch(_){ }
    // 角色徽章 + 管理入口
    try{
      const badge = document.getElementById('role-badge');
      if (badge){
        badge.className = 'role-badge';
        if (s.strictAdmin){ badge.classList.add('role-super'); badge.textContent = '超级管理员'; }
        else if (s.role === 'admin'){ badge.classList.add('role-admin'); badge.textContent = `高级用户：${s.username||''}`; }
        else if (s.role === 'user'){ badge.classList.add('role-user'); badge.textContent = `用户：${s.username||''}`; }
        else if (s.role === 'guest'){ badge.classList.add('role-user'); badge.textContent = '演示模式'; }
      }
      if (s && (s.strictAdmin || s.role === 'guest') && adminLink){ adminLink.style.display = 'inline-flex'; } else if (adminLink){ adminLink.style.display = 'none'; }
    }catch(_){ }
    if (s.role === 'guest') {
      window.__GUEST_MODE__ = true;
      window.__MOCK_STATE__ = { domains: ['example.com'], mailboxes: [], emailsByMailbox: new Map() };
      const bar = document.createElement('div');
      bar.className = 'demo-banner';
      bar.innerHTML = '👀 当前为 <strong>观看模式</strong>（模拟数据，仅演示）。要接收真实邮件，请自建部署或联系部署。';
      document.body.prepend(bar);
      // 强制 UI 仅显示 example.com
      const exampleOnly = ['example.com'];
      if (domainSelect){
        domainSelect.innerHTML = exampleOnly.map((d,i)=>`<option value="${i}">${d}</option>`).join('');
        domainSelect.selectedIndex = 0;
        domainSelect.disabled = true;
      }
      if (els && els.email){
        els.email.classList.remove('has-email');
        // 保留覆盖层节点，仅更新文本占位
        const t = document.getElementById('email-text');
        if (t){
          t.innerHTML = '<span class="placeholder-text">点击右侧生成按钮创建邮箱地址</span>';
        } else {
          // 兜底：若 email-text 丢失，则重建结构但不移除覆盖层
          const overlay = els.customOverlay;
          els.email.textContent = '';
          const span = document.createElement('span');
          span.id = 'email-text';
          span.className = 'email-text';
          span.innerHTML = '<span class="placeholder-text">点击右侧生成按钮创建邮箱地址</span>';
          els.email.appendChild(span);
          if (overlay && !overlay.isConnected){ els.email.appendChild(overlay); }
        }
      }
    }
    // 现在再并行加载域名与历史邮箱（避免在演示模式下发起真实请求）
    await Promise.all([
      (typeof loadDomains === 'function') ? loadDomains() : Promise.resolve(),
      (typeof loadMailboxes === 'function') ? loadMailboxes(false) : Promise.resolve()
    ]);
  } catch (error) {
    console.error('认证检查失败:', error);
    // 如果认证检查失败，跳转到登录页
    location.replace('/login.html');
  }
})();

els.gen.onclick = async () => {
  try {
    setButtonLoading(els.gen, '正在生成…');
    const len = Number((lenRange && lenRange.value) || localStorage.getItem(STORAGE_KEYS.length) || 8);
    const domainIndex = Number(domainSelect?.value || 0);
    const r = await api(`/api/generate?length=${Math.max(8, Math.min(30, isNaN(len) ? 8 : len))}&domainIndex=${isNaN(domainIndex)?0:domainIndex}`);
    if (!r.ok){ const t = await r.text(); throw new Error(t); }
    const data = await r.json();
    // 持久化选择
    try{
      localStorage.setItem(STORAGE_KEYS.length, String(Math.max(8, Math.min(30, isNaN(len) ? 8 : len))));
      const opt = domainSelect?.options?.[domainIndex];
      if (opt) localStorage.setItem(STORAGE_KEYS.domain, opt.textContent || '');
    }catch(_){ }
    window.currentMailbox = data.email;
    const t = document.getElementById('email-text');
    if (t) t.textContent = data.email; else els.email.textContent = data.email;
    els.email.classList.add('has-email');
    els.emailActions.style.display = 'flex';
    els.listCard.style.display = 'block';
    // 重启自动刷新
    startAutoRefresh();
    
    showToast('邮箱生成成功！', 'success');
    // 成功后尽早复位按钮，避免后续刷新异常导致按钮卡在加载态
    try { restoreButton(els.gen); } catch(_) {}
    await refresh();
    // 重置历史分页偏移，确保显示最新的第一页
    if (typeof mbOffset !== 'undefined') { mbOffset = 0; }
    await loadMailboxes(false);
  } catch (e){ showToast(String(e?.message || '已达到邮箱上限或创建失败'), 'warn'); }
  finally { restoreButton(els.gen); }
}

els.copy.onclick = async () => {
  if (!window.currentMailbox) return;
  try { await navigator.clipboard.writeText(window.currentMailbox); } catch {}
  const t = els.copy.textContent; els.copy.textContent='✅ 已复制'; setTimeout(()=>els.copy.textContent=t,1500);
}

els.clear.onclick = async () => {
  if (!window.currentMailbox) {
    showToast('请先生成或选择一个邮箱', 'warn');
    return;
  }
  
  const confirmed = await showConfirm(
    `确定要清空邮箱 ${window.currentMailbox} 的所有邮件吗？此操作不可撤销！`
  );
  
  if (!confirmed) return;
  
  try {
    const response = await api(`/api/emails?mailbox=${encodeURIComponent(window.currentMailbox)}`, { 
      method: 'DELETE' 
    });
    
    if (response.ok) {
      const result = await response.json();
      
      if (result.deletedCount !== undefined) {
        let message = `邮件已成功清空 (删除了 ${result.deletedCount} 封邮件)`;
        if (result.previousCount !== undefined) {
          message = `邮件已成功清空 (之前有 ${result.previousCount} 封，删除了 ${result.deletedCount} 封)`;
        }
        showToast(message, 'success');
      } else if (result.message) {
        showToast(`清空完成: ${result.message}`, 'success');
      } else {
        showToast('邮件已成功清空', 'success');
      }
      
      await refresh();
    } else {
      const errorText = await response.text();
      showToast(`清空失败: ${errorText}`, 'warn');
    }
  } catch (e) {
    showToast('清空邮件时发生网络错误', 'warn');
  }
}

// 简单的内存缓存：邮件详情
const emailCache = new Map(); // id -> email json
let isSentView = false; // false: 收件箱 true: 发件箱
// 视图首载状态：key = `${isSentView?'S':'I'}::${mailbox}`
const viewLoaded = new Set();
function getViewKey(){ return `${isSentView ? 'S' : 'I'}::${window.currentMailbox || ''}`; }
function showHeaderLoading(text){
  if (!els.listLoading) return;
  try{
    const span = els.listLoading.querySelector('span');
    if (span) span.textContent = text || '加载中…';
  }catch(_){ }
  els.listLoading.classList.add('show');
}
function hideHeaderLoading(){ if (els.listLoading) els.listLoading.classList.remove('show'); }

async function refresh(){
  if (!window.currentMailbox) return;
  try {
    const key = getViewKey();
    const isFirst = !viewLoaded.has(key);
    showHeaderLoading(isFirst ? '加载中…' : '正在更新…');
    if (isFirst && els.list) els.list.innerHTML = '';
    const url = !isSentView ? `/api/emails?mailbox=${encodeURIComponent(window.currentMailbox)}` : `/api/sent?from=${encodeURIComponent(window.currentMailbox)}`;
    // 增加超时与 AbortController，避免慢接口长时间阻塞
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let emails = [];
    try{
      const r = await api(url, { signal: controller.signal });
      emails = await r.json();
    }finally{ clearTimeout(timeout); }
    if (!Array.isArray(emails) || emails.length===0) { 
      els.list.innerHTML = '<div style="text-align:center;color:#64748b">📭 暂无邮件</div>'; 
      return; 
    }
    els.list.innerHTML = emails.map(e => {
      // 智能内容预览处理
      let rawContent = isSentView ? (e.text_content || e.html_content || '') : (e.content || e.html_content || '');
      let preview = '';
      
      if (rawContent) {
        // 移除HTML标签并清理空白字符
        preview = rawContent
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        
        // 检测验证码
        const codeMatch = extractCode(rawContent);
        if (codeMatch) {
          preview = `验证码: ${codeMatch} | ${preview.slice(0, 80)}`;
        } else {
          preview = preview.slice(0, 120);
        }
      }
      
      const hasContent = preview.length > 0;
      
      return `
      <div class="email-item clickable" onclick="${isSentView ? `showSentEmail(${e.id})` : `showEmail(${e.id})`}">
        <div class="email-meta">
          <div class="email-sender">
            <span class="sender-icon">${isSentView ? '📤' : '👤'}</span>
            <span class="sender-name">${isSentView ? (Array.isArray(e.recipients)? e.recipients : e.recipients)?.toString() : e.sender}</span>
          </div>
          <span class="email-time">
            <span class="time-icon">🕐</span>
            ${formatTs(e.received_at || e.created_at)}
          </span>
        </div>
        <div class="email-content">
          <div class="email-main">
            <div class="email-subject">
              <span class="subject-icon">📩</span>
              ${e.subject || '(无主题)'}
            </div>
            ${hasContent ? `<div class="email-preview">${preview}${preview.length >= 120 ? '...' : ''}</div>` : ''}
          </div>
          <div class="email-actions">
            ${isSentView ? `
              <span class="status-badge ${statusClass(e.status)}">${e.status || 'unknown'}</span>
              <button class="btn btn-danger btn-sm" onclick="deleteSent(${e.id});event.stopPropagation()" title="删除记录">
                <span class="btn-icon">🗑️</span>
              </button>
            ` : `
              <button class="btn btn-secondary btn-sm" onclick="copyEmailContent(${e.id});event.stopPropagation()" title="复制内容">
                <span class="btn-icon">📋</span>
              </button>
              <button class="btn btn-danger btn-sm" onclick="deleteEmail(${e.id});event.stopPropagation()" title="删除邮件">
                <span class="btn-icon">🗑️</span>
              </button>
            `}
          </div>
        </div>
      </div>`;
    }).join('');
    // 预取前 5 封详情
    if (!isSentView) prefetchTopEmails(emails);
    // 标记视图已完成首载
    viewLoaded.add(key);
  } catch (e){ /* redirected */ }
  finally { hideHeaderLoading(); }
}

window.showEmail = async (id) => {
  try {
    let email = emailCache.get(id);
    if (!email) {
      const r = await api(`/api/email/${id}`);
      email = await r.json();
      emailCache.set(id, email);
    }
    els.modalSubject.innerHTML = `
      <span class="modal-icon">📧</span>
      <span>${email.subject || '(无主题)'}</span>
    `;
    
    // 详情页：优化结构和样式
    const raw = email.html_content || email.content || '';
    const text = `${email.subject || ''} ` + raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g,' ').trim();
    const code = extractCode(text);
    
    // 将纯文本中的换行转换为 <br>，让阅读更好；HTML 内容保持原样
    const bodyHtml = email.html_content ? email.html_content : (email.content || '').replace(/\n/g,'<br/>' );
    
    els.modalContent.innerHTML = `
      <div class="email-detail-container">
        <!-- 邮件元信息 -->
        <div class="email-meta-card">
          <div class="meta-item">
            <span class="meta-icon">👤</span>
            <span class="meta-label">发件人</span>
            <span class="meta-value">${email.sender}</span>
          </div>
          <div class="meta-item">
            <span class="meta-icon">🕐</span>
            <span class="meta-label">时间</span>
            <span class="meta-value">${formatTs(email.received_at)}</span>
          </div>
        </div>
        
        <!-- 操作按钮 -->
        <div class="email-actions-bar">
          <button class="btn btn-secondary btn-sm" onclick="copyEmailContent(${email.id})">
            <span class="btn-icon">📋</span>
            <span>复制内容</span>
          </button>
          ${code ? `
            <button class="btn btn-primary btn-sm" onclick="navigator.clipboard.writeText('${code}').then(()=>showToast('已复制验证码：${code}','success'))">
              <span class="btn-icon">🔐</span>
              <span>复制验证码</span>
            </button>
          ` : ''}
        </div>
        
        <!-- 邮件内容 -->
        <div class="email-content-area">
          ${bodyHtml ? `
            <div class="email-content-text">
              ${code ? `<div class="code-highlight">${code}</div>` : ''}
              ${bodyHtml}
            </div>
          ` : '<div class="email-no-content">📭 此邮件暂无内容</div>'}
        </div>
      </div>
    `;
    els.modal.classList.add('show');
    await refresh();
  } catch (e){ /* redirected */ }
}

window.copyEmailContent = async (id) => {
  try{
    let email = emailCache.get(id);
    if (!email) {
      if (!isSentView){
        const r = await api(`/api/email/${id}`);
        email = await r.json();
      } else {
        const r = await api(`/api/sent/${id}`);
        email = await r.json();
      }
      emailCache.set(id, email);
    }
    const raw = isSentView ? (email.html_content || email.text_content || '') : (email.html_content || email.content || '');
    // 去除 HTML 标签，并把主题也参与匹配（很多验证码在主题里）
    const text = `${email.subject || ''} ` + raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g,' ').trim();
    const code = extractCode(text);
    const toCopy = code || text;
    await navigator.clipboard.writeText(toCopy);
    showToast(code ? `已复制验证码/激活码：${code}` : '已复制邮件内容', 'success');
  }catch(_){ showToast('复制失败', 'warn'); }
}

window.deleteEmail = async (id) => {
  const confirmed = await showConfirm('确定要删除这封邮件吗？此操作不可撤销！');
  if (!confirmed) return;
  
  try {
    const response = await api(`/api/email/${id}`, { method: 'DELETE' });
    
    if (response.ok) {
      const result = await response.json();
      
      if (result.success) {
        // 从缓存中移除
        emailCache.delete(id);
        
        if (result.deleted) {
          showToast('邮件已删除', 'success');
        } else {
          showToast(result.message || '邮件删除状态未知', 'warn');
        }
        
        // 刷新邮件列表
        await refresh();
      } else {
        showToast(`删除失败: ${result.message || '未知错误'}`, 'warn');
      }
    } else {
      if (response.status === 403) {
        showToast('没权限删除', 'warn');
      } else {
        const errorText = await response.text();
        showToast(`删除失败: ${errorText}`, 'warn');
      }
    }
  } catch (e) {
    showToast('删除邮件时发生网络错误', 'warn');
  }
}

els.refresh.onclick = refresh;
if (adminLink){
  adminLink.addEventListener('click', (ev) => {
    ev.preventDefault();
    location.replace('/templates/loading.html?redirect=%2Fadmin.html&status=' + encodeURIComponent('正在打开管理页面…'));
  });
}

els.logout.onclick = async () => {
  try { fetch('/api/logout', { method:'POST', keepalive: true }); } catch {}
  try {
    // 标记来自登出，登录页跳过 session 检查
    sessionStorage.setItem('mf:just_logged_out', '1');
  } catch(_) {}
  location.replace('/login.html?from=logout');
}
els.modalClose.onclick = () => els.modal.classList.remove('show');

// 发信弹窗：在当前选中邮箱基础上发送
function openCompose(){
  if (!window.currentMailbox){ showToast('请先选择或生成邮箱', 'warn'); return; }
  if (!els.composeModal) return;
  els.composeTo.value = '';
  els.composeSubject.value = '';
  els.composeHtml.value = '';
  els.composeModal.classList.add('show');
}

function closeCompose(){
  els.composeModal?.classList.remove('show');
}

async function sendCompose(){
  try{
    setButtonLoading(els.composeSend, '正在发送…');
    if (!window.currentMailbox){ showToast('请先选择或生成邮箱', 'warn'); return; }
    const payload = {
      from: window.currentMailbox,
      to: (els.composeTo.value||'').split(',').map(s=>s.trim()).filter(Boolean),
      subject: (els.composeSubject.value||'').trim(),
      html: els.composeHtml.value || '',
      fromName: (els.composeFromName?.value || '').trim()
    };
    if (!payload.to.length){ showToast('请输入收件人', 'warn'); return; }
    // 主题可为空
    if (!payload.html){ showToast('请输入 HTML 内容', 'warn'); return; }
    // 自动生成 text 版本，增强兼容性
    try{
      const text = payload.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g,' ').trim();
      if (text) payload.text = text;
    }catch(_){ }
    const r = await api('/api/send', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    if (!r.ok){ const t = await r.text(); throw new Error(t); }
    const data = await r.json();
    showToast('发送成功：' + (data.id || ''), 'success');
    // 不再轮询状态；视为成功
    // 切换到发件箱视图并刷新列表
    switchToSent();
    closeCompose();
  }catch(e){ showToast('发送失败：' + (e?.message || e), 'warn'); }
  finally { restoreButton(els.composeSend); }
}

if (els.compose){ els.compose.onclick = openCompose; }
if (els.composeClose){ els.composeClose.onclick = closeCompose; }
if (els.composeCancel){ els.composeCancel.onclick = closeCompose; }
if (els.composeSend){ els.composeSend.onclick = sendCompose; }

// 点击遮罩层（弹窗外区域）关闭；按下 Esc 键也可关闭
if (els.modal){
  els.modal.addEventListener('click', (ev) => {
    const card = els.modal.querySelector('.modal-card');
    if (card && !card.contains(ev.target)) {
      els.modal.classList.remove('show');
    }
  });
}

// 确认对话框的遮罩层点击关闭
if (els.confirmModal){
  els.confirmModal.addEventListener('click', (ev) => {
    const card = els.confirmModal.querySelector('.modal-card');
    if (card && !card.contains(ev.target)) {
      els.confirmModal.classList.remove('show');
    }
  });
}

// 键盘快捷键支持
window.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') {
    if (els.confirmModal.classList.contains('show')){
      els.confirmModal.classList.remove('show');
    } else if (els.modal.classList.contains('show')){
      els.modal.classList.remove('show');
    }
  }
});

let mbOffset = 0;
const MB_PAGE_SIZE = 10;

async function loadMailboxes(isAppend = false){
  try{
    // 初始和分页加载时显示列表加载动画
    try{
      if (!isAppend && els.mbLoading){
        const tpl = await (await fetch('/templates/loading-inline.html', { cache: 'no-cache' })).text();
        els.mbLoading.innerHTML = tpl;
      }
      if (isAppend && els.mbMore){
        els.mbMore.disabled = true;
        if (els.mbMoreText) els.mbMoreText.textContent = '正在加载…';
      }
    }catch(_){ }
    // 同步显示配额（增加超时避免阻塞）
    try{
      // 先尝试使用本地缓存/预取的配额，提升首屏渲染速度
      const quotaCached = cacheGet('quota', 60*60*1000);
      const quotaPrefetched = readPrefetch('mf:prefetch:quota');
      const quotaEl = document.getElementById('quota');
      if (quotaEl && quotaCached && typeof quotaCached.used !== 'undefined' && typeof quotaCached.limit !== 'undefined'){
        quotaEl.textContent = `${quotaCached.used} / ${quotaCached.limit}`;
      } else if (quotaEl && quotaPrefetched && typeof quotaPrefetched.used !== 'undefined' && typeof quotaPrefetched.limit !== 'undefined'){
        quotaEl.textContent = `${quotaPrefetched.used} / ${quotaPrefetched.limit}`;
      }
      const qController = new AbortController();
      const qTimeout = setTimeout(()=>qController.abort(), 5000);
      const qr = await api('/api/user/quota', { signal: qController.signal });
      const q = await qr.json();
      clearTimeout(qTimeout);
      if (quotaEl && q && typeof q.used !== 'undefined' && typeof q.limit !== 'undefined'){
        quotaEl.textContent = `${q.used} / ${q.limit}`;
      }
      try{ cacheSet('quota', q); }catch(_){ }
    }catch(_){ }

    // 首屏优先消费缓存/预取的历史邮箱，避免重复等待慢接口
    if (!isAppend && mbOffset === 0){
      const mbCached = cacheGet('mailboxes:offset0', 6*60*60*1000);
      if (Array.isArray(mbCached)){
        const html = (mbCached||[]).map(x => (
          `<div class="mailbox-item ${x.is_pinned ? 'pinned' : ''}" onclick="selectMailbox('${x.address}')">
            <div class="mailbox-content">
              <span class="address">${x.address}</span>
              <span class="time">${formatTs(x.created_at)}</span>
            </div>
            <div class="mailbox-actions">
              <button class="btn btn-ghost btn-sm pin" onclick="togglePin(event,'${x.address}')" title="${x.is_pinned ? '取消置顶' : '置顶'}">
                ${x.is_pinned ? '📌' : '📍'}
              </button>
              <button class="btn btn-ghost btn-sm del" onclick="deleteMailbox(event,'${x.address}')" title="删除">🗑️</button>
            </div>
          </div>`
        )).join('');
        els.mbList.innerHTML = html || '<div style="color:#94a3b8">暂无历史邮箱</div>';
        if (els.mbLoading) els.mbLoading.innerHTML = '';
      }
      const mbPrefetched = readPrefetch('mf:prefetch:mailboxes');
      if (Array.isArray(mbPrefetched)){
        const html = (mbPrefetched||[]).map(x => (
          `<div class="mailbox-item ${x.is_pinned ? 'pinned' : ''}" onclick="selectMailbox('${x.address}')">
            <div class="mailbox-content">
              <span class="address">${x.address}</span>
              <span class="time">${formatTs(x.created_at)}</span>
            </div>
            <div class="mailbox-actions">
              <button class="btn btn-ghost btn-sm pin" onclick="togglePin(event,'${x.address}')" title="${x.is_pinned ? '取消置顶' : '置顶'}">
                ${x.is_pinned ? '📌' : '📍'}
              </button>
              <button class="btn btn-ghost btn-sm del" onclick="deleteMailbox(event,'${x.address}')" title="删除">🗑️</button>
            </div>
          </div>`
        )).join('');
        els.mbList.innerHTML = html || '<div style="color:#94a3b8">暂无历史邮箱</div>';
        if (els.mbLoading) els.mbLoading.innerHTML = '';
        // 预取当前邮箱列表前 5 封
        await prefetchTopEmails();
        return;
      }
    }

    const mController = new AbortController();
    const mTimeout = setTimeout(()=>mController.abort(), 8000);
    const r = await api(`/api/mailboxes?limit=${MB_PAGE_SIZE}&offset=${mbOffset}`, { signal: mController.signal });
    const items = await r.json();
    clearTimeout(mTimeout);
    const html = (items||[]).map(x => (
      `<div class="mailbox-item ${x.is_pinned ? 'pinned' : ''}" onclick="selectMailbox('${x.address}')">
        <div class="mailbox-content">
          <span class="address">${x.address}</span>
          <span class="time">${formatTs(x.created_at)}</span>
        </div>
        <div class="mailbox-actions">
          <button class="btn btn-ghost btn-sm pin" onclick="togglePin(event,'${x.address}')" title="${x.is_pinned ? '取消置顶' : '置顶'}">
            ${x.is_pinned ? '📌' : '📍'}
          </button>
          <button class="btn btn-ghost btn-sm del" onclick="deleteMailbox(event,'${x.address}')" title="删除">🗑️</button>
        </div>
      </div>`
    )).join('');
    if (isAppend) {
      els.mbList.insertAdjacentHTML('beforeend', html);
    } else {
      els.mbList.innerHTML = html || '<div style="color:#94a3b8">暂无历史邮箱</div>';
    }
    if (els.mbLoading) els.mbLoading.innerHTML = '';
    if (els.mbMore) {
      els.mbMore.style.display = (items && items.length === MB_PAGE_SIZE) ? 'inline-flex' : 'none';
      els.mbMore.disabled = false;
      if (els.mbMoreText) els.mbMoreText.textContent = '加载更多';
      const wrap = document.getElementById('mb-more-wrap');
      if (wrap) wrap.style.display = els.mbMore.style.display;
    }
    // 预取当前邮箱列表前 5 封
    await prefetchTopEmails();
    // 缓存第一页数据
    if (!isAppend && mbOffset === 0){
      try{ cacheSet('mailboxes:offset0', items || []); }catch(_){ }
    }
  }catch(_){ 
    if (els.mbLoading) els.mbLoading.innerHTML = '';
    els.mbList.innerHTML = '<div style="color:#dc2626">加载失败</div>'; 
    if (els.mbMore){
      els.mbMore.disabled = false;
      if (els.mbMoreText) els.mbMoreText.textContent = '加载更多';
    }
  }
}

window.selectMailbox = async (addr) => {
  const now = Date.now();
  if (window.__lastSelectClick && now - window.__lastSelectClick < 1000){ return; }
  window.__lastSelectClick = now;
  window.currentMailbox = addr;
  const t = document.getElementById('email-text');
  if (t) t.textContent = addr; else els.email.textContent = addr;
  els.email.classList.add('has-email');
  els.emailActions.style.display = 'flex';
  els.listCard.style.display = 'block';
  // 保持默认关闭，用户可点击按钮展开
  // 重启自动刷新
  startAutoRefresh();
  // 首次选择该视图/邮箱才清空，否则保留并仅显示右上角更新
  const key = getViewKey();
  if (!viewLoaded.has(key)) { if (els.list) els.list.innerHTML = ''; }
  await refresh();
  await prefetchTopEmails();
}

async function prefetchTopEmails(list){
  try{
    if (!window.currentMailbox) return;
    const emails = Array.isArray(list) ? list : (await (await api(`/api/emails?mailbox=${encodeURIComponent(window.currentMailbox)}`)).json());
    const top = (emails || []).slice(0,5);
    await Promise.all(top.map(async e => {
      if (emailCache.has(e.id)) return;
      const d = await api(`/api/email/${e.id}`);
      const full = await d.json();
      emailCache.set(e.id, full);
    }));
  }catch(_){ }
}

// 统一加载 footer 模板
(async function loadFooter(){
  try{
    const slot = document.getElementById('footer-slot');
    if (!slot) return;
    const res = await fetch('/templates/footer.html', { cache: 'no-cache' });
    const html = await res.text();
    slot.outerHTML = html;
    setTimeout(()=>{ const y=document.getElementById('footer-year'); if (y) y.textContent = new Date().getFullYear(); },0);
  }catch(_){ }
})();

window.togglePin = async (ev, address) => {
  ev.stopPropagation();
  
  try {
    const response = await api(`/api/mailboxes/pin?address=${encodeURIComponent(address)}`, { 
      method: 'POST' 
    });
    
    if (response.ok) {
      const result = await response.json();
      showToast(result.is_pinned ? '📌 邮箱已置顶' : '📍 已取消置顶', 'success');
      
      // 重新加载邮箱列表以更新排序
      await loadMailboxes();
    } else {
      const errorText = await response.text();
      showToast(`操作失败: ${errorText}`, 'warn');
    }
  } catch (error) {
    showToast('操作失败，请重试', 'warn');
  }
}

window.deleteMailbox = async (ev, address) => {
  ev.stopPropagation();
  
  const confirmed = await showConfirm(
    `确定删除邮箱 ${address} 及其所有邮件吗？此操作不可撤销！`
  );
  
  if (!confirmed) return;
  
  try{
    const response = await api(`/api/mailboxes?address=${encodeURIComponent(address)}`, { method:'DELETE' });
    
    if (response.ok) {
      let result = {};
      try { result = await response.json(); } catch(_) { result = {}; }
      if (result && (result.success || result.deleted)){
        showToast('邮箱已成功删除', 'success');
        
        // 立即从DOM中移除该邮箱项
        const mailboxItems = els.mbList.querySelectorAll('.mailbox-item');
        mailboxItems.forEach(item => {
          const addressSpan = item.querySelector('.address');
          if (addressSpan && addressSpan.textContent === address) {
            item.remove();
          }
        });
        
        // 如果删除的是当前选中的邮箱，清空相关状态
        if (window.currentMailbox === address){
          els.list.innerHTML = '<div style="text-align:center;color:#64748b">📭 暂无邮件</div>';
          els.email.innerHTML = '<span class="placeholder-text">点击右侧生成按钮创建邮箱地址</span>';
          els.email.classList.remove('has-email');
          els.emailActions.style.display = 'none';
          els.listCard.style.display = 'none';
          window.currentMailbox = '';
          // 停止自动刷新
          stopAutoRefresh();
        }
        
        // 强制刷新历史邮箱列表，避免假阳性
        if (typeof mbOffset !== 'undefined') { mbOffset = 0; }
        await loadMailboxes(false);
      } else {
        showToast(result?.message ? `删除失败: ${result.message}` : '删除失败', 'warn');
      }
    } else {
      if (response.status === 403) {
        showToast('没权限删除', 'warn');
      } else if (response.status === 404) {
        showToast('邮箱不存在或已被删除', 'warn');
      } else {
        const errorText = await response.text();
        showToast(`删除失败: ${errorText}`, 'warn');
      }
    }
  } catch(e) { 
    showToast('删除邮箱时发生网络错误', 'warn'); 
    console.error('Delete mailbox error:', e);
  }
}

if (els.mbMore) {
  els.mbMore.onclick = async () => {
    // 点击后立即进入加载状态，防止重复点击
    if (els.mbMore){
      els.mbMore.disabled = true;
      if (els.mbMoreText) els.mbMoreText.textContent = '正在加载…';
    }
    mbOffset += MB_PAGE_SIZE;
    await loadMailboxes(true);
  };
}

mbOffset = 0;

// 自动刷新功能
let autoRefreshInterval = null;

function startAutoRefresh() {
  // 如果已有定时器，先清除
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
  }
  
  // 每8秒检查新邮件
  autoRefreshInterval = setInterval(() => {
    // 只有当选中了邮箱时才自动刷新
    if (window.currentMailbox) {
      refresh();
    }
  }, 8000); // 8秒 = 8000毫秒
}

function stopAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
}

// 页面可见性变化时的处理
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // 页面隐藏时停止自动刷新（节省资源）
    stopAutoRefresh();
  } else {
    // 页面显示时恢复自动刷新
    if (window.currentMailbox) {
      startAutoRefresh();
    }
  }
});

// 启动自动刷新
setTimeout(startAutoRefresh, 0);

// 切换收件箱/发件箱
function switchToInbox(){
  isSentView = false;
  if (els.tabInbox) els.tabInbox.setAttribute('aria-pressed', 'true');
  if (els.tabSent) els.tabSent.setAttribute('aria-pressed', 'false');
  if (els.boxTitle) els.boxTitle.textContent = '收件箱';
  if (els.boxIcon) els.boxIcon.textContent = '📬';
  // 首次切换时显示大加载，其余仅右上角更新
  const key = getViewKey();
  if (!viewLoaded.has(key)) { if (els.list) els.list.innerHTML = ''; }
  refresh();
}
function switchToSent(){
  isSentView = true;
  if (els.tabInbox) els.tabInbox.setAttribute('aria-pressed', 'false');
  if (els.tabSent) els.tabSent.setAttribute('aria-pressed', 'true');
  if (els.boxTitle) els.boxTitle.textContent = '发件箱';
  if (els.boxIcon) els.boxIcon.textContent = '📤';
  const key = getViewKey();
  if (!viewLoaded.has(key)) { if (els.list) els.list.innerHTML = ''; }
  refresh();
}
if (els.tabInbox) els.tabInbox.onclick = switchToInbox;
if (els.tabSent) els.tabSent.onclick = switchToSent;

// 发件详情展示
window.showSentEmail = async (id) => {
  try {
    const r = await api(`/api/sent/${id}`);
    const email = await r.json();
    els.modalSubject.innerHTML = `
      <span class="modal-icon">📤</span>
      <span>${email.subject || '(无主题)'}</span>
    `;
    const bodyHtml = (email.html_content || email.text_content || '').toString();
    els.modalContent.innerHTML = `
      <div class="email-detail-container">
        <div class="email-meta-card">
          <div class="meta-item">
            <span class="meta-icon">📤</span>
            <span class="meta-label">收件人</span>
            <span class="meta-value">${email.recipients}</span>
          </div>
          <div class="meta-item">
            <span class="meta-icon">👤</span>
            <span class="meta-label">发件人</span>
            <span class="meta-value">${(email.from_name ? email.from_name + ' ' : '')}&lt;${window.currentMailbox}&gt;</span>
          </div>
          <div class="meta-item">
            <span class="meta-icon">🕐</span>
            <span class="meta-label">时间</span>
            <span class="meta-value">${formatTs(email.created_at)}</span>
          </div>
          <div class="meta-item">
            <span class="meta-icon">📌</span>
            <span class="meta-label">状态</span>
            <span class="meta-value">${email.status || 'unknown'}</span>
          </div>
        </div>
        <div class="email-content-area">
          ${bodyHtml ? `<div class="email-content-text">${bodyHtml}</div>` : '<div class="email-no-content">暂无内容</div>'}
        </div>
      </div>
    `;
    els.modal.classList.add('show');
  } catch (e) { }
}

// 计算状态样式
function statusClass(status){
  const s = String(status||'').toLowerCase();
  if (s.includes('deliver')) return 'status-delivered';
  if (s.includes('processing') || s.includes('send')) return 'status-processing';
  if (s.includes('fail') || s.includes('bounce') || s.includes('error')) return 'status-failed';
  return 'status-queued';
}

// 删除发件记录
window.deleteSent = async (id) => {
  try{
    const confirmed = await showConfirm('确定删除该发件记录吗？');
    if (!confirmed) return;
    const r = await api(`/api/sent/${id}`, { method: 'DELETE' });
    if (!r.ok){ const t = await r.text(); showToast('删除失败: ' + t, 'warn'); return; }
    showToast('已删除发件记录', 'success');
    refresh();
  }catch(e){ showToast('删除失败', 'warn'); }
}

// 发送后轮询状态：在 sendCompose 成功后触发
async function pollSentStatus(resendId, maxTries = 10){
  try{
    for (let i=0;i<maxTries;i++){
      await new Promise(r=>setTimeout(r, 2000));
      // 通过 /api/send/:id 查询最新状态
      const r = await api(`/api/send/${resendId}`);
      if (!r.ok) continue;
      const data = await r.json();
      const st = (data?.status || '').toLowerCase();
      if (st.includes('deliver') || st.includes('fail') || st.includes('bounce') || st.includes('error')){
        refresh();
        break;
      }
      // 中间态继续轮询
    }
  }catch(_){ }
}

