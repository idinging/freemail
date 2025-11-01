import { getCurrentUserKey } from './storage.js';

const els = {
  grid: document.getElementById('grid'),
  empty: document.getElementById('empty'),
  loadingPlaceholder: document.getElementById('loading-placeholder'),
  q: document.getElementById('q'),
  search: document.getElementById('search'),
  prev: document.getElementById('prev'),
  next: document.getElementById('next'),
  page: document.getElementById('page'),
  logout: document.getElementById('logout'),
  viewGrid: document.getElementById('view-grid'),
  viewList: document.getElementById('view-list'),
  domainFilter: document.getElementById('domain-filter'),
  loginFilter: document.getElementById('login-filter')
};

let page = 1;
const PAGE_SIZE = 20; // 固定每页20（4列×5行）
let lastCount = 0;
let currentData = []; // 缓存当前显示的数据

// 视图模式：'grid' 或 'list'
let currentView = localStorage.getItem('mf:mailboxes:view') || 'grid';

// 性能优化变量
let searchTimeout = null;
let isLoading = false;
let lastLoadTime = 0;

// 筛选变量
let availableDomains = []; // 可用的域名列表（从后端获取）

async function api(path){
  const r = await fetch(path, { headers: { 'Cache-Control':'no-cache' } });
  if (r.status === 401){ location.replace('/html/login.html'); throw new Error('unauthorized'); }
  return r;
}

// showToast 函数已由 toast-utils.js 统一提供

// 专门用于跳转的短时间toast
async function showJumpToast(message){
  await showToast(message, 'info', 500); // 500ms显示时间 + 300ms淡出 = 800ms总时间
}

// 生成骨架屏卡片
function createSkeletonCard() {
  return `
    <div class="skeleton-card">
      <div class="skeleton-line title"></div>
      <div class="skeleton-line subtitle"></div>
      <div class="skeleton-line text"></div>
      <div class="skeleton-line time"></div>
    </div>
  `;
}

