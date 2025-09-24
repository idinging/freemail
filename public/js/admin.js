const els = {
  back: document.getElementById('back'),
  logout: document.getElementById('logout'),
  demoBanner: document.getElementById('demo-banner'),
  usersTbody: document.getElementById('users-tbody'),
  usersRefresh: document.getElementById('users-refresh'),
  usersLoading: document.getElementById('users-loading'),
  toast: document.getElementById('toast'),
  // modals
  uOpen: document.getElementById('u-open'),
  uModal: document.getElementById('u-modal'),
  uClose: document.getElementById('u-close'),
  uCancel: document.getElementById('u-cancel'),
  uCreate: document.getElementById('u-create'),
  uName: document.getElementById('u-name'),
  uPass: document.getElementById('u-pass'),
  uRole: document.getElementById('u-role'),

  aOpen: document.getElementById('a-open'),
  aModal: document.getElementById('a-modal'),
  aClose: document.getElementById('a-close'),
  aCancel: document.getElementById('a-cancel'),
  aAssign: document.getElementById('a-assign'),
  aName: document.getElementById('a-name'),
  aMail: document.getElementById('a-mail'),

  userMailboxes: document.getElementById('user-mailboxes'),
  userMailboxesLoading: document.getElementById('user-mailboxes-loading'),
  // edit modal
  editModal: document.getElementById('edit-modal'),
  editClose: document.getElementById('edit-close'),
  editCancel: document.getElementById('edit-cancel'),
  editSave: document.getElementById('edit-save'),
  editRefresh: document.getElementById('edit-refresh'),
  editName: document.getElementById('edit-name'),
  editUserDisplay: document.getElementById('edit-user-display'),
  editNewName: document.getElementById('edit-new-name'),
  editRoleCheck: document.getElementById('edit-role-check'),
  editLimit: document.getElementById('edit-limit'),
  editSendCheck: document.getElementById('edit-send-check'),
  editPass: document.getElementById('edit-pass'),
  editDelete: document.getElementById('edit-delete'),
  adminConfirmModal: document.getElementById('admin-confirm-modal'),
  adminConfirmClose: document.getElementById('admin-confirm-close'),
  adminConfirmCancel: document.getElementById('admin-confirm-cancel'),
  adminConfirmOk: document.getElementById('admin-confirm-ok'),
  adminConfirmMessage: document.getElementById('admin-confirm-message')
};

function formatTs(ts){
  if (!ts) return '';
  try{
    const iso = ts.includes('T') ? ts.replace(' ', 'T') : ts.replace(' ', 'T');
    const d = new Date(iso + 'Z');
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour12: false,
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).format(d);
  }catch(_){ return ts; }
}

async function showToast(message, type='info'){
  try{
    const res = await fetch('/templates/toast.html', { cache: 'no-cache' });
    const tpl = await res.text();
    const html = tpl.replace('{{type}}', String(type||'info')).replace('{{message}}', String(message||''));
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    const styleEl = wrapper.querySelector('#toast-style');
    if (styleEl && !document.getElementById('toast-style')){
      document.head.appendChild(styleEl);
    }
    const toastEl = wrapper.querySelector('.toast-item');
    if (toastEl){
      els.toast.appendChild(toastEl);
      setTimeout(()=>{ 
        toastEl.style.transition='opacity .3s'; 
        toastEl.style.opacity='0'; 
        setTimeout(()=>toastEl.remove(),300); 
      }, 1600);
    }
  }catch(_){
    const div = document.createElement('div');
    div.className = `toast-item ${type}`;
    div.textContent = message;
    els.toast.appendChild(div);
    setTimeout(()=>{ div.style.transition='opacity .3s'; div.style.opacity='0'; setTimeout(()=>div.remove(), 300); }, 1600);
  }
}

// 公用复制
window.copyText = async (text) => {
  try{ await navigator.clipboard.writeText(String(text||'')); showToast('已复制到剪贴板','success'); }
  catch(_){ showToast('复制失败','warn'); }
}

