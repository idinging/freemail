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
  viewList: document.getElementById('view-list')
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

async function api(path){
  const r = await fetch(path, { headers: { 'Cache-Control':'no-cache' } });
  if (r.status === 401){ location.replace('/html/login.html'); throw new Error('unauthorized'); }
  return r;
}

async function showToast(message, type = 'success', duration = 2000){
  try{
    const res = await fetch('/templates/toast.html', { cache: 'no-cache' });
    const tpl = await res.text();
    const html = tpl.replace('{{type}}', String(type||'info')).replace('{{message}}', String(message||''));
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    const styleEl = wrapper.querySelector('#toast-style');
    if (styleEl && !document.getElementById('toast-style')){ document.head.appendChild(styleEl); }
    const toastEl = wrapper.querySelector('.toast-item');
    if (toastEl){
      let container = document.getElementById('toast');
      if (!container){ container = document.createElement('div'); container.id = 'toast'; container.className = 'toast'; document.body.appendChild(container); }
      container.appendChild(toastEl);
      setTimeout(()=>{ toastEl.style.transition = 'opacity .3s ease'; toastEl.style.opacity = '0'; setTimeout(()=>toastEl.remove(), 300); }, duration);
    }
  }catch(_){ }
}

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
      <div class="line login" title="邮箱登录权限">登录：${x.can_login ? '<span style="color:#16a34a">✓允许</span>' : '<span style="color:#dc2626">✗禁止</span>'}</div>
      <div class="line time" title="${fmt(x.created_at)}">创建：${fmt(x.created_at)}</div>
      ${x.is_pinned ? '<div class="pin-badge" title="已置顶">📌</div>' : ''}
      <div class="actions">
        <button class="btn-icon" title="复制邮箱" onclick="event.stopPropagation(); copyMailboxAddressFromList('${x.address}')">📋</button>
        <button class="btn-icon" title="重置为默认密码" onclick="event.stopPropagation(); resetMailboxPassword('${x.address}')">🔁</button>
        <button class="btn-icon ${x.can_login ? 'active' : ''}" title="${x.can_login ? '禁止邮箱登录' : '允许邮箱登录'}" onclick="event.stopPropagation(); toggleMailboxLogin('${x.address}', ${x.can_login ? 'false' : 'true'})">${x.can_login ? '🔓' : '🔒'}</button>
        <button class="btn-icon" title="修改密码" onclick="event.stopPropagation(); changeMailboxPassword('${x.address}')">🔑</button>
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
          <span class="login" title="邮箱登录权限">登录：${x.can_login ? '<span style="color:#16a34a">✓允许</span>' : '<span style="color:#dc2626">✗禁止</span>'}</span>
          <span class="time" title="${fmt(x.created_at)}">创建：${fmt(x.created_at)}</span>
        </div>
      </div>
      <div class="list-actions">
        <button class="btn btn-ghost btn-sm" title="复制邮箱" onclick="event.stopPropagation(); copyMailboxAddressFromList('${x.address}')">📋</button>
        <button class="btn btn-ghost btn-sm" title="重置为默认密码" onclick="event.stopPropagation(); resetMailboxPassword('${x.address}')">🔁</button>
        <button class="btn btn-ghost btn-sm ${x.can_login ? 'active' : ''}" title="${x.can_login ? '禁止邮箱登录' : '允许邮箱登录'}" onclick="event.stopPropagation(); toggleMailboxLogin('${x.address}', ${x.can_login ? 'false' : 'true'})">${x.can_login ? '🔓' : '🔒'}</button>
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
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String((page-1)*PAGE_SIZE) });
    if (q) params.set('q', q);
    
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
    
    // 隐藏加载占位符
    els.loadingPlaceholder.classList.remove('show');
    
    // 移除加载隐藏类，让CSS类接管显示控制
    els.grid.classList.remove('loading-hidden');
    
    // 分页按钮状态由updatePagination()统一管理
  }
}

