/**
 * 管理员页面
 * @module admin
 */

import { api, getUsers, createUser, updateUser, deleteUser, getUserMailboxes, assignMailbox, unassignMailbox } from './modules/admin/api.js';
import { formatTime, renderUserRow, renderUserList, generateSkeletonRows, renderPagination } from './modules/admin/user-list.js';
import { fillEditForm, collectEditFormData, validateEditForm, resetEditState } from './modules/admin/user-edit.js';

// showToast 由 toast-utils.js 全局提供
const showToast = window.showToast || ((msg, type) => console.log(`[${type}] ${msg}`));

// 分页状态
let currentPage = 1, pageSize = 20, totalUsers = 0;
let currentViewingUser = null;
let mailboxPage = 1, mailboxPageSize = 20, totalMailboxes = 0;

// DOM 元素
const els = {
  back: document.getElementById('back'),
  logout: document.getElementById('logout'),
  demoBanner: document.getElementById('demo-banner'),
  usersTbody: document.getElementById('users-tbody'),
  usersRefresh: document.getElementById('users-refresh'),
  usersLoading: document.getElementById('users-loading'),
  usersCount: document.getElementById('users-count'),
  usersPagination: document.getElementById('users-pagination'),
  pageInfo: document.getElementById('page-info'),
  prevPage: document.getElementById('prev-page'),
  nextPage: document.getElementById('next-page'),
  
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
  
  // 取消分配模态框
  unassignOpen: document.getElementById('unassign-open'),
  unassignModal: document.getElementById('unassign-modal'),
  unassignClose: document.getElementById('unassign-close'),
  unassignCancel: document.getElementById('unassign-cancel'),
  unassignSubmit: document.getElementById('unassign-submit'),
  unassignName: document.getElementById('unassign-name'),
  unassignMail: document.getElementById('unassign-mail'),
  
  editModal: document.getElementById('edit-modal'),
  editClose: document.getElementById('edit-close'),
  editCancel: document.getElementById('edit-cancel'),
  editSave: document.getElementById('edit-save'),
  editName: document.getElementById('edit-name'),
  editUserDisplay: document.getElementById('edit-user-display'),
  editNewName: document.getElementById('edit-new-name'),
  editRoleCheck: document.getElementById('edit-role-check'),
  editLimit: document.getElementById('edit-limit'),
  editSendCheck: document.getElementById('edit-send-check'),
  editPass: document.getElementById('edit-pass'),
  editDelete: document.getElementById('edit-delete'),
  
  userMailboxes: document.getElementById('user-mailboxes'),
  userMailboxesLoading: document.getElementById('user-mailboxes-loading'),
  mailboxesCount: document.getElementById('mailboxes-count'),
  mailboxesPagination: document.getElementById('mailboxes-pagination'),
  mailboxesPageInfo: document.getElementById('mailboxes-page-info'),
  mailboxesPrevPage: document.getElementById('mailboxes-prev-page'),
  mailboxesNextPage: document.getElementById('mailboxes-next-page'),
  
  // 确认模态框
  confirmModal: document.getElementById('admin-confirm-modal'),
  confirmMessage: document.getElementById('admin-confirm-message'),
  confirmClose: document.getElementById('admin-confirm-close'),
  confirmCancel: document.getElementById('admin-confirm-cancel'),
  confirmOk: document.getElementById('admin-confirm-ok')
};

// 自定义确认对话框
let confirmResolver = null;
function showConfirm(message) {
  return new Promise(resolve => {
    confirmResolver = resolve;
    if (els.confirmMessage) els.confirmMessage.textContent = message;
    els.confirmModal?.classList.add('show');
  });
}

function initConfirmEvents() {
  if (els._confirmInitialized) return;
  els._confirmInitialized = true;
  
  const closeConfirm = (result) => {
    els.confirmModal?.classList.remove('show');
    if (confirmResolver) {
      confirmResolver(result);
      confirmResolver = null;
    }
  };
  
  els.confirmOk?.addEventListener('click', () => closeConfirm(true));
  els.confirmCancel?.addEventListener('click', () => closeConfirm(false));
  els.confirmClose?.addEventListener('click', () => closeConfirm(false));
  els.confirmModal?.addEventListener('click', (e) => {
    if (e.target === els.confirmModal) closeConfirm(false);
  });
}
initConfirmEvents();