function openAdminConfirm(message, onOk){
  try{
    els.adminConfirmMessage.textContent = message || '确认执行该操作？';
    els.adminConfirmModal.classList.add('show');
    const closeIt = () => els.adminConfirmModal.classList.remove('show');
    els.adminConfirmCancel.onclick = closeIt;
    els.adminConfirmClose.onclick = closeIt;
    els.adminConfirmOk.onclick = async () => { 
      try{ 
        setButtonLoading(els.adminConfirmOk, '处理中…');
        await onOk?.(); 
      } finally { 
        try{ restoreButton(els.adminConfirmOk); }catch(_){ }
        closeIt(); 
      } 
    };
  }catch(_){ if (confirm(message||'确认执行该操作？')) onOk?.(); }
}

async function api(path, options){
  const r = await fetch(path, options);
  if (r.status === 401){ location.replace('/html/login.html'); throw new Error('unauthorized'); }
  return r;
}

function openModal(m){ m?.classList?.add('show'); }
function closeModal(m){ m?.classList?.remove('show'); }

async function loadUsers(){
  try{
    if (els.usersLoading){ els.usersLoading.style.display = 'inline-flex'; }
    const r = await api('/api/users');
    const users = await r.json();
    els.usersTbody.innerHTML = (users||[]).map(u => `
      <tr>
        <td>${u.id}</td>
        <td>${u.username}</td>
        <td>${u.role === 'admin' ? '高级用户' : '普通用户'}</td>
        <td>${u.mailbox_count || 0} / <span class="badge">${u.mailbox_limit}</span></td>
        <td>${u.can_send ? '是' : '否'}</td>
        <td>${formatTs(u.created_at)}</td>
        <td>
          <div class="user-actions">
            <button class="btn btn-ghost btn-sm" onclick="viewUserMailboxes(this, ${u.id}, '${u.username}')">邮箱</button>
            <button class="btn btn-secondary btn-sm" onclick="openEdit(${u.id}, '${u.username}', '${u.role}', ${u.mailbox_limit}, ${u.can_send?1:0})">编辑</button>
          </div>
        </td>
      </tr>
    `).join('');
  }catch(e){ els.usersTbody.innerHTML = '<tr><td colspan="7" style="color:#dc2626">加载失败</td></tr>'; }
  finally { if (els.usersLoading){ els.usersLoading.style.display = 'none'; } }
}

window.viewUserMailboxes = async (a, b, c) => {
  try{
    let btn = null, userId = a, username = b;
    if (a && typeof a === 'object' && a.tagName){ btn = a; userId = b; username = c; }
    if (btn) setButtonLoading(btn, '加载中…');
    if (els.userMailboxesLoading){ els.userMailboxesLoading.style.display = 'inline-flex'; }
    const r = await api(`/api/users/${userId}/mailboxes`);
    const list = await r.json();
    els.userMailboxes.innerHTML = `<div style="margin-bottom:8px">用户 <strong>${username}</strong> 的邮箱：</div>` +
      `<div class="user-mailboxes">` +
      (list||[]).map(x => `
        <div class="user-mailbox-item">
          <div class="mailbox-tooltip">
            <span>${x.address}</span>
            <button class="btn btn-ghost btn-sm" onclick="copyText('${x.address}')">复制</button>
          </div>
          <span class="addr" title="${x.address}">${x.address}</span>
          <span class="time">${formatTs(x.created_at)}</span>
        </div>
      `).join('') + `</div>`;
  }catch(_){ showToast('加载用户邮箱失败','warn'); }
  finally { 
    if (els.userMailboxesLoading){ els.userMailboxesLoading.style.display = 'none'; }
    if (btn) restoreButton(btn);
  }
}