// 生成骨架屏列表项
function createSkeletonListItem() {
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

// 生成骨架屏内容
function generateSkeletonContent(viewMode = 'grid', count = 8) {
  if (viewMode === 'grid') {
    return Array(count).fill().map(() => createSkeletonCard()).join('');
  } else {
    return Array(count).fill().map(() => createSkeletonListItem()).join('');
  }
}

function fmt(ts){
  if (!ts) return '';
  const d = new Date(String(ts).replace(' ','T') + 'Z');
  return new Intl.DateTimeFormat('zh-CN',{ timeZone:'Asia/Shanghai', hour12:false, year:'numeric', month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit' }).format(d);
}

function renderGrid(items){
  return items.map(x => `
    <div class="mailbox-card" data-address="${x.address}">
      <div class="line addr" title="${x.address}">${x.address}</div>
      <div class="line pwd" title="${x.password_is_default ? '默认密码（邮箱本身）' : '自定义密码'}">密码：${x.password_is_default ? '默认' : '自定义'}</div>
      <div class="line login" title="邮箱登录权限">登录：${x.can_login ? '<span style="color:#16a34a">&#10003;允许</span>' : '<span style="color:#dc2626">&#10007;禁止</span>'}</div>
      <div class="line time" title="${fmt(x.created_at)}">创建：${fmt(x.created_at)}</div>
      ${x.is_pinned ? '<div class="pin-badge" title="已置顶">📌</div>' : ''}
      <div class="actions">
        <button class="btn-icon" title="复制邮箱" onclick="event.stopPropagation(); copyMailboxAddressFromList('${x.address}')">📋</button>
        <button class="btn-icon ${x.can_login ? 'active' : ''}" title="${x.can_login ? '禁止邮箱登录' : '允许邮箱登录'}" onclick="event.stopPropagation(); toggleMailboxLogin('${x.address}', ${!x.can_login})">${x.can_login ? '🔓' : '🔒'}</button>
      </div>
    </div>
  `).join('');
}

function renderList(items){
  return items.map(x => `
    <div class="mailbox-list-item" data-address="${x.address}">
      <div class="pin-indicator">
        ${x.is_pinned ? '<span class="pin-icon" title="已置顶">📌</span>' : '<span class="pin-placeholder"></span>'}
      </div>
      <div class="mailbox-info">
        <div class="addr" title="${x.address}">${x.address}</div>
        <div class="meta">
          <span class="pwd" title="${x.password_is_default ? '默认密码（邮箱本身）' : '自定义密码'}">密码：${x.password_is_default ? '默认' : '自定义'}</span>
          <span class="login" title="邮箱登录权限">登录：${x.can_login ? '<span style="color:#16a34a">&#10003;允许</span>' : '<span style="color:#dc2626">&#10007;禁止</span>'}</span>
          <span class="time" title="${fmt(x.created_at)}">创建：${fmt(x.created_at)}</span>
        </div>
      </div>
      <div class="list-actions">
        <button class="btn btn-ghost btn-sm" title="复制邮箱" onclick="event.stopPropagation(); copyMailboxAddressFromList('${x.address}')">📋</button>
        <button class="btn btn-ghost btn-sm ${x.is_pinned ? 'active' : ''}" title="${x.is_pinned ? '取消置顶' : '置顶邮箱'}" onclick="event.stopPropagation(); toggleMailboxPin('${x.address}', ${!x.is_pinned})">${x.is_pinned ? '📌' : '📍'}</button>
        <button class="btn btn-ghost btn-sm" title="分配用户" onclick="event.stopPropagation(); assignMailboxToUser('${x.address}')">👤</button>
        <button class="btn btn-ghost btn-sm" title="重置为默认密码" onclick="event.stopPropagation(); resetMailboxPassword('${x.address}')">🔁</button>
        <button class="btn btn-ghost btn-sm ${x.can_login ? 'active' : ''}" title="${x.can_login ? '禁止邮箱登录' : '允许邮箱登录'}" onclick="event.stopPropagation(); toggleMailboxLogin('${x.address}', ${!x.can_login})">${x.can_login ? '🔓' : '🔒'}</button>
        <button class="btn btn-ghost btn-sm" title="修改密码" onclick="event.stopPropagation(); changeMailboxPassword('${x.address}')">🔑</button>
      </div>
    </div>
  `).join('');
}

function render(items){
  const list = Array.isArray(items) ? items : [];
  
  // 缓存当前数据
  currentData = list;
  
  // 隐藏加载占位符
  els.loadingPlaceholder.classList.remove('show');
  
  // 清理任何残留的动画状态
  cleanupTransitionState();
  
  // 移除可能的隐藏样式，让CSS类接管显示控制
  els.grid.style.display = '';
  els.grid.style.visibility = '';
  
  // 切换容器样式，保留基础类名
  els.grid.className = currentView === 'grid' ? 'grid' : 'list';
  
  // 根据视图模式渲染
  if (currentView === 'grid') {
    els.grid.innerHTML = renderGrid(list);
  } else {
    els.grid.innerHTML = renderList(list);
  }
  
  // 控制空状态显示
  els.empty.style.display = list.length ? 'none' : 'flex';
}

async function load(){
  // 防止重复请求
  if (isLoading) return;
  
  const now = Date.now();
  // 防止过于频繁的请求（最少间隔100ms）
  if (now - lastLoadTime < 100) return;
  
  try {
    isLoading = true;
    lastLoadTime = now;
    
    // 显示加载状态
    showLoadingState(true);
    
    const q = (els.q.value || '').trim();
    const domainFilter = (els.domainFilter.value || '').trim();
    const loginFilter = (els.loginFilter.value || '').trim();
    
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String((page-1)*PAGE_SIZE) });
    if (q) params.set('q', q);
    if (domainFilter) params.set('domain', domainFilter);
    if (loginFilter) params.set('can_login', loginFilter === 'allowed' ? 'true' : loginFilter === 'denied' ? 'false' : '');
    
    const r = await api('/api/mailboxes?' + params.toString());
    const data = await r.json();
    
    render(data);
    lastCount = Array.isArray(data) ? data.length : 0;
    
    // 更新分页显示
    updatePagination();
    
  } catch (error) {
    console.error('加载邮箱列表失败:', error);
    showToast('加载失败，请重试', 'error');
  } finally {
    isLoading = false;
    showLoadingState(false);
  }
}

// 显示/隐藏加载状态
function showLoadingState(show) {
  if (show) {
    // 禁用交互元素
    els.search.disabled = true;
    els.search.textContent = '搜索中...';
    els.prev.disabled = true;
    els.next.disabled = true;
    
    // 使用CSS类来控制显示隐藏，而不是内联样式
    els.grid.classList.add('loading-hidden');
    els.empty.style.display = 'none';
    
    // 生成并显示加载占位符
    const skeletonContent = generateSkeletonContent(currentView, PAGE_SIZE);
    els.loadingPlaceholder.innerHTML = skeletonContent;
    els.loadingPlaceholder.className = currentView === 'grid' ? 'loading-placeholder show' : 'loading-placeholder show list';
    
  } else {
    // 恢复交互元素
    els.search.disabled = false;
    els.search.innerHTML = '<span class="btn-icon">🔍</span><span>搜索</span>';
    
    // 隐藏加载占位符 - 完全重置className确保没有残留类
    els.loadingPlaceholder.className = 'loading-placeholder';
    
    // 移除加载隐藏类，让CSS类接管显示控制
    els.grid.classList.remove('loading-hidden');
    
    // 分页按钮状态由updatePagination()统一管理
  }
}

function updatePagination() {
  // 上一页按钮：始终显示，在第一页时禁用
  const isFirstPage = page <= 1;
  els.prev.disabled = isFirstPage;
  
  // 下一页按钮：始终显示，在没有更多数据时禁用
  const hasMore = lastCount === PAGE_SIZE;
  els.next.disabled = !hasMore;
  
  // 显示页面信息
  if (isFirstPage && !hasMore) {
    // 只有一页数据，显示统计信息
    const searchQuery = (els.q.value || '').trim();
    if (searchQuery) {
      els.page.textContent = lastCount > 0 ? `找到 ${lastCount} 个邮箱` : '未找到匹配的邮箱';
    } else {
      els.page.textContent = lastCount > 0 ? `共 ${lastCount} 个邮箱` : '暂无邮箱';
    }
  } else {
    // 多页数据，显示当前页码
    els.page.textContent = `第 ${page} 页`;
  }
  
  els.page.style.textAlign = 'center';
}

/**
 * 从后端加载域名列表
 */
async function loadDomains() {
  try {
    const r = await api('/api/domains');
    const domains = await r.json();
    if (Array.isArray(domains) && domains.length > 0) {
      availableDomains = domains.sort();
      updateDomainFilter();
    }
  } catch (error) {
    console.error('加载域名列表失败:', error);
    // 加载失败不阻塞主流程，仅在控制台输出
  }
}

/**
 * 更新域名筛选下拉框
 */
function updateDomainFilter() {
  if (!els.domainFilter) return;
  
  const currentValue = els.domainFilter.value;
  
  // 保留"全部域名"选项，添加其他域名选项
  const options = ['<option value="">全部域名</option>'];
  availableDomains.forEach(domain => {
    const selected = currentValue === domain ? 'selected' : '';
    options.push(`<option value="${domain}" ${selected}>@${domain}</option>`);
  });
  
  els.domainFilter.innerHTML = options.join('');
  
  // 恢复之前选中的值
  if (currentValue && availableDomains.includes(currentValue)) {
    els.domainFilter.value = currentValue;
  }
}

// 防抖搜索函数
function debouncedSearch() {
  if (searchTimeout) {
    clearTimeout(searchTimeout);
  }
  searchTimeout = setTimeout(() => {
    page = 1;
    load();
  }, 300); // 300ms防抖延迟
}

// 立即搜索（点击搜索按钮）
function immediateSearch() {
  if (searchTimeout) {
    clearTimeout(searchTimeout);
    searchTimeout = null;
  }
  page = 1;
  load();
}

// 筛选器变更处理
function handleFilterChange() {
  page = 1;
  load();
}

// 事件绑定
els.search.onclick = immediateSearch;

els.prev.onclick = () => { 
  if (page > 1 && !isLoading) { 
    page--; 
    load(); 
  } 
};

els.next.onclick = () => { 
  if (lastCount === PAGE_SIZE && !isLoading) { 
    page++; 
    load(); 
  } 
};

// 搜索框输入防抖
els.q.addEventListener('input', debouncedSearch);
els.q.addEventListener('keydown', e => { 
  if (e.key === 'Enter'){ 
    e.preventDefault();
    immediateSearch();
  } 
});

// 筛选器事件监听
if (els.domainFilter) {
  els.domainFilter.addEventListener('change', handleFilterChange);
}

if (els.loginFilter) {
  els.loginFilter.addEventListener('change', handleFilterChange);
}

els.logout && (els.logout.onclick = async () => { try{ fetch('/api/logout',{method:'POST'}); }catch(_){ } location.replace('/html/login.html?from=logout'); });

// 视图切换功能
function switchView(view) {
  if (currentView === view) return; // 如果已经是当前视图，不执行切换
  
  currentView = view;
  localStorage.setItem('mf:mailboxes:view', view);
  
  // 更新按钮状态
  els.viewGrid.classList.toggle('active', view === 'grid');
  els.viewList.classList.toggle('active', view === 'list');
  
  // 平滑的视图切换
  smoothViewTransition(view);
}

// 平滑的视图切换动画
function smoothViewTransition(targetView) {
  // 如果没有数据，直接切换
  if (!currentData || currentData.length === 0) {
    els.grid.className = targetView === 'grid' ? 'grid' : 'list';
    cleanupTransitionState();
    return;
  }
  
  // 先清理任何残留的动画状态
  cleanupTransitionState();
  
  // 添加过渡状态类
  els.grid.classList.add('view-transitioning');
  
  // 短暂的淡出效果
  els.grid.style.opacity = '0.6';
  
  // 延迟后执行布局切换
  setTimeout(() => {
    // 切换容器样式
    els.grid.className = targetView === 'grid' ? 'grid view-transitioning' : 'list view-transitioning';
    
    // 使用缓存的数据重新渲染
    if (targetView === 'grid') {
      els.grid.innerHTML = renderGrid(currentData);
    } else {
      els.grid.innerHTML = renderList(currentData);
    }
    
    // 立即恢复透明度，让元素自己的动画接管
    els.grid.style.opacity = '';
    
    // 动画完成后移除过渡类
    setTimeout(() => {
      cleanupTransitionState();
    }, 350); // 等待所有元素动画完成 (0.25s + 0.09s delay + 0.01s buffer)
    
    // 备用清理机制，防止动画残留
    setTimeout(() => {
      if (els.grid.classList.contains('view-transitioning')) {
        console.warn('强制清理残留的动画状态');
        cleanupTransitionState();
      }
    }, 500);
  }, 100);
}

// 彻底清理过渡动画状态
function cleanupTransitionState() {
  // 移除过渡类
  els.grid.classList.remove('view-transitioning');
  
  // 重置容器样式
  els.grid.style.opacity = '';
  
  // 强制重置所有子元素的动画状态
  const cards = els.grid.querySelectorAll('.mailbox-card, .mailbox-list-item');
  cards.forEach(card => {
    card.style.animation = '';
    card.style.opacity = '';
    card.style.transform = '';
    card.style.animationDelay = '';
    card.style.animationFillMode = '';
  });
}

// 添加动画结束监听器，提供额外的清理保险
function setupAnimationCleanupListeners() {
  els.grid.addEventListener('animationend', function(event) {
    // 检查是否是过渡动画结束
    if (event.animationName === 'fadeInUp' && els.grid.classList.contains('view-transitioning')) {
      // 检查是否所有动画都已结束
      const animatingCards = els.grid.querySelectorAll('.mailbox-card[style*="animation"], .mailbox-list-item[style*="animation"]');
      if (animatingCards.length === 0) {
        setTimeout(() => {
          if (els.grid.classList.contains('view-transitioning')) {
            console.log('通过动画监听器清理过渡状态');
            cleanupTransitionState();
          }
        }, 50);
      }
    }
  });
}

// 初始化视图切换按钮状态
function initViewToggle() {
  els.viewGrid.classList.toggle('active', currentView === 'grid');
  els.viewList.classList.toggle('active', currentView === 'list');
  
  // 添加点击事件
  els.viewGrid.onclick = () => switchView('grid');
  els.viewList.onclick = () => switchView('list');
}

// 初始化视图切换
initViewToggle();

// 设置动画清理监听器
setupAnimationCleanupListeners();

// 邮箱卡片点击事件委托
els.grid.addEventListener('click', function(event) {
  const card = event.target.closest('.mailbox-card, .mailbox-list-item');
  if (!card) return;
  
  // 检查是否点击的是操作按钮区域
  if (event.target.closest('.actions, .list-actions')) {
    return; // 如果点击的是按钮区域，不处理
  }
  
  const address = card.getAttribute('data-address');
  if (address) {
    selectAndGoToHomepage(address, event);
  }
});

// footer
(async function(){
  try{
    const res = await fetch('/templates/footer.html', { cache: 'no-cache' });
    const html = await res.text();
    const slot = document.getElementById('footer-slot');
    if (slot){ slot.outerHTML = html; setTimeout(()=>{ const y=document.getElementById('footer-year'); if (y) y.textContent=new Date().getFullYear(); },0); }
  }catch(_){ }
})();

// 页面初始加载时显示加载状态
showLoadingState(true);

// 加载域名列表（与邮箱列表并行加载）
loadDomains();

load();

// 添加浏览器前进后退按钮支持
window.addEventListener('popstate', function(event) {
  // console.log('mailboxes页面popstate事件:', event.state);
  // 在邮箱管理页面，前进后退主要是页面内的状态变化
  // 如果用户通过浏览器后退想离开这个页面，需要相应处理
  
  // 检查是否有保存的来源页面信息
  const referrer = document.referrer;
  if (referrer && (referrer.includes('/html/app.html') || referrer.endsWith('/'))) {
    // 如果来自首页，后退应该回到首页
    // 但这里我们已经在邮箱管理页面了，让浏览器自然处理
  }
});

// 监听页面即将卸载，保存状态用于历史记录恢复
window.addEventListener('beforeunload', function() {
  try {
    // 保存当前页面状态，便于历史记录恢复
    sessionStorage.setItem('mf:mailboxes:lastPage', page.toString());
    sessionStorage.setItem('mf:mailboxes:lastQuery', els.q.value || '');
    sessionStorage.setItem('mf:mailboxes:lastDomain', els.domainFilter?.value || '');
    sessionStorage.setItem('mf:mailboxes:lastLogin', els.loginFilter?.value || '');
    
    // 清理导航计时器，避免意外跳转
    if (navigationTimer) {
      clearTimeout(navigationTimer);
      navigationTimer = null;
    }
    
    // 清理页面上的所有toast，避免跨页面残留
    const toastContainer = document.getElementById('toast');
    if (toastContainer) {
      toastContainer.remove();
    }
    
    // 清理动画状态，避免跨页面残留
    cleanupTransitionState();
  } catch(_) {}
});

// 页面加载时恢复之前的状态
try {
  const savedPage = sessionStorage.getItem('mf:mailboxes:lastPage');
  const savedQuery = sessionStorage.getItem('mf:mailboxes:lastQuery');
  const savedDomain = sessionStorage.getItem('mf:mailboxes:lastDomain');
  const savedLogin = sessionStorage.getItem('mf:mailboxes:lastLogin');
  
  if (savedPage && !isNaN(Number(savedPage))) {
    page = Math.max(1, Number(savedPage));
  }
  
  if (savedQuery) {
    els.q.value = savedQuery;
  }
  
  if (savedDomain && els.domainFilter) {
    els.domainFilter.value = savedDomain;
  }
  
  if (savedLogin && els.loginFilter) {
    els.loginFilter.value = savedLogin;
  }
} catch(_) {}

// 操作防重复标记
let operationFlags = {
  copying: false,
  resetting: false,
  toggling: false,
  changing: false,
  pinning: false,
  assigning: false
};

// 复制单个卡片中的邮箱地址（优化版）
window.copyMailboxAddressFromList = async function(address){
  if (operationFlags.copying) return;
  
  try{
    operationFlags.copying = true;
    await navigator.clipboard.writeText(String(address||''));
    showToast('复制成功', 'success');
  }catch(_){ 
    showToast('复制失败', 'error'); 
  } finally {
    setTimeout(() => { operationFlags.copying = false; }, 500);
  }
}

// 全局变量存储重置密码模态框的监听器控制器
let currentResetModalController = null;

// 重置邮箱密码为默认（仅管理员可用）
window.resetMailboxPassword = async function(address){
  // 防止重复操作
  if (operationFlags.resetting) return;
  
  try{
    // 如果有之前的控制器，先取消
    if (currentResetModalController) {
      currentResetModalController.abort();
    }
    
    // 创建新的 AbortController
    currentResetModalController = new AbortController();
    const signal = currentResetModalController.signal;
    
    const modal = document.getElementById('reset-modal');
    const emailEl = document.getElementById('reset-email');
    const closeBtn = document.getElementById('reset-close');
    const cancelBtn = document.getElementById('reset-cancel');
    const confirmBtn = document.getElementById('reset-confirm');
    if (!modal || !emailEl) return;
    emailEl.textContent = String(address||'');
    
    // 将参数保存到模态框的数据属性中，避免闭包变量污染
    modal.dataset.currentAddress = String(address||'');
    
    modal.style.display = 'flex';
    
    const close = () => { 
      modal.style.display = 'none';
      currentResetModalController = null;
      // 不在这里重置 operationFlags.resetting，避免与 finally 块冲突
    };
    
    const onClose = () => { 
      close();
      // 确保状态被重置
      operationFlags.resetting = false;
    };
    
    const onConfirm = async () => {
      if (operationFlags.resetting) return;
      
      try{
        operationFlags.resetting = true;
        confirmBtn.disabled = true;
        confirmBtn.textContent = '重置中...';
        
        // 从模态框的数据属性中获取参数，避免闭包变量被覆盖
        const currentAddress = modal.dataset.currentAddress;
        
        const r = await fetch('/api/mailboxes/reset-password?address=' + encodeURIComponent(currentAddress), { method:'POST' });
        if (!r.ok){ 
          const t = await r.text(); 
          showToast('重置失败：' + t, 'error'); 
          // 失败时也要关闭模态框
          close();
          return; 
        }
        showToast('已重置为默认密码', 'success');
        close();
        // 成功后重新加载列表
        await load();
      }catch(err){ 
        console.error('重置密码异常:', err);
        showToast('重置失败', 'error'); 
        // 异常时也要关闭模态框
        close();
      } finally {
        // 确保按钮状态和操作标志被重置
        confirmBtn.disabled = false;
        confirmBtn.textContent = '确定重置';
        operationFlags.resetting = false;
      }
    };
    
    // 使用 AbortController 管理事件监听器
    closeBtn && closeBtn.addEventListener('click', onClose, { signal });
    cancelBtn && cancelBtn.addEventListener('click', onClose, { signal });
    confirmBtn && confirmBtn.addEventListener('click', onConfirm, { signal });
    modal.addEventListener('click', (e) => { if (e.target === modal) onClose(); }, { signal });
    
  }catch(err){
    console.error('重置密码模态框初始化失败:', err);
    showToast('操作失败', 'error');
    // 确保状态被重置
    operationFlags.resetting = false;
  }
}

// 全局变量存储当前的监听器控制器
let currentLoginModalController = null;

// 切换邮箱登录权限（仅管理员可用）
window.toggleMailboxLogin = async function(address, canLogin){
  // 防止重复操作
  if (operationFlags.toggling) return;
  
  try{
    // 如果有之前的控制器，先取消
    if (currentLoginModalController) {
      currentLoginModalController.abort();
    }
    
    // 创建新的 AbortController
    currentLoginModalController = new AbortController();
    const signal = currentLoginModalController.signal;
    
    const action = canLogin ? '允许' : '禁止';
    const modal = document.getElementById('login-confirm-modal');
    const iconEl = document.getElementById('login-confirm-icon');
    const titleEl = document.getElementById('login-confirm-title');
    const messageEl = document.getElementById('login-confirm-message');
    const emailEl = document.getElementById('login-confirm-email');
    const closeBtn = document.getElementById('login-confirm-close');
    const cancelBtn = document.getElementById('login-confirm-cancel');
    const confirmBtn = document.getElementById('login-confirm-ok');
    
    if (!modal || !iconEl || !titleEl || !messageEl || !emailEl) return;
    
    // 设置确认框内容
    const icon = canLogin ? '🔓' : '🔒';
    iconEl.textContent = icon;
    
    // 添加对应的样式类
    iconEl.className = canLogin ? 'modal-icon unlock' : 'modal-icon lock';
    
    // 设置确认按钮样式
    confirmBtn.className = canLogin ? 'btn btn-primary' : 'btn btn-danger';
    confirmBtn.textContent = canLogin ? '允许登录' : '禁止登录';
    
    titleEl.textContent = `${action}邮箱登录`;
    messageEl.textContent = `确定要${action}该邮箱的登录权限吗？${canLogin ? '允许后该邮箱可以登录系统。' : '禁止后该邮箱将无法登录系统。'}`;
    emailEl.textContent = address;
    
    // 将参数保存到模态框的数据属性中，避免闭包变量污染
    modal.dataset.currentAddress = address;
    modal.dataset.currentCanLogin = String(canLogin);
    
    // 显示模态框
    modal.style.display = 'flex';
    
    const close = () => { 
      modal.style.display = 'none';
      currentLoginModalController = null;
      // 不在这里重置 operationFlags.toggling，避免与 finally 块冲突
    };
    
    const onClose = () => { 
      close();
      // 确保状态被重置
      operationFlags.toggling = false;
    };
    
    const onConfirm = async () => {
      if (operationFlags.toggling) return;
      
      try{
        operationFlags.toggling = true;
        confirmBtn.disabled = true;
        confirmBtn.textContent = `${action}中...`;
        
        // 从模态框的数据属性中获取参数，避免闭包变量被覆盖
        const currentAddress = modal.dataset.currentAddress;
        const currentCanLogin = modal.dataset.currentCanLogin === 'true';
        
        const requestData = { address: currentAddress, can_login: currentCanLogin };
        
        const r = await fetch('/api/mailboxes/toggle-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestData)
        });
        
        if (!r.ok){
          const t = await r.text();
          showToast(`${action}登录权限失败：` + t, 'error');
          // 失败时也要关闭模态框并重置状态
          close();
          return;
        }
        
        showToast(`已${action}邮箱登录权限`, 'success');
        close();
        // 成功后重新加载列表
        await load();
      }catch(err){
        console.error('授权操作异常:', err);
        showToast('操作失败', 'error');
        // 异常时也要关闭模态框
        close();
      } finally {
        // 确保按钮状态和操作标志被重置
        confirmBtn.disabled = false;
        confirmBtn.textContent = canLogin ? '允许登录' : '禁止登录';
        operationFlags.toggling = false;
      }
    };
    
    // 使用 AbortController 管理事件监听器
    closeBtn && closeBtn.addEventListener('click', onClose, { signal });
    cancelBtn && cancelBtn.addEventListener('click', onClose, { signal });
    confirmBtn && confirmBtn.addEventListener('click', onConfirm, { signal });
    modal.addEventListener('click', (e) => { if (e.target === modal) onClose(); }, { signal });
    
  }catch(err){
    console.error('模态框初始化失败:', err);
    showToast('操作失败', 'error');
    // 确保状态被重置
    operationFlags.toggling = false;
  }
}