// 加载用户列表
async function loadUsers() {
  if (els.usersLoading) els.usersLoading.style.display = 'flex';
  if (els.usersTbody) els.usersTbody.innerHTML = generateSkeletonRows(5);
  
  try {
    const data = await getUsers({ page: currentPage, size: pageSize });
    const users = Array.isArray(data) ? data : (data.list || []);
    totalUsers = data.total || users.length;
    
    renderUserList(users, els.usersTbody);
    updatePagination();
    if (els.usersCount) els.usersCount.textContent = totalUsers;
    
    bindUserEvents();
  } catch (e) {
    console.error('加载用户失败:', e);
    showToast('加载失败', 'error');
  } finally {
    if (els.usersLoading) els.usersLoading.style.display = 'none';
  }
}

// 更新分页
function updatePagination() {
  const totalPages = Math.max(1, Math.ceil(totalUsers / pageSize));
  if (els.pageInfo) els.pageInfo.textContent = `第 ${currentPage} / ${totalPages} 页`;
  if (els.prevPage) els.prevPage.disabled = currentPage <= 1;
  if (els.nextPage) els.nextPage.disabled = currentPage >= totalPages;
}

// 绑定用户操作事件
function bindUserEvents() {
  // 点击整行加载邮箱列表
  els.usersTbody?.querySelectorAll('.user-row.clickable').forEach(row => {
    row.onclick = async (e) => {
      // 如果点击的是按钮，不触发行点击
      if (e.target.closest('[data-action]')) return;
      
      const userId = row.dataset.userId;
      if (userId) {
        // 移除其他行的选中状态
        els.usersTbody.querySelectorAll('.user-row').forEach(r => r.classList.remove('active'));
        row.classList.add('active');
        await openMailboxesPanel(userId);
      }
    };
  });
  
  // 编辑按钮事件
  els.usersTbody?.querySelectorAll('[data-action="edit"]').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const userId = btn.dataset.userId;
      await openEditModal(userId);
    };
  });
}

// 打开编辑模态框
async function openEditModal(userId) {
  try {
    const data = await getUsers({ page: 1, size: 100 });
    const users = Array.isArray(data) ? data : (data.list || []);
    const user = users.find(u => u.id == userId);
    if (!user) { showToast('用户不存在', 'error'); return; }
    
    currentViewingUser = user;
    fillEditForm(els, user);
    els.editModal?.classList.add('show');
  } catch(e) {
    showToast('加载用户信息失败', 'error');
  }
}

// 保存用户编辑
async function saveEdit() {
  if (!currentViewingUser) return;
  
  const formData = collectEditFormData(els);
  const validation = validateEditForm(formData, false);
  if (!validation.valid) {
    showToast(validation.error, 'error');
    return;
  }
  
  try {
    await updateUser(currentViewingUser.id, formData);
    showToast('保存成功', 'success');
    els.editModal?.classList.remove('show');
    loadUsers();
  } catch(e) {
    showToast('保存失败', 'error');
  }
}

// 打开邮箱面板
async function openMailboxesPanel(userId) {
  try {
    const data = await getUsers({ page: 1, size: 100 });
    const users = Array.isArray(data) ? data : (data.list || []);
    const user = users.find(u => u.id == userId);
    if (!user) { showToast('用户不存在', 'error'); return; }
    
    currentViewingUser = user;
    mailboxPage = 1;
    await loadUserMailboxes();
    
    // 显示邮箱面板
    if (els.userMailboxes) els.userMailboxes.style.display = 'block';
    if (els.aName) els.aName.value = user.username;
  } catch(e) {
    showToast('加载失败', 'error');
  }
}