window.promptSetLimit = async (userId, current) => {
  const v = prompt('设置邮箱上限（整数）：', String(current || 10));
  if (v === null) return;
  const n = Math.max(0, parseInt(v, 10) || 0);
  try{
    const r = await api(`/api/users/${userId}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ mailboxLimit: n }) });
    if (!r.ok){ const t = await r.text(); throw new Error(t); }
    showToast('已更新上限','success');
    loadUsers();
  }catch(e){ showToast('更新失败：' + (e?.message||e), 'warn'); }
}

window.deleteUser = async (userId) => {
  try{
    const r = await api(`/api/users/${userId}`, { method:'DELETE' });
    if (!r.ok){ const t = await r.text(); throw new Error(t); }
    showToast('已删除用户','success');
    els.userMailboxes.innerHTML = '';
    loadUsers();
  }catch(e){ showToast('删除失败：' + (e?.message||e), 'warn'); }
}

// 切换发件权限
window.toggleSend = async (userId, current) => {
  const next = current ? 0 : 1;
  try{
    const r = await api(`/api/users/${userId}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ can_send: next }) });
    if (!r.ok){ const t = await r.text(); throw new Error(t); }
    showToast(next ? '已允许该用户发件' : '已禁止该用户发件', 'success');
    loadUsers();
  }catch(e){ showToast('操作失败：' + (e?.message||e), 'warn'); }
}

// 创建用户
function resetCreateForm(){ els.uName.value=''; els.uPass.value=''; els.uRole.value='user'; }
els.uOpen.onclick = () => { resetCreateForm(); openModal(els.uModal); };
els.uClose.onclick = () => closeModal(els.uModal);
els.uCancel.onclick = () => closeModal(els.uModal);
els.uCreate.onclick = async () => {
  const username = els.uName.value.trim();
  const password = els.uPass.value.trim();
  const role = els.uRole.value;
  if (!username){ showToast('请输入用户名','warn'); return; }
  try{
    setButtonLoading(els.uCreate, '创建中…');
    const r = await api('/api/users', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ username, password, role }) });
    if (!r.ok){ const t = await r.text(); throw new Error(t); }
    showToast('创建成功','success');
    closeModal(els.uModal);
    loadUsers();
  }catch(e){ showToast('创建失败：' + (e?.message||e), 'warn'); }
  finally { restoreButton(els.uCreate); }
}

// 分配邮箱
els.aOpen.onclick = () => openModal(els.aModal);
els.aClose.onclick = () => closeModal(els.aModal);
els.aCancel.onclick = () => closeModal(els.aModal);
els.aAssign.onclick = async () => {
  const username = els.aName.value.trim();
  const addresses = els.aMail.value.trim().split('\n').map(addr => addr.trim()).filter(addr => addr);
  
  if (!username || addresses.length === 0){
    showToast('请输入用户名和至少一个邮箱地址','warn'); 
    return; 
  }
  
  // 验证邮箱格式
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const invalidEmails = addresses.filter(addr => !emailRegex.test(addr));
  if (invalidEmails.length > 0) {
    showToast(`邮箱格式错误：${invalidEmails.join(', ')}`,'warn');
    return;
  }
  
  try{
    setButtonLoading(els.aAssign, '正在分配…');
    let successCount = 0;
    let failCount = 0;
    
    for (const address of addresses) {
      try {
        const r = await api('/api/users/assign', { 
          method:'POST', 
          headers:{'Content-Type':'application/json'}, 
          body: JSON.stringify({ username, address: address.toLowerCase() }) 
        });
        if (r.ok) {
          successCount++;
        } else {
          const txt = await r.text();
          console.error(`分配邮箱 ${address} 失败:`, txt);
          failCount++;
        }
      } catch (e) {
        console.error(`分配邮箱 ${address} 异常:`, e);
        failCount++;
      }
    }
    
    if (successCount > 0) {
      showToast(`成功分配 ${successCount} 个邮箱${failCount > 0 ? `，${failCount} 个失败` : ''}`,'success');
      closeModal(els.aModal);
      loadUsers();
    } else {
      showToast('所有邮箱分配失败','warn');
    }
  }catch(e){ 
    showToast('分配失败：' + (e?.message||e), 'warn'); 
  }
  finally { restoreButton(els.aAssign); }
}

