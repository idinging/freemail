const els = {
  grid: document.getElementById('grid'),
  empty: document.getElementById('empty'),
  q: document.getElementById('q'),
  search: document.getElementById('search'),
  prev: document.getElementById('prev'),
  next: document.getElementById('next'),
  page: document.getElementById('page'),
  logout: document.getElementById('logout')
};

let page = 1;
const PAGE_SIZE = 20; // 固定每页20（4列×5行）
let lastCount = 0;

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

function render(items){
  const list = Array.isArray(items) ? items : [];
  els.grid.innerHTML = list.map(x => `
    <div class="mailbox-card">
      <div class="line addr" title="${x.address}">${x.address}</div>
      <div class="line pwd" title="${x.password_is_default ? '默认密码（邮箱本身）' : '自定义密码'}">密码：${x.password_is_default ? '默认' : '自定义'}</div>
      <div class="line login" title="邮箱登录权限">登录：${x.can_login ? '<span style="color:#16a34a">✓允许</span>' : '<span style="color:#dc2626">✗禁止</span>'}</div>
      <div class="line time" title="${fmt(x.created_at)}">创建：${fmt(x.created_at)}${x.is_pinned ? '<span class=\"badge\"> · 📌置顶</span>' : ''}</div>
      <div class="actions">
        <button class="btn-icon" title="复制邮箱" onclick="copyMailboxAddressFromList('${x.address}')">📋</button>
        <button class="btn-icon" title="重置为默认密码" onclick="resetMailboxPassword('${x.address}')">🔁</button>
        <button class="btn-icon ${x.can_login ? 'active' : ''}" title="${x.can_login ? '禁止邮箱登录' : '允许邮箱登录'}" onclick="toggleMailboxLogin('${x.address}', ${x.can_login ? 'false' : 'true'})">${x.can_login ? '🔓' : '🔒'}</button>
        <button class="btn-icon" title="修改密码" onclick="changeMailboxPassword('${x.address}')">🔑</button>
      </div>
    </div>
  `).join('');
  els.empty.style.display = list.length ? 'none' : 'flex';
}

async function load(){
  const q = (els.q.value || '').trim();
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String((page-1)*PAGE_SIZE) });
  if (q) params.set('q', q);
  const r = await api('/api/mailboxes?' + params.toString());
  const data = await r.json();
  render(data);
  lastCount = Array.isArray(data) ? data.length : 0;
  els.page.textContent = `${page}`;
  els.prev.disabled = page <= 1;
  els.next.disabled = lastCount < PAGE_SIZE;
}

els.search.onclick = () => { page = 1; load(); };
els.prev.onclick = () => { if (page>1){ page--; load(); } };
els.next.onclick = () => { if (lastCount===PAGE_SIZE){ page++; load(); } };
els.q.addEventListener('keydown', e => { if (e.key === 'Enter'){ page=1; load(); } });

els.logout && (els.logout.onclick = async () => { try{ fetch('/api/logout',{method:'POST'}); }catch(_){ } location.replace('/html/login.html?from=logout'); });

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

// 复制单个卡片中的邮箱地址
window.copyMailboxAddressFromList = async function(address){
  try{
    await navigator.clipboard.writeText(String(address||''));
    showToast('已复制邮箱地址：' + String(address||''), 'success');
  }catch(_){ showToast('复制失败', 'error'); }
}

// 重置邮箱密码为默认（仅管理员可用）
window.resetMailboxPassword = async function(address){
  try{
    const modal = document.getElementById('reset-modal');
    const emailEl = document.getElementById('reset-email');
    const closeBtn = document.getElementById('reset-close');
    const cancelBtn = document.getElementById('reset-cancel');
    const confirmBtn = document.getElementById('reset-confirm');
    if (!modal || !emailEl) return;
    emailEl.textContent = String(address||'');
    modal.style.display = 'flex';
    const close = () => { modal.style.display = 'none'; };
    const onClose = () => { closeBtn && closeBtn.removeEventListener('click', onClose); cancelBtn && cancelBtn.removeEventListener('click', onClose); confirmBtn && confirmBtn.removeEventListener('click', onConfirm); close(); };
    const onConfirm = async () => {
      try{
        const r = await fetch('/api/mailboxes/reset-password?address=' + encodeURIComponent(address), { method:'POST' });
        if (!r.ok){ const t = await r.text(); showToast('重置失败：' + t, 'error'); return; }
        showToast('已重置为默认密码', 'success');
        close();
        load();
      }catch(_){ showToast('重置失败', 'error'); }
    };
    closeBtn && closeBtn.addEventListener('click', onClose);
    cancelBtn && cancelBtn.addEventListener('click', onClose);
    confirmBtn && confirmBtn.addEventListener('click', onConfirm);
    modal.addEventListener('click', (e) => { if (e.target === modal) onClose(); });
  }catch(_){ }
}

// 切换邮箱登录权限（仅管理员可用）
window.toggleMailboxLogin = async function(address, canLogin){
  try{
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
    
    const close = () => { modal.style.display = 'none'; };
    const onClose = () => { 
      closeBtn && closeBtn.removeEventListener('click', onClose); 
      cancelBtn && cancelBtn.removeEventListener('click', onClose); 
      confirmBtn && confirmBtn.removeEventListener('click', onConfirm); 
      close(); 
    };
    
    const onConfirm = async () => {
      try{
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
      }
    };
    
    closeBtn && closeBtn.addEventListener('click', onClose);
    cancelBtn && cancelBtn.addEventListener('click', onClose);
    confirmBtn && confirmBtn.addEventListener('click', onConfirm);
    modal.addEventListener('click', (e) => { if (e.target === modal) onClose(); });
  }catch(_){
    showToast('操作失败', 'error');
  }
}

// 修改邮箱密码（仅管理员可用）
window.changeMailboxPassword = async function(address){
  try{
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
    };
    
    const onClose = () => { 
      closeBtn && closeBtn.removeEventListener('click', onClose); 
      cancelBtn && cancelBtn.removeEventListener('click', onClose); 
      form && form.removeEventListener('submit', onSubmit);
      close(); 
    };
    
    const onSubmit = async (e) => {
      e.preventDefault();
      
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
      }
    };
    
    closeBtn && closeBtn.addEventListener('click', onClose);
    cancelBtn && cancelBtn.addEventListener('click', onClose);
    form && form.addEventListener('submit', onSubmit);
    modal.addEventListener('click', (e) => { if (e.target === modal) onClose(); });
  }catch(_){
    showToast('操作失败', 'error');
  }
}