// 全局变量存储修改密码模态框的监听器控制器
let currentChangePasswordModalController = null;

// 修改邮箱密码（仅管理员可用）
window.changeMailboxPassword = async function(address){
  // 防止重复操作
  if (operationFlags.changing) return;
  
  try{
    // 如果有之前的控制器，先取消
    if (currentChangePasswordModalController) {
      currentChangePasswordModalController.abort();
    }
    
    // 创建新的 AbortController
    currentChangePasswordModalController = new AbortController();
    const signal = currentChangePasswordModalController.signal;
    
    const modal = document.getElementById('change-password-modal');
    const emailEl = document.getElementById('change-password-email');
    const form = document.getElementById('change-password-form');
    const newPasswordEl = document.getElementById('new-password');
    const confirmPasswordEl = document.getElementById('confirm-password');
    const closeBtn = document.getElementById('change-password-close');
    const cancelBtn = document.getElementById('change-password-cancel');
    
    if (!modal || !emailEl || !form) return;
    
    // 设置邮箱地址
    emailEl.textContent = address;
    
    // 将参数保存到模态框的数据属性中，避免闭包变量污染
    modal.dataset.currentAddress = address;
    
    // 清空表单
    newPasswordEl.value = '';
    confirmPasswordEl.value = '';
    
    // 显示模态框
    modal.style.display = 'flex';
    
    const close = () => { 
      modal.style.display = 'none'; 
      form.reset();
      currentChangePasswordModalController = null;
      // 不在这里重置 operationFlags.changing，避免与 finally 块冲突
    };
    
    const onClose = () => { 
      close();
      // 确保状态被重置
      operationFlags.changing = false;
    };
    
    const onSubmit = async (e) => {
      e.preventDefault();
      
      if (operationFlags.changing) return;
      
      const newPassword = newPasswordEl.value.trim();
      const confirmPassword = confirmPasswordEl.value.trim();
      
      if (newPassword.length < 6) {
        showToast('密码长度至少6位', 'error');
        return;
      }
      
      if (newPassword !== confirmPassword) {
        showToast('两次输入的密码不一致', 'error');
        return;
      }
      
      try{
        operationFlags.changing = true;
        const submitBtn = document.getElementById('change-password-submit');
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = '修改中...';
        }
        
        // 从模态框的数据属性中获取参数，避免闭包变量被覆盖
        const currentAddress = modal.dataset.currentAddress;
        
        const r = await fetch('/api/mailboxes/change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            address: currentAddress, 
            new_password: newPassword 
          })
        });
        
        if (!r.ok){
          const t = await r.text();
          showToast('修改密码失败：' + t, 'error');
          // 失败时也要关闭模态框
          close();
          return;
        }
        
        showToast('密码修改成功', 'success');
        close();
        // 成功后重新加载列表
        await load();
      }catch(err){
        console.error('修改密码异常:', err);
        showToast('修改密码失败', 'error');
        // 异常时也要关闭模态框
        close();
      } finally {
        // 确保按钮状态和操作标志被重置
        const submitBtn = document.getElementById('change-password-submit');
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = '修改密码';
        }
        operationFlags.changing = false;
      }
    };
    
    // 使用 AbortController 管理事件监听器
    closeBtn && closeBtn.addEventListener('click', onClose, { signal });
    cancelBtn && cancelBtn.addEventListener('click', onClose, { signal });
    form && form.addEventListener('submit', onSubmit, { signal });
    modal.addEventListener('click', (e) => { if (e.target === modal) onClose(); }, { signal });
    
  }catch(err){
    console.error('修改密码模态框初始化失败:', err);
    showToast('操作失败', 'error');
    // 确保状态被重置
    operationFlags.changing = false;
  }
}