function updatePagination() {
  // 显示当前页码
  els.page.textContent = `第 ${page} 页`;
  
  // 判断是否显示上一页按钮
  const showPrev = page > 1;
  els.prev.style.display = showPrev ? 'inline-flex' : 'none';
  els.prev.disabled = !showPrev;
  
  // 判断是否显示下一页按钮（当返回数据等于PAGE_SIZE时表示可能还有更多数据）
  const showNext = lastCount === PAGE_SIZE;
  els.next.style.display = showNext ? 'inline-flex' : 'none';
  els.next.disabled = !showNext;
  
  // 如果两个按钮都不显示，显示统计信息；否则显示页码
  if (!showPrev && !showNext) {
    // 检查是否是搜索状态
    const searchQuery = (els.q.value || '').trim();
    if (searchQuery) {
      els.page.textContent = lastCount > 0 ? `找到 ${lastCount} 个邮箱` : '未找到匹配的邮箱';
    } else {
      els.page.textContent = lastCount > 0 ? `共 ${lastCount} 个邮箱` : '暂无邮箱';
    }
    els.page.style.textAlign = 'center';
  } else {
    els.page.style.textAlign = 'center';
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
  
  if (savedPage && !isNaN(Number(savedPage))) {
    page = Math.max(1, Number(savedPage));
  }
  
  if (savedQuery) {
    els.q.value = savedQuery;
  }
} catch(_) {}

// 操作防重复标记
let operationFlags = {
  copying: false,
  resetting: false,
  toggling: false,
  changing: false
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
    modal.style.display = 'flex';
    
    const close = () => { 
      modal.style.display = 'none';
      currentResetModalController = null;
      operationFlags.resetting = false;
    };
    
    const onClose = () => { close(); };
    
    const onConfirm = async () => {
      if (operationFlags.resetting) return;
      
      try{
        operationFlags.resetting = true;
        confirmBtn.disabled = true;
        confirmBtn.textContent = '重置中...';
        
        const r = await fetch('/api/mailboxes/reset-password?address=' + encodeURIComponent(address), { method:'POST' });
        if (!r.ok){ 
          const t = await r.text(); 
          showToast('重置失败：' + t, 'error'); 
          return; 
        }
        showToast('已重置为默认密码', 'success');
        close();
        load();
      }catch(_){ 
        showToast('重置失败', 'error'); 
      } finally {
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
    
  }catch(_){ }
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
    
    // 显示模态框
    modal.style.display = 'flex';
    
    const close = () => { 
      modal.style.display = 'none';
      currentLoginModalController = null;
      operationFlags.toggling = false;
    };
    
    const onClose = () => { 
      close(); 
    };
    
    const onConfirm = async () => {
      if (operationFlags.toggling) return;
      
      try{
        operationFlags.toggling = true;
        confirmBtn.disabled = true;
        confirmBtn.textContent = `${action}中...`;
        
        const r = await fetch('/api/mailboxes/toggle-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address, can_login: canLogin })
        });
        
        if (!r.ok){
          const t = await r.text();
          showToast(`${action}登录权限失败：` + t, 'error');
          return;
        }
        
        showToast(`已${action}邮箱登录权限`, 'success');
        close();
        load(); // 重新加载列表
      }catch(_){
        showToast('操作失败', 'error');
      } finally {
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
    
  }catch(_){
    showToast('操作失败', 'error');
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
    
    // 清空表单
    newPasswordEl.value = '';
    confirmPasswordEl.value = '';
    
    // 显示模态框
    modal.style.display = 'flex';
    
    const close = () => { 
      modal.style.display = 'none'; 
      form.reset();
      currentChangePasswordModalController = null;
      operationFlags.changing = false;
    };
    
    const onClose = () => { 
      close(); 
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
        
        const r = await fetch('/api/mailboxes/change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            address: address, 
            new_password: newPassword 
          })
        });
        
        if (!r.ok){
          const t = await r.text();
          showToast('修改密码失败：' + t, 'error');
          return;
        }
        
        showToast('密码修改成功', 'success');
        close();
        load(); // 重新加载列表
      }catch(_){
        showToast('修改密码失败', 'error');
      } finally {
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
    
  }catch(_){
    showToast('操作失败', 'error');
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
    
    // 保存选中的邮箱到 sessionStorage，首页会自动恢复
    try {
      sessionStorage.setItem('mf:currentMailbox', address);
    } catch(_) {}
    
    // 显示短时间跳转提示，确保动画完整播放
    showJumpToast(`正在跳转到：${address}`);
    
    // 跨页面导航：等待toast播放完成后跳转（800ms + 50ms buffer = 850ms）
    navigationTimer = setTimeout(() => {
      navigationTimer = null;
      window.location.href = '/#inbox';
    }, 850);
    
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


