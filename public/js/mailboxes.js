const els = {
  grid: document.getElementById('grid'),
  empty: document.getElementById('empty'),
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

async function showToast(message, type = 'success'){
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
      setTimeout(()=>{ toastEl.style.transition = 'opacity .3s ease'; toastEl.style.opacity = '0'; setTimeout(()=>toastEl.remove(), 300); }, 2000);
    }
  }catch(_){ }
}

function fmt(ts){
  if (!ts) return '';
  const d = new Date(String(ts).replace(' ','T') + 'Z');
  return new Intl.DateTimeFormat('zh-CN',{ timeZone:'Asia/Shanghai', hour12:false, year:'numeric', month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit' }).format(d);
}

function renderGrid(items){
  return items.map(x => `
    <div class="mailbox-card" onclick="selectAndGoToHomepage('${x.address}', event)">
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
    <div class="mailbox-list-item" onclick="selectAndGoToHomepage('${x.address}', event)">
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
  
  // 切换容器样式
  els.grid.className = currentView === 'grid' ? 'grid' : 'list';
  
  // 根据视图模式渲染
  if (currentView === 'grid') {
    els.grid.innerHTML = renderGrid(list);
  } else {
    els.grid.innerHTML = renderList(list);
  }
  
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
    els.search.disabled = true;
    els.search.textContent = '搜索中...';
    els.grid.classList.add('loading');
    els.prev.disabled = true;
    els.next.disabled = true;
  } else {
    els.search.disabled = false;
    els.search.innerHTML = '<span class="btn-icon">🔍</span><span>搜索</span>';
    els.grid.classList.remove('loading');
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
  currentView = view;
  localStorage.setItem('mf:mailboxes:view', view);
  
  // 更新按钮状态
  els.viewGrid.classList.toggle('active', view === 'grid');
  els.viewList.classList.toggle('active', view === 'list');
  
  // 重新渲染当前数据
  load();
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

// footer
(async function(){
  try{
    const res = await fetch('/templates/footer.html', { cache: 'no-cache' });
    const html = await res.text();
    const slot = document.getElementById('footer-slot');
    if (slot){ slot.outerHTML = html; setTimeout(()=>{ const y=document.getElementById('footer-year'); if (y) y.textContent=new Date().getFullYear(); },0); }
  }catch(_){ }
})();

load();

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

/**
 * 选择邮箱并跳转到首页
 * @param {string} address - 邮箱地址
 * @param {Event} event - 点击事件
 */
window.selectAndGoToHomepage = function(address, event) {
  try {
    // 防止重复点击
    if (isNavigating) return;
    
    // 检查是否点击的是按钮区域（有stopPropagation的话就不会到这里）
    if (event && event.target && event.target.closest('.actions')) {
      return; // 如果点击的是按钮区域，不处理
    }
    
    isNavigating = true;
    
    // 保存选中的邮箱到 sessionStorage，首页会自动恢复
    try {
      sessionStorage.setItem('mf:currentMailbox', address);
    } catch(_) {}
    
    // 显示简短提示并立即跳转
    showToast(`正在跳转到：${address}`, 'info');
    
    // 优化：减少延迟时间，提供更快的响应
    setTimeout(() => {
      // 跳转到首页的收件箱页面
      window.location.href = '/#inbox';
    }, 200);
    
  } catch(err) {
    console.error('跳转失败:', err);
    showToast('跳转失败', 'error');
    isNavigating = false;
  }
}