// 防止重复跳转的标记
let isNavigating = false;
let lastNavigateTime = 0;
let navigationTimer = null;

// 页面可见性变化时重置导航状态
document.addEventListener('visibilitychange', function() {
  if (!document.hidden) {
    isNavigating = false;
    if (navigationTimer) {
      clearTimeout(navigationTimer);
      navigationTimer = null;
    }
    // 清理可能残留的动画状态
    cleanupTransitionState();
  }
});

// 页面获得焦点时重置导航状态
window.addEventListener('focus', function() {
  isNavigating = false;
  if (navigationTimer) {
    clearTimeout(navigationTimer);
    navigationTimer = null;
  }
  // 清理可能残留的动画状态
  cleanupTransitionState();
});

// 页面加载时重置导航状态
window.addEventListener('pageshow', function() {
  isNavigating = false;
  if (navigationTimer) {
    clearTimeout(navigationTimer);
    navigationTimer = null;
  }
  // 清理可能残留的动画状态
  cleanupTransitionState();
});

// 页面失去焦点时重置导航状态（处理浏览器回退情况）
window.addEventListener('blur', function() {
  setTimeout(() => {
    isNavigating = false;
    if (navigationTimer) {
      clearTimeout(navigationTimer);
      navigationTimer = null;
    }
    // 清理可能残留的动画状态
    cleanupTransitionState();
  }, 100);
});

