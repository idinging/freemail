/**
 * 邮箱设置模块 - 处理转发和收藏相关的前端逻辑
 * @module mailbox-settings
 */

import { mockApi } from './modules/app/mock-api.js';

/**
 * 内部 API 请求封装（支持 guest 模式）
 */
async function apiRequest(path, options = {}) {
  if (window.__GUEST_MODE__) {
    return mockApi(path, options);
  }
  return fetch(path, options);
}

// ========== 转发设置 ==========

/**
 * 打开转发设置弹窗
 * @param {number} mailboxId - 邮箱 ID
 * @param {string} mailboxAddress - 邮箱地址
 * @param {string|null} currentForwardTo - 当前转发目标
 */
export function openForwardDialog(mailboxId, mailboxAddress, currentForwardTo) {
  // 移除已存在的弹窗
  const existing = document.getElementById('forward-dialog');
  if (existing) existing.remove();
  
  const dialog = document.createElement('div');
  dialog.id = 'forward-dialog';
  dialog.className = 'modal-overlay';
  dialog.innerHTML = `
    <div class="modal-content" style="max-width: 400px;">
      <div class="modal-header">
        <h3>转发设置</h3>
        <button class="modal-close" onclick="document.getElementById('forward-dialog').remove()">×</button>
      </div>
      <div class="modal-body">
        <p style="margin-bottom: 10px; color: var(--text-secondary); font-size: 14px;">
          邮箱: <strong>${escapeHtml(mailboxAddress)}</strong>
        </p>
        <div class="form-group">
          <label for="forward-to-input">转发目标邮箱</label>
          <input type="email" id="forward-to-input" class="form-input" 
                 placeholder="留空则不转发" 
                 value="${escapeHtml(currentForwardTo || '')}">
          <p style="margin-top: 5px; color: var(--text-tertiary); font-size: 12px;">
            设置后，此邮箱收到的邮件将自动转发到指定地址
          </p>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="document.getElementById('forward-dialog').remove()">取消</button>
        <button class="btn btn-primary" id="save-forward-btn">保存</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(dialog);
  
  // 绑定保存事件
  document.getElementById('save-forward-btn').onclick = async () => {
    const forwardTo = document.getElementById('forward-to-input').value.trim();
    await saveForwardSetting(mailboxId, forwardTo || null);
  };
  
  // 按 ESC 关闭
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') dialog.remove();
  });
  
  // 点击背景关闭
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.remove();
  });
  
  // 聚焦输入框
  setTimeout(() => document.getElementById('forward-to-input').focus(), 100);
}

/**
 * 保存转发设置
 * @param {number} mailboxId - 邮箱 ID
 * @param {string|null} forwardTo - 转发目标邮箱
 */
export async function saveForwardSetting(mailboxId, forwardTo) {
  const btn = document.getElementById('save-forward-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '保存中...';
  }
  
  try {
    const resp = await apiRequest('/api/mailbox/forward', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mailbox_id: mailboxId, forward_to: forwardTo })
    });
    
    const result = await resp.json();
    
    if (resp.ok && result.success) {
      showToast(forwardTo ? `已设置转发到: ${forwardTo}` : '已取消转发', 'success');
      document.getElementById('forward-dialog')?.remove();
      // 触发刷新事件
      window.dispatchEvent(new CustomEvent('mailbox-settings-updated', { 
        detail: { mailboxId, forward_to: forwardTo } 
      }));
    } else {
      showToast(result.error || '设置失败', 'error');
    }
  } catch (e) {
    console.error('保存转发设置失败:', e);
    showToast('保存失败，请重试', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '保存';
    }
  }
}

// ========== 收藏功能 ==========

/**
 * 切换邮箱收藏状态
 * @param {number} mailboxId - 邮箱 ID
 * @param {Function} [callback] - 成功后的回调函数
 * @returns {Promise<{success: boolean, is_favorite: number}>}
 */
export async function toggleFavorite(mailboxId, callback) {
  try {
    const resp = await apiRequest('/api/mailbox/favorite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mailbox_id: mailboxId })
    });
    
    const result = await resp.json();
    
    if (resp.ok && result.success) {
      const isFav = result.is_favorite;
      showToast(isFav ? '已收藏' : '已取消收藏', 'success');
      // 触发刷新事件
      window.dispatchEvent(new CustomEvent('mailbox-settings-updated', { 
        detail: { mailboxId, is_favorite: isFav } 
      }));
      if (callback) callback(result);
      return result;
    } else {
      showToast(result.error || '操作失败', 'error');
      return { success: false };
    }
  } catch (e) {
    console.error('切换收藏失败:', e);
    showToast('操作失败，请重试', 'error');
    return { success: false };
  }
}

/**
 * 批量设置收藏状态
 * @param {number[]} mailboxIds - 邮箱 ID 列表
 * @param {boolean} isFavorite - 是否收藏
 * @returns {Promise<{success: boolean}>}
 */
export async function batchSetFavorite(mailboxIds, isFavorite) {
  if (!mailboxIds || mailboxIds.length === 0) {
    showToast('请先选择邮箱', 'warning');
    return { success: false };
  }
  
  try {
    const resp = await apiRequest('/api/mailboxes/batch-favorite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mailbox_ids: mailboxIds, is_favorite: isFavorite })
    });
    
    const result = await resp.json();
    
    if (resp.ok && result.success) {
      showToast(`已${isFavorite ? '收藏' : '取消收藏'} ${result.updated_count} 个邮箱`, 'success');
      window.dispatchEvent(new CustomEvent('mailbox-settings-batch-updated'));
      return result;
    } else {
      showToast(result.error || '批量操作失败', 'error');
      return { success: false };
    }
  } catch (e) {
    console.error('批量设置收藏失败:', e);
    showToast('操作失败，请重试', 'error');
    return { success: false };
  }
}

// ========== UI 辅助函数 ==========

/**
 * 渲染转发状态标识
 * @param {string|null} forwardTo - 转发目标
 * @returns {string} HTML 字符串
 */
export function renderForwardBadge(forwardTo) {
  if (!forwardTo) return '';
  return `<span class="badge badge-forward" title="转发到: ${escapeHtml(forwardTo)}">↪️</span>`;
}

/**
 * 渲染收藏状态标识
 * @param {number|boolean} isFavorite - 是否收藏
 * @returns {string} HTML 字符串
 */
export function renderFavoriteBadge(isFavorite) {
  return isFavorite ? '<span class="badge badge-favorite" title="已收藏">⭐</span>' : '';
}

/**
 * 创建转发设置按钮
 * @param {number} mailboxId - 邮箱 ID
 * @param {string} mailboxAddress - 邮箱地址
 * @param {string|null} forwardTo - 当前转发目标
 * @returns {HTMLButtonElement}
 */
export function createForwardButton(mailboxId, mailboxAddress, forwardTo) {
  const btn = document.createElement('button');
  btn.className = 'btn btn-ghost btn-sm';
  btn.title = forwardTo ? `转发到: ${forwardTo}` : '设置转发';
  btn.innerHTML = forwardTo ? '↪️' : '➡️';
  btn.onclick = (e) => {
    e.stopPropagation();
    openForwardDialog(mailboxId, mailboxAddress, forwardTo);
  };
  return btn;
}

/**
 * 创建收藏按钮
 * @param {number} mailboxId - 邮箱 ID
 * @param {number|boolean} isFavorite - 是否收藏
 * @param {Function} [onUpdate] - 更新后的回调
 * @returns {HTMLButtonElement}
 */
export function createFavoriteButton(mailboxId, isFavorite, onUpdate) {
  const btn = document.createElement('button');
  btn.className = 'btn btn-ghost btn-sm';
  btn.title = isFavorite ? '取消收藏' : '收藏';
  btn.innerHTML = isFavorite ? '⭐' : '☆';
  btn.onclick = async (e) => {
    e.stopPropagation();
    const result = await toggleFavorite(mailboxId);
    if (result.success && onUpdate) {
      onUpdate(result.is_favorite);
    }
  };
  return btn;
}

// ========== 工具函数 ==========

/**
 * HTML 转义
 * @param {string} str - 原始字符串
 * @returns {string} 转义后的字符串
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * 显示提示消息
 * @param {string} message - 消息内容
 * @param {string} type - 类型: success, error, warning, info
 */
function showToast(message, type = 'info') {
  // 尝试使用全局 showToast
  if (typeof window.showToast === 'function') {
    window.showToast(message, type);
    return;
  }
  
  // 简单的 fallback
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 24px;
    border-radius: 8px;
    color: white;
    font-size: 14px;
    z-index: 10000;
    animation: slideIn 0.3s ease;
    background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : type === 'warning' ? '#f59e0b' : '#3b82f6'};
  `;
  
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// 导出弹窗样式（可在页面加载时注入）
export function injectDialogStyles() {
  if (document.getElementById('mailbox-settings-styles')) return;
  
  const style = document.createElement('style');
  style.id = 'mailbox-settings-styles';
  style.textContent = `
    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      backdrop-filter: blur(4px);
    }
    .modal-content {
      background: var(--bg-primary, #fff);
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      width: 90%;
      max-width: 500px;
      animation: modalIn 0.2s ease;
    }
    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 20px;
      border-bottom: 1px solid var(--border-color, #e5e7eb);
    }
    .modal-header h3 {
      margin: 0;
      font-size: 18px;
    }
    .modal-close {
      background: none;
      border: none;
      font-size: 24px;
      cursor: pointer;
      color: var(--text-secondary, #6b7280);
      padding: 0;
      line-height: 1;
    }
    .modal-close:hover {
      color: var(--text-primary, #111827);
    }
    .modal-body {
      padding: 20px;
    }
    .modal-footer {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      padding: 16px 20px;
      border-top: 1px solid var(--border-color, #e5e7eb);
    }
    .form-group {
      margin-bottom: 15px;
    }
    .form-group label {
      display: block;
      margin-bottom: 6px;
      font-weight: 500;
      font-size: 14px;
    }
    .form-input {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid var(--border-color, #d1d5db);
      border-radius: 8px;
      font-size: 14px;
      transition: border-color 0.2s;
    }
    .form-input:focus {
      outline: none;
      border-color: var(--primary-color, #3b82f6);
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 12px;
      margin-left: 4px;
    }
    .badge-forward {
      background: rgba(59, 130, 246, 0.1);
    }
    .badge-favorite {
      background: rgba(245, 158, 11, 0.1);
    }
    @keyframes modalIn {
      from {
        opacity: 0;
        transform: scale(0.95) translateY(-10px);
      }
      to {
        opacity: 1;
        transform: scale(1) translateY(0);
      }
    }
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
      from { transform: translateX(0); opacity: 1; }
      to { transform: translateX(100%); opacity: 0; }
    }
  `;
  document.head.appendChild(style);
}