// 加载用户邮箱
async function loadUserMailboxes() {
  if (!currentViewingUser) return;
  if (els.userMailboxesLoading) els.userMailboxesLoading.style.display = 'flex';
  
  try {
    const data = await getUserMailboxes(currentViewingUser.id, { page: mailboxPage, size: mailboxPageSize });
    const list = Array.isArray(data) ? data : (data.list || []);
    totalMailboxes = data.total || list.length;
    
    if (els.mailboxesCount) els.mailboxesCount.textContent = totalMailboxes;
    
    // 渲染邮箱列表
    const container = els.userMailboxes?.querySelector('.mailbox-list');
    if (container) {
      container.innerHTML = list.length ? list.map(m => `
        <div class="mailbox-item clickable" data-address="${m.address}" data-href="/?mailbox=${encodeURIComponent(m.address)}">
          <span class="address">${m.address}</span>
          <button class="btn btn-sm danger" data-action="unassign">取消分配</button>
        </div>
      `).join('') : '<div class="empty">暂无邮箱</div>';
      
      // 绑定整行点击事件
      container.querySelectorAll('.mailbox-item.clickable').forEach(item => {
        item.onclick = (e) => {
          // 如果点击的是按钮，不跳转
          if (e.target.closest('[data-action]')) return;
          const href = item.dataset.href;
          if (href) location.href = href;
        };
      });
      
      // 绑定取消分配事件
      container.querySelectorAll('[data-action="unassign"]').forEach(btn => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          const address = btn.closest('[data-address]')?.dataset.address;
          if (!address) return;
          
          const confirmed = await showConfirm(`确定取消分配邮箱 ${address}？`);
          if (!confirmed) return;
          
          try {
            await unassignMailbox(currentViewingUser.username, address);
            showToast('已取消分配', 'success');
            loadUserMailboxes();
          } catch(e) { showToast('取消分配失败', 'error'); }
        };
      });
    }
    
    // 更新分页
    const totalPages = Math.max(1, Math.ceil(totalMailboxes / mailboxPageSize));
    if (els.mailboxesPageInfo) els.mailboxesPageInfo.textContent = `${mailboxPage} / ${totalPages}`;
    if (els.mailboxesPrevPage) els.mailboxesPrevPage.disabled = mailboxPage <= 1;
    if (els.mailboxesNextPage) els.mailboxesNextPage.disabled = mailboxPage >= totalPages;
  } catch(e) {
    showToast('加载邮箱失败', 'error');
  } finally {
    if (els.userMailboxesLoading) els.userMailboxesLoading.style.display = 'none';
  }
}

// 创建用户
async function handleCreateUser() {
  const username = els.uName?.value.trim();
  const password = els.uPass?.value.trim();
  const role = els.uRole?.value || 'user';
  
  if (!username || !password) {
    showToast('用户名和密码不能为空', 'error');
    return;
  }
  
  try {
    await createUser({ username, password, role });
    showToast('用户创建成功', 'success');
    els.uModal?.classList.remove('show');
    els.uName.value = '';
    els.uPass.value = '';
    loadUsers();
  } catch(e) {
    showToast('创建失败', 'error');
  }
}

// 分配邮箱
async function handleAssignMailbox() {
  const username = els.aName?.value.trim();
  const addressText = els.aMail?.value.trim();
  
  if (!username) {
    showToast('请输入用户名', 'error');
    return;
  }
  
  if (!addressText) {
    showToast('请输入邮箱地址', 'error');
    return;
  }
  
  // 支持批量分配（每行一个地址）
  const addresses = addressText.split('\n').map(a => a.trim()).filter(a => a);
  if (addresses.length === 0) {
    showToast('请输入有效的邮箱地址', 'error');
    return;
  }
  
  try {
    let successCount = 0;
    let failCount = 0;
    for (const address of addresses) {
      try {
        await assignMailbox(username, address);
        successCount++;
      } catch(e) {
        failCount++;
      }
    }
    
    if (successCount > 0 && failCount === 0) {
      showToast(`成功分配 ${successCount} 个邮箱`, 'success');
    } else if (successCount > 0 && failCount > 0) {
      showToast(`成功 ${successCount} 个，失败 ${failCount} 个`, 'warning');
    } else {
      showToast('分配失败', 'error');
    }
    
    els.aModal?.classList.remove('show');
    els.aMail.value = '';
    els.aName.value = '';
    
    // 如果当前有查看的用户且用户名匹配，刷新邮箱列表
    if (currentViewingUser && currentViewingUser.username === username) {
      loadUserMailboxes();
    }
  } catch(e) {
    showToast('分配失败', 'error');
  }
}