// 切换邮箱置顶状态（仅管理员可用）
window.toggleMailboxPin = async function(address, isPinned){
  // 防止重复操作
  if (operationFlags.pinning) return;
  
  try{
    operationFlags.pinning = true;
    const action = isPinned ? '置顶' : '取消置顶';
    
     const r = await fetch(`/api/mailboxes/pin?address=${encodeURIComponent(address)}`, {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' }
     });
    
    if (!r.ok){
      const t = await r.text();
      showToast(`${action}失败：` + t, 'error');
      return;
    }
    
    showToast(`已${action}邮箱`, 'success');
    load(); // 重新加载列表
  }catch(_){
    showToast('操作失败', 'error');
  } finally {
    setTimeout(() => { operationFlags.pinning = false; }, 500);
  }
}

// 全局变量存储分配用户模态框的监听器控制器
let currentAssignModalController = null;

// 二级页面状态管理
let assignSubpageState = {
  currentAddress: '',
  allUsers: [],
  filteredUsers: [],
  selectedUsers: new Set(),
  searchQuery: ''
};

// 显示分配用户二级页面
function showAssignSubpage(address) {
  const subpage = document.getElementById('assign-user-subpage');
  const emailEl = document.getElementById('assign-subpage-email');
  
  if (!subpage || !emailEl) {
    showToast('分配用户功能暂不可用', 'warn');
    return;
  }
  
  // 先强制重置所有状态，确保干净的起始状态
  assignSubpageState = {
    currentAddress: address,
    allUsers: [],
    filteredUsers: [],
    selectedUsers: new Set(),
    searchQuery: ''
  };
  
  // 设置邮箱地址
  emailEl.textContent = address;
  
  // 重置用户搜索输入框
  const searchInput = document.getElementById('user-search-input');
  if (searchInput) {
    searchInput.value = '';
  }
  
  // 重置已选用户显示区域
  const selectedSection = document.getElementById('selected-users-section');
  const confirmBtn = document.getElementById('assign-subpage-confirm');
  if (selectedSection) selectedSection.style.display = 'none';
  if (confirmBtn) confirmBtn.disabled = true;
  
  // 显示二级页面
  subpage.style.display = 'flex';
  document.body.style.overflow = 'hidden'; // 防止背景滚动
  
  // 加载用户列表
  loadUsersForAssign();
  
  // 绑定事件监听器
  bindAssignSubpageEvents();
}

