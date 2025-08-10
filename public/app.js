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
    window.__MOCK_STATE__.mailboxes.unshift({ address: email, created_at: new Date().toISOString().replace('T',' ').slice(0,19) });
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
    return new Response(JSON.stringify(mb.slice(0,10)), { headers: jsonHeaders });
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
    location.replace('/login.html');
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
const __templateHtml = await (await fetch('/templates/app.html', { cache: 'no-cache' })).text();
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
  toast: document.getElementById('toast'),
  mbMore: document.getElementById('mb-more'),
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
function showToast(message, type='info'){
  const div = document.createElement('div');
  div.className = `toast-item ${type}`;
  div.textContent = message;
  els.toast.appendChild(div);
  setTimeout(()=>{
    div.style.transition = 'opacity .3s ease';
    div.style.opacity = '0';
    setTimeout(()=>div.remove(), 300);
  }, 2000);
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
    }catch(e){ showToast('创建失败：' + (e?.message || e), 'warn'); }
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

// 拉取域名列表（后端在 index.js 解析自环境变量，前端通过一个轻量接口暴露）
async function loadDomains(){
  if (window.__GUEST_MODE__) {
    // 不发任何请求，直接使用 example.com 并且清空历史，避免旧域名显示
    populateDomains(['example.com']);
    try{ els.mbList && (els.mbList.innerHTML = ''); window.__MOCK_STATE__.mailboxes = []; }catch(_){ }
    return;
  }
  try{
    const r = await api('/api/domains');
    const domains = await r.json();
    if (Array.isArray(domains) && domains.length){
      populateDomains(domains);
      return;
    }
  }catch(_){ }
  const meta = (document.querySelector('meta[name="mail-domains"]')?.getAttribute('content') || '').split(',').map(s=>s.trim()).filter(Boolean);
  const fallback = [];
  if (window.currentMailbox && window.currentMailbox.includes('@')) fallback.push(window.currentMailbox.split('@')[1]);
  if (!meta.length && location.hostname) fallback.push(location.hostname);
  const list = [...new Set(meta.length ? meta : fallback)].filter(Boolean);
  populateDomains(list);
}
// 延迟到会话判定后再加载域名，避免访客模式提前请求真实接口

// 会话校验与访客模式处理（在模板装载并拿到 DOM 引用之后执行）
(async () => {
  try {
    const r = await fetch('/api/session');
    if (!r.ok) { location.replace('/login.html'); return; }
    const s = await r.json();
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
        els.email.innerHTML = '<span class="placeholder-text">点击右侧生成按钮创建邮箱地址</span>';
      }
    }
    // 现在再加载域名与历史邮箱（避免在演示模式下发起真实请求）
    if (typeof loadDomains === 'function') await loadDomains();
    if (typeof loadMailboxes === 'function') await loadMailboxes(false);
  } catch (_) {
    location.replace('/login.html');
  }
})();

els.gen.onclick = async () => {
  try {
    const len = Number((lenRange && lenRange.value) || localStorage.getItem(STORAGE_KEYS.length) || 8);
    const domainIndex = Number(domainSelect?.value || 0);
    const r = await api(`/api/generate?length=${Math.max(8, Math.min(30, isNaN(len) ? 8 : len))}&domainIndex=${isNaN(domainIndex)?0:domainIndex}`);
    const data = await r.json();
    // 持久化选择
    try{
      localStorage.setItem(STORAGE_KEYS.length, String(Math.max(8, Math.min(30, isNaN(len) ? 8 : len))));
      const opt = domainSelect?.options?.[domainIndex];
      if (opt) localStorage.setItem(STORAGE_KEYS.domain, opt.textContent || '');
    }catch(_){ }
    window.currentMailbox = data.email;
    els.email.textContent = data.email;
    els.email.classList.add('has-email');
    els.emailActions.style.display = 'flex';
    els.listCard.style.display = 'block';
    // 重启自动刷新
    startAutoRefresh();
    
    showToast('邮箱生成成功！', 'success');
    await refresh();
    // 重置历史分页偏移，确保显示最新的第一页
    if (typeof mbOffset !== 'undefined') { mbOffset = 0; }
    await loadMailboxes(false);
  } catch (e){ /* redirected */ }
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

async function refresh(){
  if (!window.currentMailbox) return;
  try {
    if (els.listLoading) els.listLoading.classList.add('show');
    let emails = [];
    if (!isSentView){
      const r = await api(`/api/emails?mailbox=${encodeURIComponent(window.currentMailbox)}`);
      emails = await r.json();
    } else {
      const r = await api(`/api/sent?from=${encodeURIComponent(window.currentMailbox)}`);
      emails = await r.json();
    }
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
  } catch (e){ /* redirected */ }
  finally { if (els.listLoading) els.listLoading.classList.remove('show'); }
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
      const errorText = await response.text();
      showToast(`删除失败: ${errorText}`, 'warn');
    }
  } catch (e) {
    showToast('删除邮件时发生网络错误', 'warn');
  }
}