// 取消分配邮箱
async function handleUnassignMailbox() {
  const username = els.unassignName?.value.trim();
  const addressText = els.unassignMail?.value.trim();
  
  if (!username) {
    showToast('请输入用户名', 'error');
    return;
  }
  
  if (!addressText) {
    showToast('请输入邮箱地址', 'error');
    return;
  }
  
  // 支持批量取消分配（每行一个地址）
  const addresses = addressText.split('\n').map(a => a.trim()).filter(a => a);
  if (addresses.length === 0) {
    showToast('请输入有效的邮箱地址', 'error');
    return;
  }
  
  try {
    let successCount = 0;
    let failCount = 0;
    for (const address of addresses) {
      try {
        await unassignMailbox(username, address);
        successCount++;
      } catch(e) {
        failCount++;
      }
    }
    
    if (successCount > 0 && failCount === 0) {
      showToast(`成功取消分配 ${successCount} 个邮箱`, 'success');
    } else if (successCount > 0 && failCount > 0) {
      showToast(`成功 ${successCount} 个，失败 ${failCount} 个`, 'warning');
    } else {
      showToast('取消分配失败', 'error');
    }
    
    els.unassignModal?.classList.remove('show');
    els.unassignMail.value = '';
    els.unassignName.value = '';
    
    // 如果当前有查看的用户且用户名匹配，刷新邮箱列表
    if (currentViewingUser && currentViewingUser.username === username) {
      loadUserMailboxes();
    }
  } catch(e) {
    showToast('取消分配失败', 'error');
  }
}

// 事件绑定
els.back?.addEventListener('click', () => history.back());
els.logout?.addEventListener('click', async () => { try { await api('/api/logout', { method: 'POST' }); } catch(_) {} location.replace('/html/login.html'); });
els.usersRefresh?.addEventListener('click', loadUsers);
els.prevPage?.addEventListener('click', () => { if (currentPage > 1) { currentPage--; loadUsers(); }});
els.nextPage?.addEventListener('click', () => { const totalPages = Math.ceil(totalUsers / pageSize); if (currentPage < totalPages) { currentPage++; loadUsers(); }});

// 创建用户模态框
els.uOpen?.addEventListener('click', () => els.uModal?.classList.add('show'));
els.uClose?.addEventListener('click', () => els.uModal?.classList.remove('show'));
els.uCancel?.addEventListener('click', () => els.uModal?.classList.remove('show'));
els.uCreate?.addEventListener('click', handleCreateUser);

// 分配邮箱模态框
els.aOpen?.addEventListener('click', () => els.aModal?.classList.add('show'));
els.aClose?.addEventListener('click', () => els.aModal?.classList.remove('show'));
els.aCancel?.addEventListener('click', () => els.aModal?.classList.remove('show'));
els.aAssign?.addEventListener('click', handleAssignMailbox);

// 取消分配模态框
els.unassignOpen?.addEventListener('click', () => els.unassignModal?.classList.add('show'));
els.unassignClose?.addEventListener('click', () => els.unassignModal?.classList.remove('show'));
els.unassignCancel?.addEventListener('click', () => els.unassignModal?.classList.remove('show'));
els.unassignSubmit?.addEventListener('click', handleUnassignMailbox);

// 编辑模态框
els.editClose?.addEventListener('click', () => els.editModal?.classList.remove('show'));
els.editCancel?.addEventListener('click', () => els.editModal?.classList.remove('show'));
els.editSave?.addEventListener('click', saveEdit);
els.editDelete?.addEventListener('click', async () => {
  if (!currentViewingUser) return;
  
  const confirmed = await showConfirm(`确定删除用户 "${currentViewingUser.username}" 吗？此操作不可恢复。`);
  if (!confirmed) return;
  
  try {
    await deleteUser(currentViewingUser.id);
    showToast('用户已删除', 'success');
    els.editModal?.classList.remove('show');
    loadUsers();
  } catch(e) { showToast('删除失败', 'error'); }
});

// 邮箱分页
els.mailboxesPrevPage?.addEventListener('click', () => { if (mailboxPage > 1) { mailboxPage--; loadUserMailboxes(); }});
els.mailboxesNextPage?.addEventListener('click', () => { const totalPages = Math.ceil(totalMailboxes / mailboxPageSize); if (mailboxPage < totalPages) { mailboxPage++; loadUserMailboxes(); }});

// 初始化
loadUsers();