// 隐藏分配用户二级页面
function hideAssignSubpage() {
  const subpage = document.getElementById('assign-user-subpage');
  if (subpage) {
    subpage.style.display = 'none';
    document.body.style.overflow = ''; // 恢复滚动
  }
  
  // 清理状态
  assignSubpageState = {
    currentAddress: '',
    allUsers: [],
    filteredUsers: [],
    selectedUsers: new Set(),
    searchQuery: ''
  };
  
  // 移除事件监听器
  unbindAssignSubpageEvents();
  operationFlags.assigning = false;
}

// 加载用户列表
async function loadUsersForAssign() {
  const usersLoading = document.getElementById('users-loading');
  const usersList = document.getElementById('users-list');
  const usersEmpty = document.getElementById('users-empty');
  
  try {
    // 显示加载状态
    usersLoading.style.display = 'flex';
    usersList.style.display = 'none';
    usersEmpty.style.display = 'none';
    
    // 确保选择状态是清空的
    assignSubpageState.selectedUsers.clear();
    
    const r = await fetch('/api/users');
    if (!r.ok) {
      throw new Error('加载用户列表失败');
    }
    
    const users = await r.json();
    assignSubpageState.allUsers = Array.isArray(users) ? users : [];
    assignSubpageState.filteredUsers = [...assignSubpageState.allUsers];
    
    // 隐藏加载状态
    usersLoading.style.display = 'none';
    
    if (assignSubpageState.allUsers.length > 0) {
      renderUsersList();
      usersList.style.display = 'block';
      // 确保已选用户显示区域是隐藏的
      updateSelectedUsersDisplay();
    } else {
      usersEmpty.style.display = 'block';
    }
    
  } catch(_) {
    usersLoading.style.display = 'none';
    usersEmpty.style.display = 'block';
    showToast('加载用户列表失败', 'error');
  }
}

// 渲染用户列表
function renderUsersList() {
  const usersList = document.getElementById('users-list');
  if (!usersList) return;
  
  usersList.innerHTML = assignSubpageState.filteredUsers.map(user => `
    <div class="user-item ${assignSubpageState.selectedUsers.has(user.username) ? 'selected' : ''}" 
         data-username="${user.username}">
      <input type="checkbox" class="user-checkbox" 
             ${assignSubpageState.selectedUsers.has(user.username) ? 'checked' : ''}>
      <div class="user-info">
        <div class="user-name">${user.username}</div>
        <div class="user-details">${user.display_name || '未设置显示名称'} - ${user.role || '普通用户'}</div>
      </div>
    </div>
  `).join('');
  
  // 为每个用户项绑定点击事件
  usersList.querySelectorAll('.user-item').forEach(item => {
    item.addEventListener('click', handleUserItemClick);
  });
}

// 处理用户项点击
function handleUserItemClick(e) {
  if (e.target.type === 'checkbox') return; // 直接点击复选框时不处理
  
  const username = e.currentTarget.dataset.username;
  if (!username) return;
  
  const checkbox = e.currentTarget.querySelector('.user-checkbox');
  checkbox.checked = !checkbox.checked;
  
  // 更新选择状态
  if (checkbox.checked) {
    assignSubpageState.selectedUsers.add(username);
    e.currentTarget.classList.add('selected');
  } else {
    assignSubpageState.selectedUsers.delete(username);
    e.currentTarget.classList.remove('selected');
  }
  
  updateSelectedUsersDisplay();
}

// 更新已选用户显示
function updateSelectedUsersDisplay() {
  const selectedSection = document.getElementById('selected-users-section');
  const selectedCount = document.getElementById('selected-count');
  const selectedList = document.getElementById('selected-users-list');
  const confirmBtn = document.getElementById('assign-subpage-confirm');
  
  const count = assignSubpageState.selectedUsers.size;
  
  if (count > 0) {
    selectedSection.style.display = 'block';
    selectedCount.textContent = count;
    confirmBtn.disabled = false;
    
    // 渲染已选用户标签
    const selectedUserTags = Array.from(assignSubpageState.selectedUsers).map(username => {
      const user = assignSubpageState.allUsers.find(u => u.username === username);
      return `
        <div class="selected-user-tag" data-username="${username}">
          <span>${username}</span>
          <button class="remove-btn" type="button" title="移除">✕</button>
        </div>
      `;
    }).join('');
    
    selectedList.innerHTML = selectedUserTags;
    
    // 为移除按钮绑定事件
    selectedList.querySelectorAll('.remove-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const username = e.target.closest('.selected-user-tag').dataset.username;
        removeSelectedUser(username);
      });
    });
  } else {
    selectedSection.style.display = 'none';
    confirmBtn.disabled = true;
  }
}

// 移除已选用户
function removeSelectedUser(username) {
  assignSubpageState.selectedUsers.delete(username);
  
  // 更新用户列表中的状态
  const userItem = document.querySelector(`.user-item[data-username="${username}"]`);
  if (userItem) {
    userItem.classList.remove('selected');
    const checkbox = userItem.querySelector('.user-checkbox');
    if (checkbox) checkbox.checked = false;
  }
  
  updateSelectedUsersDisplay();
}