// 统一按钮加载态（与 app.js 一致的极简实现）
function setButtonLoading(button, text){
  if (!button) return;
  if (button.dataset.loading === '1') return;
  button.dataset.loading = '1';
  button.dataset.originalHtml = button.innerHTML;
  button.disabled = true;
  const txt = text || '处理中…';
  button.innerHTML = `<div class="spinner"></div><span style="margin-left:8px">${txt}</span>`;
}
function restoreButton(button){
  if (!button) return;
  const html = button.dataset.originalHtml;
  if (html){ button.innerHTML = html; }
  button.disabled = false;
  delete button.dataset.loading;
  delete button.dataset.originalHtml;
}

// 导航
els.back.onclick = () => { 
  // 使用 location.href 而不是 replace，确保创建历史记录条目以支持前进后退
  location.href = '/templates/loading.html?redirect=%2F&status=' + encodeURIComponent('正在返回首页…'); 
};
els.logout.onclick = async () => { 
  try{ fetch('/api/logout', { method:'POST', keepalive: true }); }catch{}
  try{ sessionStorage.setItem('mf:just_logged_out', '1'); }catch(_){ }
  location.replace('/html/login.html?from=logout');
};

// 加载
els.usersRefresh.onclick = async () => { if (els.usersLoading){ els.usersLoading.style.display = 'inline-flex'; } await loadUsers(); };
loadUsers();

// ===== 二级页面：编辑用户 =====
window.openEdit = (id, name, role, limit, canSend) => {
  els.editModal.classList.add('show');
  if (els.editName) els.editName.value = name;
  if (els.editUserDisplay){ els.editUserDisplay.textContent = name; }
  els.editRoleCheck.checked = (String(role) === 'admin');
  els.editLimit.value = Number(limit||0);
  els.editSendCheck.checked = !!canSend;
  els.editNewName.value = '';
  els.editPass.value = '';
  els.editSave.onclick = async () => {
    try{
      setButtonLoading(els.editSave, '保存中…');
      const body = { mailboxLimit: Number(els.editLimit.value||0), can_send: els.editSendCheck.checked ? 1 : 0, role: els.editRoleCheck.checked ? 'admin' : 'user' };
      const newName = (els.editNewName.value||'').trim();
      const newPass = (els.editPass.value||'').trim();
      if (newName) body.username = newName;
      if (newPass) body.password = newPass;
      const r = await api(`/api/users/${id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
      if (!r.ok){ const t = await r.text(); throw new Error(t); }
      showToast('已保存','success');
      els.editModal.classList.remove('show');
      loadUsers();
    }catch(e){ showToast('保存失败：' + (e?.message||e), 'warn'); }
    finally { restoreButton(els.editSave); }
  };
  els.editDelete.onclick = () => openAdminConfirm('确定删除该用户及其关联邮箱绑定（不会删除邮箱实体与邮件）？', async () => { await deleteUser(id); });
};
els.editClose.onclick = () => els.editModal.classList.remove('show');
els.editCancel.onclick = () => els.editModal.classList.remove('show');

// 点击遮罩关闭所有模态（不保存）
document.addEventListener('mousedown', (e) => {
  const opened = document.querySelectorAll('.modal.show');
  opened.forEach(m => {
    const card = m.querySelector('.modal-card');
    if (card && !card.contains(e.target)){
      m.classList.remove('show');
    }
  });
});

// 会话检查：访客进入演示管理页时展示提示条
(async () => {
  try{
    const r = await fetch('/api/session');
    if (!r.ok) return;
    const s = await r.json();
    if (s && s.role === 'guest' && els.demoBanner){ els.demoBanner.style.display = 'block'; }
  }catch(_){ }
})();