els.refresh.onclick = refresh;
els.logout.onclick = async () => {
  try { await fetch('/api/logout', { method:'POST' }); } catch {}
  location.replace('/login.html');
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
    const r = await api(`/api/mailboxes?limit=${MB_PAGE_SIZE}&offset=${mbOffset}`);
    const items = await r.json();
    const html = (items||[]).map(x => (
      `<div class="mailbox-item" onclick="selectMailbox('${x.address}')">
        <span class="address">${x.address}</span>
        <span class="time">${formatTs(x.created_at)}</span>
        <button class="btn btn-ghost btn-sm del" onclick="deleteMailbox(event,'${x.address}')">删除</button>
      </div>`
    )).join('');
    if (isAppend) {
      els.mbList.insertAdjacentHTML('beforeend', html);
    } else {
      els.mbList.innerHTML = html || '<div style="color:#94a3b8">暂无历史邮箱</div>';
    }
    if (els.mbMore) els.mbMore.style.display = (items && items.length === MB_PAGE_SIZE) ? 'inline-flex' : 'none';
    // 预取当前邮箱列表前 5 封
    await prefetchTopEmails();
  }catch(_){ els.mbList.innerHTML = '<div style="color:#dc2626">加载失败</div>'; }
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

window.deleteMailbox = async (ev, address) => {
  ev.stopPropagation();
  
  const confirmed = await showConfirm(
    `确定删除邮箱 ${address} 及其所有邮件吗？此操作不可撤销！`
  );
  
  if (!confirmed) return;
  
  try{
    const response = await api(`/api/mailboxes?address=${encodeURIComponent(address)}`, { 
      method:'DELETE' 
    });
    
    if (response.ok) {
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
      
      // 检查是否还有邮箱项，如果没有显示提示
      const remainingItems = els.mbList.querySelectorAll('.mailbox-item');
      if (remainingItems.length === 0) {
        els.mbList.innerHTML = '<div style="color:#94a3b8">暂无历史邮箱</div>';
      }
    } else {
      const errorText = await response.text();
      showToast(`删除失败: ${errorText}`, 'warn');
    }
  } catch(e) { 
    showToast('删除邮箱时发生网络错误', 'warn'); 
    console.error('Delete mailbox error:', e);
  }
}

if (els.mbMore) {
  els.mbMore.onclick = async () => {
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
startAutoRefresh();

// 切换收件箱/发件箱
function switchToInbox(){
  isSentView = false;
  if (els.tabInbox) els.tabInbox.setAttribute('aria-pressed', 'true');
  if (els.tabSent) els.tabSent.setAttribute('aria-pressed', 'false');
  if (els.boxTitle) els.boxTitle.textContent = '收件箱';
  if (els.boxIcon) els.boxIcon.textContent = '📬';
  refresh();
}
function switchToSent(){
  isSentView = true;
  if (els.tabInbox) els.tabInbox.setAttribute('aria-pressed', 'false');
  if (els.tabSent) els.tabSent.setAttribute('aria-pressed', 'true');
  if (els.boxTitle) els.boxTitle.textContent = '发件箱';
  if (els.boxIcon) els.boxIcon.textContent = '📤';
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

