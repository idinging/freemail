import { cacheGet, cacheSet, readPrefetch, setCurrentUserKey, cacheClearForUser, getCurrentUserKey } from './storage.js';

window.__GUEST_MODE__ = false;
window.__MOCK_STATE__ = { domains: ['example.com'], mailboxes: [], emailsByMailbox: new Map() };

// 若刚从登录页跳转过来，设置的标记用于避免服务端缓存未热导致的循环
try{ if (sessionStorage.getItem('mf:just_logged_in') === '1'){ sessionStorage.removeItem('mf:just_logged_in'); } }catch(_){ }

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
      
      // 检查邮箱是否已存在
      const existingMailbox = window.__MOCK_STATE__.mailboxes.find(m => m.address === email);
      if (existingMailbox) {
        return new Response('邮箱地址已存在，请选择其他用户名', { status: 409 });
      }
      
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
    if (location.pathname !== '/html/login.html') {
      location.replace('/html/login.html');
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

// 移动端专用：将时间格式化为两行显示（年月日 + 时分秒）
function formatTsMobile(ts){
  if (!ts) return '<span></span><span></span>';
  try {
    // 统一转成 ISO 再追加 Z 标记为 UTC
    const iso = ts.includes('T') ? ts.replace(' ', 'T') : ts.replace(' ', 'T');
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

// 优化的随机人名生成函数
function generateRandomId(length = 8) {
  // 扩展的音节库 - 分类管理，生成更自然的人名
  const vowelSyllables = ["a", "e", "i", "o", "u", "ai", "ei", "ou", "ia", "io"];
  const consonantSyllables = ["b", "c", "d", "f", "g", "h", "j", "k", "l", "m", "n", "p", "r", "s", "t", "v", "w", "x", "y", "z"];
  const commonSyllables = [
    "al", "an", "ar", "er", "in", "on", "en", "el", "or", "ir",
    "la", "le", "li", "lo", "lu", "ra", "re", "ri", "ro", "ru",
    "na", "ne", "ni", "no", "nu", "ma", "me", "mi", "mo", "mu",
    "ta", "te", "ti", "to", "tu", "sa", "se", "si", "so", "su",
    "ca", "ce", "ci", "co", "cu", "da", "de", "di", "do", "du",
    "fa", "fe", "fi", "fo", "fu", "ga", "ge", "gi", "go", "gu",
    "ba", "be", "bi", "bo", "bu", "va", "ve", "vi", "vo", "vu"
  ];
  const nameFragments = [
    "alex", "max", "sam", "ben", "tom", "joe", "leo", "kai", "ray", "jay",
    "anna", "emma", "lily", "lucy", "ruby", "zoe", "eva", "mia", "ava", "ivy",
    "chen", "wang", "yang", "zhao", "liu", "lin", "zhou", "wu", "xu", "sun"
  ];

  // 智能音节组合函数
  const makeNaturalWord = (targetLen) => {
    let word = "";
    let lastWasVowel = false;
    let attempts = 0;
    const maxAttempts = 50; // 防止无限循环

    while (word.length < targetLen && attempts < maxAttempts) {
      attempts++;
      let syllable;
      
      if (word.length === 0) {
        // 首字母倾向于使用常见音节或名字片段
        if (Math.random() < 0.3 && targetLen >= 4) {
          const fragment = nameFragments[Math.floor(Math.random() * nameFragments.length)];
          if (fragment.length <= targetLen) {
            syllable = fragment;
          } else {
            syllable = commonSyllables[Math.floor(Math.random() * commonSyllables.length)];
          }
        } else {
          syllable = commonSyllables[Math.floor(Math.random() * commonSyllables.length)];
        }
      } else {
        // 后续音节根据前一个音节的类型来选择
        const rand = Math.random();
        if (rand < 0.6) {
          syllable = commonSyllables[Math.floor(Math.random() * commonSyllables.length)];
        } else if (rand < 0.8) {
          syllable = lastWasVowel ? 
            consonantSyllables[Math.floor(Math.random() * consonantSyllables.length)] :
            vowelSyllables[Math.floor(Math.random() * vowelSyllables.length)];
        } else {
          syllable = commonSyllables[Math.floor(Math.random() * commonSyllables.length)];
        }
      }

      // 检查添加音节后是否会超长
      if (word.length + syllable.length <= targetLen) {
        word += syllable;
        lastWasVowel = /[aeiou]$/.test(syllable);
      } else {
        // 如果会超长，尝试找个更短的音节
        const shortSyllables = [vowelSyllables, consonantSyllables].flat().filter(s => s.length === 1);
        const remainingLen = targetLen - word.length;
        const fitSyllables = shortSyllables.filter(s => s.length <= remainingLen);
        
        if (fitSyllables.length > 0) {
          syllable = fitSyllables[Math.floor(Math.random() * fitSyllables.length)];
          word += syllable;
        }
        break;
      }
    }

    return word.length > targetLen ? word.slice(0, targetLen) : word;
  };

  const len = Math.max(4, Math.min(32, Number(length) || 8));

  if (len <= 12) {
    return makeNaturalWord(len).toLowerCase();
  } else {
    // 长名字用下划线分割，模拟 firstname_lastname 格式
    const firstLen = Math.max(3, Math.floor((len - 1) * 0.4)); // 40% 给名字
    const lastLen = Math.max(3, len - 1 - firstLen); // 剩余给姓氏

    const firstName = makeNaturalWord(firstLen);
    const lastName = makeNaturalWord(lastLen);

    return (firstName + "_" + lastName).toLowerCase();
  }
}

// 用户隔离的邮箱状态管理
function saveCurrentMailbox(mailbox) {
  try {
    const userKey = getCurrentUserKey();
    if (userKey && userKey !== 'unknown') {
      sessionStorage.setItem(`mf:currentMailbox:${userKey}`, mailbox);
    }
  } catch(_) {}
}

function loadCurrentMailbox() {
  try {
    const userKey = getCurrentUserKey();
    if (userKey && userKey !== 'unknown') {
      return sessionStorage.getItem(`mf:currentMailbox:${userKey}`);
    }
  } catch(_) {}
  return null;
}

function clearCurrentMailbox() {
  try {
    const userKey = getCurrentUserKey();
    if (userKey && userKey !== 'unknown') {
      sessionStorage.removeItem(`mf:currentMailbox:${userKey}`);
    }
    // 兼容性：也清理旧的非隔离键
    sessionStorage.removeItem('mf:currentMailbox');
  } catch(_) {}
}

// 初始化流程将会在模板加载后进行（见 init()）

const app = document.getElementById('app');
// 优先使用预加载缓存，加速首屏模板加载
const templateResp = await fetch('/html/app.html', { cache: 'force-cache' }).catch(()=>null);
const __templateHtml = templateResp && templateResp.ok ? await templateResp.text() : await (await fetch('/html/app.html', { cache: 'no-cache' })).text();
app.innerHTML = __templateHtml;

const els = {
  email: document.getElementById('email'),
  gen: document.getElementById('gen'),
  genName: document.getElementById('gen-name'),
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
  mbSearch: document.getElementById('mb-search'),
  mbLoading: document.getElementById('mb-loading'),
  toast: document.getElementById('toast'),
  mbPager: document.getElementById('mb-pager'),
  mbPrev: document.getElementById('mb-prev'),
  mbNext: document.getElementById('mb-next'),
  mbPageInfo: document.getElementById('mb-page-info'),
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
  composeSend: document.getElementById('compose-send'),
  // pager
  pager: document.getElementById('list-pager'),
  prevPage: document.getElementById('prev-page'),
  nextPage: document.getElementById('next-page'),
  pageInfo: document.getElementById('page-info'),
  // sidebar toggle
  sidebarToggle: document.getElementById('sidebar-toggle'),
  sidebarToggleIcon: document.getElementById('sidebar-toggle-icon'),
  sidebar: document.querySelector('.sidebar'),
  container: document.querySelector('.container')
};
// 管理入口（默认隐藏，登录后按角色显示）
const adminLink = document.getElementById('admin');
const allMailboxesLink = document.getElementById('all-mailboxes');

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
    if (allMailboxesLink){
      if (s && (s.strictAdmin || s.role === 'guest')) allMailboxesLink.style.display = 'inline-flex';
      else allMailboxesLink.style.display = 'none';
    }
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


// 统一提示：改为使用 toast 模板
function showInlineTip(_anchorEl, message, type = 'info'){
  try{ showToast(message, type); }catch(_){ }
}

// 暴露到全局，便于移动端脚本直接调用
try{ window.showToast = showToast; }catch(_){ }

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

// 当前确认对话框的控制器，避免快速连续操作时的冲突
let currentConfirmController = null;

// 自定义确认对话框
function showConfirm(message, onConfirm, onCancel = null) {
  return new Promise((resolve) => {
    try {
      // 如果有之前的控制器，先取消
      if (currentConfirmController) {
        currentConfirmController.abort();
      }
      
      // 创建新的 AbortController
      currentConfirmController = new AbortController();
      const signal = currentConfirmController.signal;
      
      // 将回调保存到模态框的属性中，避免闭包变量污染
      els.confirmModal._currentResolve = resolve;
      els.confirmModal._currentOnConfirm = onConfirm;
      els.confirmModal._currentOnCancel = onCancel;
      
      els.confirmMessage.textContent = message;
      els.confirmModal.classList.add('show');
      
      const handleConfirm = () => {
        els.confirmModal.classList.remove('show');
        currentConfirmController = null;
        
        // 从模态框属性中获取回调，避免闭包变量问题
        const currentResolve = els.confirmModal._currentResolve;
        const currentOnConfirm = els.confirmModal._currentOnConfirm;
        
        // 清理属性
        delete els.confirmModal._currentResolve;
        delete els.confirmModal._currentOnConfirm;
        delete els.confirmModal._currentOnCancel;
        
        if (currentResolve) currentResolve(true);
        if (currentOnConfirm) currentOnConfirm();
      };
      
      const handleCancel = () => {
        els.confirmModal.classList.remove('show');
        currentConfirmController = null;
        
        // 从模态框属性中获取回调，避免闭包变量问题
        const currentResolve = els.confirmModal._currentResolve;
        const currentOnCancel = els.confirmModal._currentOnCancel;
        
        // 清理属性
        delete els.confirmModal._currentResolve;
        delete els.confirmModal._currentOnConfirm;
        delete els.confirmModal._currentOnCancel;
        
        if (currentResolve) currentResolve(false);
        if (currentOnCancel) currentOnCancel();
      };
      
      // 使用 AbortController 管理事件监听器，避免重复绑定和闭包污染
      els.confirmOk.addEventListener('click', handleConfirm, { signal });
      els.confirmCancel.addEventListener('click', handleCancel, { signal });
      els.confirmClose.addEventListener('click', handleCancel, { signal });
      
    } catch(err) {
      console.error('确认对话框初始化失败:', err);
      // 降级到原生confirm
      const result = confirm(message || '确认执行该操作？');
      resolve(result);
      if (result && onConfirm) onConfirm();
      if (!result && onCancel) onCancel();
    }
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
      if (!r.ok){ 
        const t = await r.text(); 
        if (r.status === 409) {
          // 邮箱已存在的情况
          throw new Error(t || '');
        } else if (r.status === 429) {
          // 邮箱上限的情况
          throw new Error(t || '已达到邮箱创建上限');
        }
        throw new Error(t); 
      }
      const data = await r.json();
      window.currentMailbox = data.email;
      // 持久化保存当前邮箱，用于页面刷新恢复（用户隔离）
      saveCurrentMailbox(data.email);
      // 如果已显示在邮箱框中，更新文本节点
      const t = document.getElementById('email-text');
      if (t) t.textContent = data.email; else els.email.textContent = data.email;
      els.email.classList.add('has-email');
      els.emailActions.style.display = 'flex';
      els.listCard.style.display = 'block';
      showToast('已创建邮箱：' + data.email, 'success');
      els.customOverlay.style.display = 'none';
      // 乐观插入到左侧列表（排在置顶邮箱之后）
      try{
        const createdAt = new Date().toISOString().replace('T',' ').slice(0,19);
        const html = `
          <div class="mailbox-item" onclick="selectMailbox('${data.email}')">
            <div class="mailbox-content">
              <span class="address">${data.email}</span>
              <span class="time">${formatTs(createdAt)}</span>
            </div>
            <div class="mailbox-actions">
              <button class="btn btn-ghost btn-sm pin" onclick="togglePin(event,'${data.email}')" title="置顶">📍</button>
              <button class="btn btn-ghost btn-sm del" onclick="deleteMailbox(event,'${data.email}')" title="删除">🗑️</button>
            </div>
          </div>`;
        if (els.mbList){
          const pinned = els.mbList.querySelectorAll('.mailbox-item.pinned');
          if (pinned && pinned.length){ pinned[pinned.length - 1].insertAdjacentHTML('afterend', html); }
          else { els.mbList.insertAdjacentHTML('afterbegin', html); }
        }
      }catch(_){ }
      // 刷新第一页，强制绕过缓存
      if (typeof mbPage !== 'undefined') { mbPage = 1; }
      await loadMailboxes({ forceFresh: true });
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
    try{ 
      const quotaEl = document.getElementById('quota'); 
      if (quotaEl) {
        quotaEl.textContent = '0 邮箱';
        quotaEl.title = '演示模式 - 系统邮箱数量';
        quotaEl.classList.add('admin-quota');
      }
    }catch(_){ }
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

// 会话校验与访客模式处理（在模板装载并拿到 DOM 引用之后执行）
(async () => {
  try {
    const r = await fetch('/api/session');
    if (!r.ok) { 
      // 认证失败时清理可能的残留数据，防止泄露
      try {
        clearCurrentMailbox();
        window.currentMailbox = '';
        stopAutoRefresh();
      } catch(_) {}
      // 如果认证失败，跳转到登录页
      location.replace('/html/login.html'); 
      return; 
    }
    const s = await r.json();
    try{
      // 持久化会话到本地，用于下次快速渲染
      cacheSet('session', s);
      setCurrentUserKey(`${s.role || ''}:${s.username || ''}`);
    }catch(_){ }
    // 应用会话UI（包括角色徽章和手机端身份显示）
    applySessionUI(s);
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
      (typeof loadMailboxes === 'function') ? loadMailboxes() : Promise.resolve()
    ]);
    
    // 会话验证成功后，安全地恢复用户的邮箱状态
    restoreUserMailboxState();
  } catch (error) {
    console.error('认证检查失败:', error);
    // 认证失败时清理可能的残留数据，防止泄露
    try {
      clearCurrentMailbox();
      window.currentMailbox = '';
      stopAutoRefresh();
    } catch(_) {}
    // 如果认证检查失败，跳转到登录页
    location.replace('/html/login.html');
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
    // 乐观插入到左侧列表（排在置顶邮箱之后）
    try{
      const createdAt = new Date().toISOString().replace('T',' ').slice(0,19);
      const html = `
        <div class="mailbox-item" onclick="selectMailbox('${data.email}')">
          <div class="mailbox-content">
            <span class="address">${data.email}</span>
            <span class="time">${formatTs(createdAt)}</span>
          </div>
          <div class="mailbox-actions">
            <button class="btn btn-ghost btn-sm pin" onclick="togglePin(event,'${data.email}')" title="置顶">📍</button>
            <button class="btn btn-ghost btn-sm del" onclick="deleteMailbox(event,'${data.email}')" title="删除">🗑️</button>
          </div>
        </div>`;
      if (els.mbList){
        const pinned = els.mbList.querySelectorAll('.mailbox-item.pinned');
        if (pinned && pinned.length){ pinned[pinned.length - 1].insertAdjacentHTML('afterend', html); }
        else { els.mbList.insertAdjacentHTML('afterbegin', html); }
      }
    }catch(_){ }
    // 强制刷新第一页，确保与服务端一致
    if (typeof mbPage !== 'undefined') { mbPage = 1; }
    await loadMailboxes({ forceFresh: true });
  } catch (e){ showToast(String(e?.message || '已达到邮箱上限或创建失败'), 'warn'); }
  finally { restoreButton(els.gen); }
}

// 随机人名生成按钮事件
if (els.genName) {
  els.genName.onclick = async () => {
    try {
      setButtonLoading(els.genName, '正在生成…');
      const len = Number((lenRange && lenRange.value) || localStorage.getItem(STORAGE_KEYS.length) || 8);
      const domainIndex = Number(domainSelect?.value || 0);
      
      // 使用随机人名生成用户名
      const localName = generateRandomId(Math.max(8, Math.min(30, isNaN(len) ? 8 : len)));
      
      const r = await api('/api/create', { 
        method: 'POST', 
        headers: {'Content-Type': 'application/json'}, 
        body: JSON.stringify({ 
          local: localName, 
          domainIndex: isNaN(domainIndex) ? 0 : domainIndex 
        }) 
      });
      
      if (!r.ok) { 
        const t = await r.text(); 
        if (r.status === 409) {
          // 邮箱已存在的情况
          throw new Error(t || '邮箱地址已存在');
        } else if (r.status === 429) {
          // 邮箱上限的情况
          throw new Error(t || '已达到邮箱创建上限');
        }
        throw new Error(t); 
      }
      const data = await r.json();
      
      // 持久化选择
      try {
        localStorage.setItem(STORAGE_KEYS.length, String(Math.max(8, Math.min(30, isNaN(len) ? 8 : len))));
        const opt = domainSelect?.options?.[domainIndex];
        if (opt) localStorage.setItem(STORAGE_KEYS.domain, opt.textContent || '');
      } catch(_) {}
      
      window.currentMailbox = data.email;
      // 持久化保存当前邮箱（用户隔离）
      saveCurrentMailbox(data.email);
      
      const t = document.getElementById('email-text');
      if (t) t.textContent = data.email; else els.email.textContent = data.email;
      els.email.classList.add('has-email');
      els.emailActions.style.display = 'flex';
      els.listCard.style.display = 'block';
      
      // 重启自动刷新
      startAutoRefresh();
      
      showToast('随机人名邮箱生成成功！', 'success');
      // 成功后尽早复位按钮
      try { restoreButton(els.genName); } catch(_) {}
      await refresh();
      
      // 乐观插入到左侧列表
      try {
        const createdAt = new Date().toISOString().replace('T',' ').slice(0,19);
        const html = `
          <div class="mailbox-item" onclick="selectMailbox('${data.email}')">
            <div class="mailbox-content">
              <span class="address">${data.email}</span>
              <span class="time">${formatTs(createdAt)}</span>
            </div>
            <div class="mailbox-actions">
              <button class="btn btn-ghost btn-sm pin" onclick="togglePin(event,'${data.email}')" title="置顶">📍</button>
              <button class="btn btn-ghost btn-sm del" onclick="deleteMailbox(event,'${data.email}')" title="删除">🗑️</button>
            </div>
          </div>`;
        if (els.mbList) {
          const pinned = els.mbList.querySelectorAll('.mailbox-item.pinned');
          if (pinned && pinned.length) { pinned[pinned.length - 1].insertAdjacentHTML('afterend', html); }
          else { els.mbList.insertAdjacentHTML('afterbegin', html); }
        }
      } catch(_) {}
      
      // 强制刷新第一页
      if (typeof mbPage !== 'undefined') { mbPage = 1; }
      await loadMailboxes({ forceFresh: true });
    } catch (e) { showToast(String(e?.message || '已达到邮箱上限或创建失败'), 'warn'); }
    finally { restoreButton(els.genName); }
  };
}

els.copy.onclick = async () => {
  if (!window.currentMailbox){
    try{ showToast('请先生成或选择一个邮箱', 'warn'); }catch(_){ }
    return;
  }
  try { 
    await navigator.clipboard.writeText(window.currentMailbox); 
    showToast(`已复制邮箱地址：${window.currentMailbox}`, 'success');
  } catch {
    showToast('复制失败，请重试', 'error');
  }
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

// 分页状态（每页 8 条）
const PAGE_SIZE = 8;
let currentPage = 1;
let lastLoadedEmails = [];

function renderPager(){
  try{
    const total = Array.isArray(lastLoadedEmails) ? lastLoadedEmails.length : 0;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (!els.pager) return;
    els.pager.style.display = total > PAGE_SIZE ? 'flex' : 'none';
    if (els.pageInfo) els.pageInfo.textContent = `${currentPage} / ${totalPages}`;
    if (els.prevPage) els.prevPage.disabled = currentPage <= 1;
    if (els.nextPage) els.nextPage.disabled = currentPage >= totalPages;
  }catch(_){ }
}

function sliceByPage(items){
  lastLoadedEmails = Array.isArray(items) ? items : [];
  const total = lastLoadedEmails.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  const start = (currentPage - 1) * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  renderPager();
  return lastLoadedEmails.slice(start, end);
}

if (els.prevPage){
  els.prevPage.onclick = () => {
    if (currentPage > 1){ currentPage -= 1; refresh(); }
  };
}
if (els.nextPage){
  els.nextPage.onclick = () => {
    const total = lastLoadedEmails.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (currentPage < totalPages){ currentPage += 1; refresh(); }
  };
}
// 当切换邮箱或视图时回到第 1 页
function resetPager(){ currentPage = 1; lastLoadedEmails = []; renderPager(); }

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
      if (els.pager) els.pager.style.display = 'none';
      return; 
    }
    // 分页切片
    const pageItems = sliceByPage(emails);
    els.list.innerHTML = pageItems.map(e => {
      // 智能内容预览处理（优先使用后端 preview ）
      let rawContent = isSentView ? (e.text_content || e.html_content || '') : (e.preview || e.content || e.html_content || '');
      let preview = '';
      
      if (rawContent) {
        // 移除HTML标签并清理空白字符
        preview = rawContent
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        
        // 检测验证码（若后端未提供 verification_code 再做兜底）
        const codeMatch = (e.verification_code || '').toString().trim() || extractCode(rawContent);
        if (codeMatch) {
          preview = `验证码: ${codeMatch} | ${preview}`;
        }
        // 统一限制预览为 20 个字符
        preview = preview.slice(0, 20);
      }
      
      const hasContent = preview.length > 0;
      // 绑定验证码优先使用后端列，退回提取
      const listCode = (e.verification_code || '').toString().trim() || extractCode(rawContent || '');
      const escapeHtml = (s)=>String(s||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]||c));
      const senderText = escapeHtml(e.sender || '');
      // 发件箱：显示收件人（最多2个，多余以“等N人”提示）
      let recipientsDisplay = '';
      if (isSentView){
        const raw = (e.recipients || e.to_addrs || '').toString();
        const arr = raw.split(',').map(s=>s.trim()).filter(Boolean);
        if (arr.length){
          recipientsDisplay = arr.slice(0,2).join(', ');
          if (arr.length > 2) recipientsDisplay += ` 等${arr.length}人`;
        } else {
          recipientsDisplay = raw;
        }
      }
      const subjectText = escapeHtml(e.subject || '(无主题)');
      const previewText = escapeHtml(preview);
      const metaLabel = isSentView ? '收件人' : '发件人';
      const metaText = isSentView ? escapeHtml(recipientsDisplay) : senderText;
      
      return `
       <div class="email-item clickable" onclick="${isSentView ? `showSentEmail(${e.id})` : `showEmail(${e.id})`}">
         <div class="email-meta">
           <span class="meta-from"><span class="meta-label">${metaLabel}</span><span class="meta-from-text">${metaText}</span></span>
           <span class="email-time">
             <span class="time-icon">🕐</span>
             ${window.matchMedia && window.matchMedia('(max-width: 900px)').matches ? formatTsMobile(e.received_at || e.created_at) : formatTs(e.received_at || e.created_at)}
           </span>
         </div>
         <div class="email-content">
           <div class="email-main">
             <div class="email-line">
               <span class="label-chip">主题</span>
               <span class="value-text subject">${subjectText}</span>
             </div>
             <div class="email-line">
               <span class="label-chip">内容</span>
               ${hasContent ? `<span class="email-preview value-text">${previewText}${preview.length >= 120 ? '...' : ''}</span>` : '<span class="email-preview value-text" style="color:#94a3b8">(暂无预览)</span>'}
             </div>
           </div>
           <div class="email-actions">
             ${isSentView ? `
               <span class="status-badge ${statusClass(e.status)}">${e.status || 'unknown'}</span>
               <button class="btn btn-danger btn-sm" onclick="deleteSent(${e.id});event.stopPropagation()" title="删除记录">
                 <span class="btn-icon">🗑️</span>
               </button>
             ` : `
               <button class="btn btn-secondary btn-sm" data-code="${listCode || ''}" onclick="copyFromList(event, ${e.id});event.stopPropagation()" title="复制内容或验证码">
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
    // 预取当前页前 5 封详情
    if (!isSentView) prefetchTopEmails(pageItems);
    // 标记视图已完成首载
    viewLoaded.add(key);
  } catch (e){ /* redirected */ }
  finally { hideHeaderLoading(); }
}

// 暴露刷新入口给移动端图标调用
try{ window.refreshEmails = function(){ try{ return refresh(); }catch(_){ } }; }catch(_){ }

// 暴露调试开关给开发者使用
try{ 
  window.enableMailboxDebug = function(enable = true) {
    window.__DEBUG_MAILBOX__ = enable;
    if (enable) {
      console.log('邮箱调试模式已开启');
      console.log('当前状态：', {
        mbPage,
        mbLastCount,
        MB_PAGE_SIZE,
        currentMailbox: window.currentMailbox
      });
    } else {
      console.log('邮箱调试模式已关闭');
    }
  };
}catch(_){ }

window.showEmail = async (id) => {
  try {
    let email = emailCache.get(id);
    // 若缓存中无正文，则强制拉取详情，避免批量预取的轻量数据导致内容为空
    if (!email || (!email.html_content && !email.content)) {
      const r = await api(`/api/email/${id}`);
      email = await r.json();
      emailCache.set(id, email);
    }
    els.modalSubject.innerHTML = `
      <span class="modal-icon">📧</span>
      <span>${email.subject || '(无主题)'}</span>
    `;
    
    // 原样展示：优先 html_content 以 iframe 渲染；无 HTML 时以纯文本显示
    const rawHtml = (email.html_content || '').toString();
    const rawText = (email.content || '').toString();
    const plainForCode = `${email.subject || ''} ` + (rawHtml || rawText).replace(/<[^>]+>/g, ' ').replace(/\s+/g,' ').trim();
    const code = extractCode(plainForCode);
    const downloadBtn = email.download ? `
      <a class="btn btn-ghost btn-sm" href="${email.download}" download>
        <span class="btn-icon">⬇️</span>
        <span>下载原始邮件</span>
      </a>` : '';
    const toLine = (email.to_addrs || email.recipients || '').toString();
    const timeLine = formatTs(email.received_at || email.created_at);
    const subjLine = (email.subject || '').toString().replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c] || c));

    els.modalContent.innerHTML = `
      <div class="email-meta-inline" style="margin:4px 0 8px 0;color:#334155;font-size:14px">
        <span>发件人：${email.sender || ''}</span>
        ${toLine ? `<span style=\"margin-left:12px\">收件人：${toLine}</span>` : ''}
        ${timeLine ? `<span style=\"margin-left:12px\">时间：${timeLine}</span>` : ''}
        ${subjLine ? `<span style=\"margin-left:12px\">主题：${subjLine}</span>` : ''}
      </div>
      <div class="email-actions-bar">
        <button class="btn btn-secondary btn-sm" data-code="${code || ''}" onclick="copyFromModal(event, ${id});event.stopPropagation()" title="${code ? '复制验证码' : '复制内容'}">
          <span class="btn-icon">${code ? '🔐' : '📋'}</span>
          <span>${code ? '复制验证码' : '复制内容'}</span>
        </button>
        <button class="btn btn-ghost btn-sm" onclick="copyEmailAllText(this)">
          <span class="btn-icon">📄</span>
          <span>复制全文</span>
        </button>
        ${downloadBtn}
      </div>
      <div id="email-render-host"></div>
    `;

    const host = document.getElementById('email-render-host');
    if (rawHtml.trim()){
      const iframe = document.createElement('iframe');
      iframe.style.width = '100%';
      iframe.style.border = '0';
      iframe.style.minHeight = '60vh';
      host.appendChild(iframe);
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc){
        doc.open();
        doc.write(rawHtml);
        doc.close();
        const resize = () => {
          try{
            const h = Math.max(
              doc.body?.scrollHeight || 0,
              doc.documentElement?.scrollHeight || 0,
              400
            );
            iframe.style.height = h + 'px';
          }catch(_){ }
        };
        iframe.onload = resize;
        setTimeout(resize, 60);
      }
    } else if (rawText.trim()){
      const pre = document.createElement('pre');
      pre.style.whiteSpace = 'pre-wrap';
      pre.style.wordBreak = 'break-word';
      pre.textContent = rawText;
      host.appendChild(pre);
    } else {
      host.innerHTML = '<div class="email-no-content">📭 此邮件暂无内容</div>';
    }
    els.modal.classList.add('show');
    await refresh();
  } catch (e){ /* redirected */ }
}

// 复制弹窗中"所有可见文本"（主题 + 元信息 + 正文纯文本）
window.copyEmailAllText = async (btn) => {
  try{
    const meta = Array.from(document.querySelectorAll('.email-meta-inline span')).map(el => el.textContent.trim()).filter(Boolean).join(' | ');
    const subject = (document.querySelector('#email-modal .modal-header span:nth-child(2)')?.textContent || '').trim();
    let bodyText = '';
    const host = document.getElementById('email-render-host');
    if (host){
      const iframe = host.querySelector('iframe');
      if (iframe && (iframe.contentDocument || iframe.contentWindow?.document)){
        const doc = iframe.contentDocument || iframe.contentWindow.document;
        bodyText = (doc.body?.innerText || doc.documentElement?.innerText || '').trim();
      } else {
        const pre = host.querySelector('pre');
        if (pre) bodyText = pre.textContent || '';
      }
    }
    const text = [subject ? `主题：${subject}` : '', meta, bodyText].filter(Boolean).join('\n\n');
    await navigator.clipboard.writeText(text);
    if (btn){
      const origin = btn.innerHTML;
      btn.innerHTML = '<span class="btn-icon">✅</span><span>已复制</span>';
      btn.disabled = true;
      setTimeout(()=>{ btn.innerHTML = origin; btn.disabled = false; }, 1200);
    }
    showToast('已复制所有文本', 'success');
  }catch(_){ showToast('复制失败', 'warn'); }
}

window.copyEmailContent = async (id) => {
  try{
    let email = emailCache.get(id);
    if (!email || (!isSentView && !email.html_content && !email.content) || (isSentView && !email.html_content && !email.text_content)) {
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

// 在弹窗中点击复制时，给按钮做轻量反馈，避免用户误以为无响应
window.copyEmailContentInModal = async (id, btn) => {
  const original = btn && btn.innerHTML;
  try{
    await window.copyEmailContent(id);
    if (btn){
      btn.innerHTML = '<span class="btn-icon">✅</span><span>已复制</span>';
      btn.disabled = true;
      setTimeout(()=>{ if (btn){ btn.innerHTML = original; btn.disabled = false; } }, 1200);
    }
  }catch(_){
    if (btn){
      btn.innerHTML = '<span class="btn-icon">&#9888;&#65039;</span><span>复制失败</span>';
      setTimeout(()=>{ if (btn){ btn.innerHTML = original; } }, 1200);
    }
  }
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
    // 使用 location.href 而不是 replace，确保创建历史记录条目以支持前进后退
    location.href = '/templates/loading.html?redirect=%2Fhtml%2Fadmin.html&status=' + encodeURIComponent('正在打开管理页面…');
  });
}
if (allMailboxesLink){
  allMailboxesLink.addEventListener('click', (ev) => {
    ev.preventDefault();
    // 使用 location.href 而不是 replace，确保创建历史记录条目以支持前进后退
    location.href = '/templates/loading.html?redirect=%2Fhtml%2Fmailboxes.html&status=' + encodeURIComponent('正在打开邮箱总览页面…');
  });
}

els.logout.onclick = async () => {
  try { fetch('/api/logout', { method:'POST', keepalive: true }); } catch {}
  try {
    // 清理当前用户的所有数据
    clearCurrentMailbox();
    cacheClearForUser();
    // 清理当前邮箱状态
    window.currentMailbox = '';
    // 停止自动刷新
    stopAutoRefresh();
    // 标记来自登出，登录页跳过 session 检查
    sessionStorage.setItem('mf:just_logged_out', '1');
  } catch(_) {}
  location.replace('/html/login.html?from=logout');
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

let mbPage = 1;
const MB_PAGE_SIZE = 10;
let mbLastCount = 0;

/**
 * 更新邮箱列表分页显示
 */
function updateMbPagination() {
  if (!els.mbPager) return;
  
  try {
    // 上一页按钮：始终显示，在第一页时禁用
    const isFirstPage = mbPage <= 1;
    if (els.mbPrev) {
      els.mbPrev.disabled = isFirstPage;
    }
    
    // 下一页按钮：始终显示，在没有更多数据时禁用
    const hasMore = mbLastCount === MB_PAGE_SIZE;
    if (els.mbNext) {
      els.mbNext.disabled = !hasMore;
    }
    
    // 显示页面信息
    if (els.mbPageInfo) {
      if (isFirstPage && !hasMore) {
        // 只有一页数据，显示统计信息
        const searchQuery = (els.mbSearch?.value || '').trim();
        if (searchQuery) {
          els.mbPageInfo.textContent = mbLastCount > 0 ? `找到 ${mbLastCount} 个邮箱` : '未找到匹配的邮箱';
        } else {
          els.mbPageInfo.textContent = mbLastCount > 0 ? `共 ${mbLastCount} 个邮箱` : '暂无邮箱';
        }
      } else {
        // 多页数据，显示当前页码
        els.mbPageInfo.textContent = `第 ${mbPage} 页`;
      }
      els.mbPageInfo.style.textAlign = 'center';
    }
    
    // 显示或隐藏分页器（有数据时就显示）
    els.mbPager.style.display = mbLastCount > 0 ? 'flex' : 'none';
  } catch (error) {
    console.error('updateMbPagination error:', error);
  }
}

async function loadMailboxes(options = {}){
  try{
    // 显示加载动画
    try{
      if (els.mbLoading){
        const tpl = await (await fetch('/templates/loading-inline.html', { cache: 'no-cache' })).text();
        els.mbLoading.innerHTML = tpl;
      }
    }catch(_){ }
    // 同步显示配额（增加超时避免阻塞）
    try{
      // 先尝试使用本地缓存/预取的配额，提升首屏渲染速度
      const quotaCached = cacheGet('quota', 60*60*1000);
      const quotaPrefetched = readPrefetch('mf:prefetch:quota');
      const quotaEl = document.getElementById('quota');
      if (quotaEl && quotaCached && typeof quotaCached.used !== 'undefined' && typeof quotaCached.limit !== 'undefined'){
        const displayText = quotaCached.isAdmin 
          ? `${quotaCached.used} 邮箱` 
          : `${quotaCached.used} / ${quotaCached.limit}`;
        quotaEl.textContent = displayText;
        if (quotaCached.isAdmin) {
          quotaEl.title = '系统总邮箱数量';
          quotaEl.classList.add('admin-quota');
        } else {
          quotaEl.title = `已用邮箱 ${quotaCached.used} / 上限 ${quotaCached.limit}`;
          quotaEl.classList.remove('admin-quota');
        }
      } else if (quotaEl && quotaPrefetched && typeof quotaPrefetched.used !== 'undefined' && typeof quotaPrefetched.limit !== 'undefined'){
        const displayText = quotaPrefetched.isAdmin 
          ? `${quotaPrefetched.used} 邮箱` 
          : `${quotaPrefetched.used} / ${quotaPrefetched.limit}`;
        quotaEl.textContent = displayText;
        if (quotaPrefetched.isAdmin) {
          quotaEl.title = '系统总邮箱数量';
          quotaEl.classList.add('admin-quota');
        } else {
          quotaEl.title = `已用邮箱 ${quotaPrefetched.used} / 上限 ${quotaPrefetched.limit}`;
          quotaEl.classList.remove('admin-quota');
        }
      }
      const qController = new AbortController();
      const qTimeout = setTimeout(()=>qController.abort(), 5000);
      const qr = await api('/api/user/quota', { signal: qController.signal });
      const q = await qr.json();
      clearTimeout(qTimeout);
      if (quotaEl && q && typeof q.used !== 'undefined' && typeof q.limit !== 'undefined'){
        // 超级管理员显示系统总邮箱数，普通用户显示个人邮箱数
        const displayText = q.isAdmin 
          ? `${q.used} 邮箱` 
          : `${q.used} / ${q.limit}`;
        quotaEl.textContent = displayText;
        
        // 为超级管理员添加特殊样式提示
        if (q.isAdmin) {
          quotaEl.title = '系统总邮箱数量';
          quotaEl.classList.add('admin-quota');
        } else {
          quotaEl.title = `已用邮箱 ${q.used} / 上限 ${q.limit}`;
          quotaEl.classList.remove('admin-quota');
        }
      }
      try{ cacheSet('quota', q); }catch(_){ }
    }catch(_){ }

    // 首屏优先消费缓存/预取的历史邮箱，避免重复等待慢接口
    if (mbPage === 1 && !options.forceFresh){
      const mbCached = cacheGet('mailboxes:page1', 6*60*60*1000);
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
        // 首屏用缓存渲染时，更新分页显示
        mbLastCount = Array.isArray(mbCached) ? mbCached.length : 0;
        updateMbPagination();
      }
      const mbPrefetched = readPrefetch('mf:prefetch:mailboxes');
      if (!options.forceFresh && Array.isArray(mbPrefetched)){
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
        // 首屏用预取渲染时，更新分页显示
        mbLastCount = Array.isArray(mbPrefetched) ? mbPrefetched.length : 0;
        updateMbPagination();
        // 预取当前邮箱列表前 5 封
        await prefetchTopEmails();
        return;
      }
    }

    const mController = new AbortController();
    const mTimeout = setTimeout(()=>mController.abort(), 8000);
    
    // 构建搜索参数（真正的服务器端搜索）
    const q = (els.mbSearch?.value || '').trim();
    const params = new URLSearchParams({ 
      limit: String(MB_PAGE_SIZE), 
      offset: String((mbPage - 1) * MB_PAGE_SIZE) 
    });
    if (q) params.set('q', q);
    
    const r = await api(`/api/mailboxes?${params.toString()}`, { signal: mController.signal });
    let items = await r.json();
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
    
    els.mbList.innerHTML = html || '<div style="color:#94a3b8">暂无历史邮箱</div>';
    if (els.mbLoading) els.mbLoading.innerHTML = '';
    
    // 更新分页显示逻辑
    mbLastCount = Array.isArray(items) ? items.length : 0;
    updateMbPagination();
    
    // 预取当前邮箱列表前 5 封
    await prefetchTopEmails();
    
    // 缓存第一页数据
    if (mbPage === 1){
      try{ cacheSet('mailboxes:page1', items || []); }catch(_){ }
    }
  }catch(_){ 
    if (els.mbLoading) els.mbLoading.innerHTML = '';
    els.mbList.innerHTML = '<div style="color:#dc2626">加载失败</div>'; 
    // 加载失败时隐藏分页器
    mbLastCount = 0;
    updateMbPagination();
  }
}

window.selectMailbox = async (addr) => {
  const now = Date.now();
  if (window.__lastSelectClick && now - window.__lastSelectClick < 1000){ return; }
  window.__lastSelectClick = now;
  window.currentMailbox = addr;
  // 持久化保存当前邮箱（用户隔离）
  saveCurrentMailbox(addr);
  const t = document.getElementById('email-text');
  if (t) t.textContent = addr; else els.email.textContent = addr;
  els.email.classList.add('has-email');
  els.emailActions.style.display = 'flex';
  els.listCard.style.display = 'block';
  // 保持默认关闭，用户可点击按钮展开
  // 重启自动刷新
  startAutoRefresh();
  // 标记进入二级页（移动端返回用）
  try{ sessionStorage.setItem('mf:m:mainTab','mail'); }catch(_){ }
  // 首次选择该视图/邮箱才清空，否则保留并仅显示右上角更新
  const key = getViewKey();
  if (!viewLoaded.has(key)) { if (els.list) els.list.innerHTML = ''; }
  resetPager();
  await refresh();
  await prefetchTopEmails();
}

async function prefetchTopEmails(list){
  try{
    if (!window.currentMailbox) return;
    const emails = Array.isArray(list) ? list : (await (await api(`/api/emails?mailbox=${encodeURIComponent(window.currentMailbox)}`)).json());
    const top = (emails || []).slice(0,5);
    const ids = top.map(e => e.id).filter(id => !emailCache.has(id));
    if (!ids.length) return;
    // 批量接口获取详情
    const r = await api('/api/emails/batch?ids=' + ids.join(','));
    const details = await r.json();
    (details||[]).forEach(d => { if (d && d.id) emailCache.set(d.id, d); });
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
      
      // 重新加载邮箱列表以更新排序（重置到第一页）
      mbPage = 1;
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
          // 清除持久化存储（用户隔离）
          clearCurrentMailbox();
          // 停止自动刷新
          stopAutoRefresh();
        }
        
        // 强制刷新历史邮箱列表，避免假阳性
        if (typeof mbPage !== 'undefined') { mbPage = 1; }
        await loadMailboxes();
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

// 邮箱列表分页按钮事件绑定
if (els.mbPrev) {
  els.mbPrev.onclick = async () => {
    if (mbPage > 1) {
      mbPage--;
      await loadMailboxes();
    }
  };
}

if (els.mbNext) {
  els.mbNext.onclick = async () => {
    if (mbLastCount === MB_PAGE_SIZE) {
      mbPage++;
      await loadMailboxes();
    }
  };
}

// 历史邮箱搜索：防抖搜索机制，与mailboxes页面保持一致
let searchTimeout = null;

// 防抖搜索函数
function debouncedMbSearch() {
  if (searchTimeout) {
    clearTimeout(searchTimeout);
  }
  searchTimeout = setTimeout(() => {
    mbPage = 1; // 重置分页到第一页
    loadMailboxes({ forceFresh: true });
  }, 300); // 300ms防抖延迟
}

// 立即搜索（按回车键）
function immediateMbSearch() {
  if (searchTimeout) {
    clearTimeout(searchTimeout);
    searchTimeout = null;
  }
  mbPage = 1; // 重置分页到第一页
  loadMailboxes({ forceFresh: true });
}

if (els.mbSearch){
  els.mbSearch.addEventListener('input', debouncedMbSearch);
  els.mbSearch.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter'){
      ev.preventDefault();
      immediateMbSearch();
    }
  });
}

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

// ===== 侧板收起/展开功能 =====
let sidebarCollapsed = false;
const __isMobile = (typeof window !== 'undefined') && window.matchMedia && window.matchMedia('(max-width: 768px)').matches;

// 从localStorage恢复侧板状态（移动端禁用“收起侧板”功能）
try {
  const savedState = localStorage.getItem('mailfree:sidebarCollapsed');
  if (__isMobile) {
    // 移动端：强制不折叠，并隐藏按钮
    sidebarCollapsed = false;
    applySidebarState();
    try { if (els.sidebarToggle) els.sidebarToggle.style.display = 'none'; } catch(_){ }
  } else {
    if (savedState === 'true') {
      sidebarCollapsed = true;
      applySidebarState();
    }
  }
} catch(_) {}

function applySidebarState() {
  if (!els.sidebar || !els.container || !els.sidebarToggleIcon) return;
  
  if (sidebarCollapsed) {
    els.sidebar.classList.add('collapsed');
    els.container.classList.add('sidebar-collapsed');
    els.sidebarToggleIcon.textContent = '▶'; // 展开图标（向右箭头）
    if (els.sidebarToggle) els.sidebarToggle.title = '展开侧板';
  } else {
    els.sidebar.classList.remove('collapsed');
    els.container.classList.remove('sidebar-collapsed');
    els.sidebarToggleIcon.textContent = '◀'; // 收起图标（向左箭头）
    if (els.sidebarToggle) els.sidebarToggle.title = '收起侧板';
  }
}

function toggleSidebar() {
  // 移动端不支持收起侧板，仅通过点击标题展开/收起列表
  if (__isMobile) {
    showInlineTip(els.sidebarToggle || els.sidebar, '移动端请点“历史邮箱”标题展开/收起', 'info');
    return;
  }
  sidebarCollapsed = !sidebarCollapsed;
  
  // 保存状态到localStorage
  try {
    localStorage.setItem('mailfree:sidebarCollapsed', sidebarCollapsed.toString());
  } catch(_) {}
  
  // 应用样式变化
  applySidebarState();
  
  // 显示反馈
  showInlineTip(els.sidebarToggle, sidebarCollapsed ? '侧板已收起' : '侧板已展开', 'info');
}

// 绑定点击事件
if (els.sidebarToggle) {
  els.sidebarToggle.onclick = toggleSidebar;
}

// 移动端：历史邮箱列表允许点击标题切换（配置区保持常显）
if (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) {
  try{
    const cfg = document.querySelector('.mailbox-config-section');
    const cfgBtn = document.getElementById('config-toggle');
    // 移动端不折叠配置区，隐藏折叠按钮
    if (cfg){ cfg.classList.remove('collapsed'); }
    if (cfgBtn){ cfgBtn.style.display = 'none'; }
  }catch(_){ }
  try{
    const sidebar = document.querySelector('.sidebar');
    const header = sidebar ? sidebar.querySelector('.sidebar-header') : null;
    const mbBtn = document.getElementById('mb-toggle');
    // 移动端禁用历史邮箱折叠：移除折叠状态与交互并隐藏按钮
    if (sidebar){ sidebar.classList.remove('list-collapsed'); }
    if (mbBtn){ mbBtn.style.display = 'none'; }
    if (header){ header.style.cursor = 'default'; }
  }catch(_){ }
}

// 切换收件箱/发件箱
function switchToInbox(){
  isSentView = false;
  if (els.tabInbox) els.tabInbox.setAttribute('aria-pressed', 'true');
  if (els.tabSent) els.tabSent.setAttribute('aria-pressed', 'false');
  if (els.boxTitle) els.boxTitle.textContent = '收件箱';
  if (els.boxIcon) els.boxIcon.textContent = '📬';
  const key = getViewKey();
  if (!viewLoaded.has(key)) { if (els.list) els.list.innerHTML = ''; }
  resetPager();
  refresh();
  // 路由更新由 RouteManager 统一处理
}
function switchToSent(){
  isSentView = true;
  if (els.tabInbox) els.tabInbox.setAttribute('aria-pressed', 'false');
  if (els.tabSent) els.tabSent.setAttribute('aria-pressed', 'true');
  if (els.boxTitle) els.boxTitle.textContent = '发件箱';
  if (els.boxIcon) els.boxIcon.textContent = '📤';
  const key = getViewKey();
  if (!viewLoaded.has(key)) { if (els.list) els.list.innerHTML = ''; }
  resetPager();
  refresh();
  // 路由更新由 RouteManager 统一处理
}
// 导出函数供路由管理器调用
window.switchToInbox = switchToInbox;
window.switchToSent = switchToSent;
window.isSentView = isSentView;

// 点击事件由 RouteManager 处理，这里只是备份
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

// 在弹窗内复制验证码并给按钮即时反馈
window.copyCodeInModal = async (code, btn) => {
  try{
    await navigator.clipboard.writeText(String(code||''));
    if (btn){
      const origin = btn.innerHTML;
      btn.innerHTML = '<span class="btn-icon">✅</span><span>已复制验证码</span>';
      btn.disabled = true;
      setTimeout(()=>{ btn.innerHTML = origin; btn.disabled = false; }, 1200);
    }
    showToast('已复制验证码/激活码：' + String(code||''), 'success');
  }catch(_){
    if (btn){
      const origin = btn.innerHTML;
      btn.innerHTML = '<span class="btn-icon">&#9888;&#65039;</span><span>复制失败</span>';
      setTimeout(()=>{ btn.innerHTML = origin; }, 1200);
    }
  }
}

// 列表项复制：若已在列表阶段提取到验证码，立即复制并反馈；否则回退到详情获取
window.copyFromList = async (ev, id) => {
  try{
    const btn = ev.currentTarget || ev.target;
    const code = (btn && btn.dataset ? (btn.dataset.code || '') : '').trim();
    if (code){
      await navigator.clipboard.writeText(code);
      const original = btn.innerHTML;
      btn.innerHTML = '<span class="btn-icon">✅</span>';
      btn.disabled = true;
      setTimeout(()=>{ btn.innerHTML = '<span class="btn-icon">📋</span>'; btn.disabled = false; }, 800);
      try{ await showToast('已复制验证码：' + code, 'success'); }catch(_){ }
      return;
    }
    // 回退：无验证码时再请求详情
    await window.copyEmailContent(id);
  }catch(_){ showToast('复制失败', 'warn'); }
}

// 模态框复制：与列表复制保持一致的逻辑，优先复制验证码，没有时复制内容
window.copyFromModal = async (ev, id) => {
  try{
    const btn = ev.currentTarget || ev.target;
    const code = (btn && btn.dataset ? (btn.dataset.code || '') : '').trim();
    if (code){
      await navigator.clipboard.writeText(code);
      const original = btn.innerHTML;
      btn.innerHTML = '<span class="btn-icon">✅</span><span>已复制</span>';
      btn.disabled = true;
      setTimeout(()=>{ btn.innerHTML = original; btn.disabled = false; }, 1200);
      try{ await showToast('已复制验证码：' + code, 'success'); }catch(_){ }
      return;
    }
    // 回退：无验证码时复制邮件内容
    await window.copyEmailContentInModal(id, btn);
  }catch(_){ showToast('复制失败', 'warn'); }
}

// ========== 安全的邮箱状态恢复函数 ==========
// 仅在用户身份验证后调用，确保邮箱属于当前用户
function restoreUserMailboxState() {
  try {
    // 检查是否从管理页跳转过来
    let savedMailbox = null;
    const fromAdmin = sessionStorage.getItem('mf:fromAdmin');
    
    if (fromAdmin === '1') {
      // 从管理页跳转，使用通用键名读取邮箱
      savedMailbox = sessionStorage.getItem('mf:currentMailbox');
      // 清除临时标记
      sessionStorage.removeItem('mf:fromAdmin');
      // 如果成功读取，保存到用户隔离的键名中
      if (savedMailbox) {
        saveCurrentMailbox(savedMailbox);
      }
    } else {
      // 正常恢复，使用用户隔离的键名
      savedMailbox = loadCurrentMailbox();
    }
    
    if (savedMailbox && !window.currentMailbox) {
      console.log('恢复用户邮箱状态:', savedMailbox);
      window.currentMailbox = savedMailbox;
      // 更新UI显示
      const t = document.getElementById('email-text');
      if (t) t.textContent = savedMailbox; 
      else if (els.email) els.email.textContent = savedMailbox;
      if (els.email) els.email.classList.add('has-email');
      if (els.emailActions) els.emailActions.style.display = 'flex';
      if (els.listCard) els.listCard.style.display = 'block';
      
      // 自动加载该邮箱的邮件列表
      setTimeout(() => {
        if (window.currentMailbox === savedMailbox) {
          console.log('自动加载恢复的邮箱邮件:', savedMailbox);
          refresh();
          // 开启自动刷新
          startAutoRefresh();
        }
      }, 100);
      return true;
    }
  } catch(e) {
    console.warn('恢复邮箱状态失败:', e);
    // 发生错误时清理可能的脏数据
    clearCurrentMailbox();
  }
  return false;
}