// 搜索用户
function searchUsers(query) {
  assignSubpageState.searchQuery = query.toLowerCase();
  
  if (!assignSubpageState.searchQuery) {
    assignSubpageState.filteredUsers = [...assignSubpageState.allUsers];
  } else {
    assignSubpageState.filteredUsers = assignSubpageState.allUsers.filter(user => 
      user.username.toLowerCase().includes(assignSubpageState.searchQuery) ||
      (user.display_name && user.display_name.toLowerCase().includes(assignSubpageState.searchQuery))
    );
  }
  
  renderUsersList();
}

// 全选/清空用户
function selectAllUsers() {
  assignSubpageState.filteredUsers.forEach(user => {
    assignSubpageState.selectedUsers.add(user.username);
  });
  renderUsersList();
  updateSelectedUsersDisplay();
}

function clearAllUsers() {
  assignSubpageState.selectedUsers.clear();
  renderUsersList();
  updateSelectedUsersDisplay();
}

// 批量分配用户
async function performBatchAssign() {
  if (assignSubpageState.selectedUsers.size === 0) {
    showToast('请选择要分配的用户', 'warn');
    return;
  }
  
  try {
    operationFlags.assigning = true;
    const confirmBtn = document.getElementById('assign-subpage-confirm');
    const btnText = confirmBtn.querySelector('.btn-text');
    const btnLoading = confirmBtn.querySelector('.btn-loading');
    
    // 更新按钮状态
    confirmBtn.disabled = true;
    btnText.style.display = 'none';
    btnLoading.style.display = 'inline';
    
    const selectedUsernames = Array.from(assignSubpageState.selectedUsers);
    
    // 批量分配
    const promises = selectedUsernames.map(username => 
      fetch('/api/users/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          address: assignSubpageState.currentAddress, 
          username: username 
        })
      })
    );
    
    const results = await Promise.allSettled(promises);
    
    // 检查结果
    const failed = [];
    const succeeded = [];
    
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const username = selectedUsernames[i];
      
      if (result.status === 'fulfilled' && result.value.ok) {
        succeeded.push(username);
      } else {
        failed.push(username);
      }
    }
    
    // 显示结果
    if (succeeded.length > 0) {
      showToast(`成功分配给 ${succeeded.length} 个用户：${succeeded.join(', ')}`, 'success');
    }
    
    if (failed.length > 0) {
      showToast(`分配失败的用户：${failed.join(', ')}`, 'error');
    }
    
    if (succeeded.length > 0) {
      hideAssignSubpage();
      load(); // 重新加载列表
    }
    
  } catch(_) {
    showToast('批量分配失败', 'error');
  } finally {
    // 恢复按钮状态
    const confirmBtn = document.getElementById('assign-subpage-confirm');
    const btnText = confirmBtn.querySelector('.btn-text');
    const btnLoading = confirmBtn.querySelector('.btn-loading');
    
    confirmBtn.disabled = false;
    btnText.style.display = 'inline';
    btnLoading.style.display = 'none';
    operationFlags.assigning = false;
  }
}

// 绑定二级页面事件监听器
function bindAssignSubpageEvents() {
  const closeBtn = document.getElementById('assign-subpage-close');
  const cancelBtn = document.getElementById('assign-subpage-cancel');
  const confirmBtn = document.getElementById('assign-subpage-confirm');
  const selectAllBtn = document.getElementById('select-all-users');
  const clearAllBtn = document.getElementById('clear-all-users');
  const searchInput = document.getElementById('user-search-input');
  const overlay = document.querySelector('#assign-user-subpage .subpage-overlay');
  
  closeBtn && closeBtn.addEventListener('click', hideAssignSubpage);
  cancelBtn && cancelBtn.addEventListener('click', hideAssignSubpage);
  confirmBtn && confirmBtn.addEventListener('click', performBatchAssign);
  selectAllBtn && selectAllBtn.addEventListener('click', selectAllUsers);
  clearAllBtn && clearAllBtn.addEventListener('click', clearAllUsers);
  overlay && overlay.addEventListener('click', hideAssignSubpage);
  
  if (searchInput) {
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        searchUsers(e.target.value);
      }, 300);
    });
  }
}

// 移除二级页面事件监听器
function unbindAssignSubpageEvents() {
  // 由于每次都重新绑定，这里不需要具体移除
  // 实际的清理在hideAssignSubpage中通过重置状态完成
}

// 分配邮箱给用户（仅管理员可用）- 更新为显示二级页面
window.assignMailboxToUser = async function(address){
  // 防止重复操作
  if (operationFlags.assigning) return;
  
  try{
    operationFlags.assigning = true;
    showAssignSubpage(address);
  }catch(_){
    showToast('操作失败', 'error');
    operationFlags.assigning = false;
  }
}

/**
 * 选择邮箱并跳转到首页
 * @param {string} address - 邮箱地址
 * @param {Event} event - 点击事件
 */
window.selectAndGoToHomepage = function(address, event) {
  try {
    // 防止重复点击
    if (isNavigating) {
      return;
    }
    
    // 检查基本参数
    if (!address) {
      return;
    }
    
    // 检查时间间隔，防止极快的重复点击
    const now = Date.now();
    if (now - lastNavigateTime < 300) {
      return;
    }
    
    isNavigating = true;
    lastNavigateTime = now;
    
    // 保存选中的邮箱到 sessionStorage，使用与app.js一致的key格式（用户隔离）
    try {
      const userKey = getCurrentUserKey();
      if (userKey && userKey !== 'unknown') {
        sessionStorage.setItem(`mf:currentMailbox:${userKey}`, address);
      }
      // 兼容旧版本key，确保跨页面传递邮箱地址
      sessionStorage.setItem('mf:currentMailbox', address);
      // 添加跳转标记，让首页知道这是从邮箱总览页跳转过来的
      sessionStorage.setItem('mf:fromAdmin', '1');
    } catch(err) {
      console.warn('保存邮箱地址失败:', err);
    }
    
    // 显示短时间跳转提示，确保动画完整播放
    showJumpToast(`正在跳转到：${address}`);
    
    // 跨页面导航：等待toast播放完成后跳转（800ms + 50ms buffer = 850ms）
    navigationTimer = setTimeout(() => {
      navigationTimer = null;
      window.location.href = '/#inbox';
    }, 850);
    
    // 备用重置机制：3秒后强制重置状态，防止状态卡死
    setTimeout(() => {
      isNavigating = false;
      if (navigationTimer) {
        clearTimeout(navigationTimer);
        navigationTimer = null;
      }
      cleanupTransitionState();
    }, 3000);
    
  } catch(err) {
    console.error('跳转失败:', err);
    showToast('跳转失败', 'error');
    isNavigating = false;
    if (navigationTimer) {
      clearTimeout(navigationTimer);
      navigationTimer = null;
    }
  }
}

// =================== 批量登录权限管理 ===================

// 批量操作状态变量
let batchOperationInProgress = false;
let currentBatchAction = null; // 'allow' 或 'deny'

/**
 * 显示批量操作模态框
 * @param {string} action - 'allow' 或 'deny'
 */
function showBatchLoginModal(action) {
  if (batchOperationInProgress) return;
  
  currentBatchAction = action;
  const modal = document.getElementById('batch-login-modal');
  const icon = document.getElementById('batch-modal-icon');
  const title = document.getElementById('batch-modal-title');
  const message = document.getElementById('batch-modal-message');
  const textarea = document.getElementById('batch-emails-input');
  const confirmBtn = document.getElementById('batch-modal-confirm');
  const countInfo = document.getElementById('batch-count-info');
  
  if (!modal || !icon || !title || !message) return;
  
  // 设置标题和提示信息
  if (action === 'allow') {
    icon.textContent = '✅';
    icon.className = 'modal-icon unlock';
    title.textContent = '批量放行邮箱登录';
    message.textContent = '请输入需要放行登录的邮箱地址，每行一个。确认后这些邮箱将允许登录系统。';
    confirmBtn.className = 'btn btn-primary';
  } else {
    icon.textContent = '🚫';
    icon.className = 'modal-icon lock';
    title.textContent = '批量禁止邮箱登录';
    message.textContent = '请输入需要禁止登录的邮箱地址，每行一个。确认后这些邮箱将无法登录系统。';
    confirmBtn.className = 'btn btn-danger';
  }
  
  // 重置输入框
  textarea.value = '';
  confirmBtn.disabled = true;
  countInfo.textContent = '输入邮箱后将显示数量统计';
  
  // 显示模态框
  modal.style.display = 'flex';
}

/**
 * 关闭批量操作模态框
 */
function closeBatchLoginModal() {
  const modal = document.getElementById('batch-login-modal');
  const textarea = document.getElementById('batch-emails-input');
  
  if (modal) {
    modal.style.display = 'none';
  }
  if (textarea) {
    textarea.value = '';
  }
  
  currentBatchAction = null;
}

/**
 * 解析输入的邮箱地址列表
 * @param {string} text - 输入的文本
 * @returns {string[]} 邮箱地址数组
 */
function parseEmailList(text) {
  if (!text) return [];
  
  // 按行分割，去除空白，转小写，过滤无效邮箱
  const lines = text.split('\n')
    .map(line => line.trim().toLowerCase())
    .filter(line => line.length > 0);
  
  // 简单的邮箱格式验证
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const validEmails = lines.filter(email => emailRegex.test(email));
  
  // 去重
  return [...new Set(validEmails)];
}

/**
 * 更新邮箱数量统计信息
 */
function updateBatchCountInfo() {
  const textarea = document.getElementById('batch-emails-input');
  const countInfo = document.getElementById('batch-count-info');
  const confirmBtn = document.getElementById('batch-modal-confirm');
  
  if (!textarea || !countInfo || !confirmBtn) return;
  
  const emails = parseEmailList(textarea.value);
  const count = emails.length;
  
  if (count > 0) {
    countInfo.textContent = `已识别 ${count} 个有效邮箱地址`;
    countInfo.style.color = '#16a34a';
    confirmBtn.disabled = false;
  } else {
    countInfo.textContent = '输入邮箱后将显示数量统计';
    countInfo.style.color = '#64748b';
    confirmBtn.disabled = true;
  }
}

/**
 * 执行批量操作
 */
async function performBatchLoginOperation() {
  if (batchOperationInProgress) return;
  
  const textarea = document.getElementById('batch-emails-input');
  const confirmBtn = document.getElementById('batch-modal-confirm');
  const btnText = confirmBtn.querySelector('.batch-btn-text');
  const btnLoading = confirmBtn.querySelector('.batch-btn-loading');
  
  if (!textarea || !confirmBtn) return;
  
  const emails = parseEmailList(textarea.value);
  
  if (emails.length === 0) {
    showToast('请输入有效的邮箱地址', 'warn');
    return;
  }
  
  try {
    batchOperationInProgress = true;
    confirmBtn.disabled = true;
    if (btnText) btnText.style.display = 'none';
    if (btnLoading) btnLoading.style.display = 'inline';
    
    const canLogin = currentBatchAction === 'allow';
    const actionText = canLogin ? '放行' : '禁止';
    
    // 调用批量API
    const response = await fetch('/api/mailboxes/batch-toggle-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        addresses: emails, 
        can_login: canLogin 
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || '操作失败');
    }
    
    const result = await response.json();
    
    // 显示结果
    const successCount = result.success_count || 0;
    const failCount = result.fail_count || 0;
    const totalCount = emails.length;
    
    if (successCount > 0 && failCount === 0) {
      showToast(`成功${actionText} ${successCount} 个邮箱`, 'success');
    } else if (successCount > 0 && failCount > 0) {
      showToast(`成功${actionText} ${successCount} 个邮箱，失败 ${failCount} 个`, 'warn');
    } else {
      showToast(`${actionText}失败，请检查邮箱地址`, 'error');
    }
    
    // 关闭模态框并刷新列表
    closeBatchLoginModal();
    await load();
    
  } catch (error) {
    console.error('批量操作失败:', error);
    showToast('批量操作失败: ' + error.message, 'error');
  } finally {
    batchOperationInProgress = false;
    if (confirmBtn) {
      confirmBtn.disabled = false;
      if (btnText) btnText.style.display = 'inline';
      if (btnLoading) btnLoading.style.display = 'none';
    }
  }
}

// 绑定批量操作按钮事件
const batchAllowBtn = document.getElementById('batch-allow');
const batchDenyBtn = document.getElementById('batch-deny');

if (batchAllowBtn) {
  batchAllowBtn.addEventListener('click', () => showBatchLoginModal('allow'));
}

if (batchDenyBtn) {
  batchDenyBtn.addEventListener('click', () => showBatchLoginModal('deny'));
}

// 绑定批量模态框事件
const batchModalClose = document.getElementById('batch-modal-close');
const batchModalCancel = document.getElementById('batch-modal-cancel');
const batchModalConfirm = document.getElementById('batch-modal-confirm');
const batchEmailsInput = document.getElementById('batch-emails-input');
const batchModal = document.getElementById('batch-login-modal');

if (batchModalClose) {
  batchModalClose.addEventListener('click', closeBatchLoginModal);
}

if (batchModalCancel) {
  batchModalCancel.addEventListener('click', closeBatchLoginModal);
}

if (batchModalConfirm) {
  batchModalConfirm.addEventListener('click', performBatchLoginOperation);
}

if (batchEmailsInput) {
  batchEmailsInput.addEventListener('input', updateBatchCountInfo);
}

if (batchModal) {
  batchModal.addEventListener('click', (e) => {
    if (e.target === batchModal) {
      closeBatchLoginModal();
    }
  });
}


