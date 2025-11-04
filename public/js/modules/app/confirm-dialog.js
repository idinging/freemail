/**
 * 确认对话框模块
 * @module modules/app/confirm-dialog
 */

// 当前确认对话框的控制器
let currentConfirmController = null;

/**
 * 显示确认对话框
 * @param {string} message - 确认消息
 * @param {Function} onConfirm - 确认回调
 * @param {Function} onCancel - 取消回调
 * @param {object} elements - DOM 元素引用
 * @returns {Promise<boolean>}
 */
export function showConfirm(message, onConfirm = null, onCancel = null, elements = null) {
  return new Promise((resolve) => {
    try {
      // 获取 DOM 元素
      const els = elements || {
        confirmModal: document.getElementById('confirm-modal'),
        confirmMessage: document.getElementById('confirm-message'),
        confirmOk: document.getElementById('confirm-ok'),
        confirmCancel: document.getElementById('confirm-cancel'),
        confirmClose: document.getElementById('confirm-close')
      };
      
      if (!els.confirmModal) {
        // 降级到原生 confirm
        const result = confirm(message || '确认执行该操作？');
        resolve(result);
        if (result && onConfirm) onConfirm();
        if (!result && onCancel) onCancel();
        return;
      }
      
      // 如果有之前的控制器，先取消
      if (currentConfirmController) {
        currentConfirmController.abort();
      }
      
      // 创建新的 AbortController
      currentConfirmController = new AbortController();
      const signal = currentConfirmController.signal;
      
      // 将回调保存到模态框的属性中
      els.confirmModal._currentResolve = resolve;
      els.confirmModal._currentOnConfirm = onConfirm;
      els.confirmModal._currentOnCancel = onCancel;
      
      els.confirmMessage.textContent = message;
      els.confirmModal.classList.add('show');
      
      const handleConfirm = () => {
        els.confirmModal.classList.remove('show');
        currentConfirmController = null;
        
        const currentResolve = els.confirmModal._currentResolve;
        const currentOnConfirm = els.confirmModal._currentOnConfirm;
        
        delete els.confirmModal._currentResolve;
        delete els.confirmModal._currentOnConfirm;
        delete els.confirmModal._currentOnCancel;
        
        if (currentResolve) currentResolve(true);
        if (currentOnConfirm) currentOnConfirm();
      };
      
      const handleCancel = () => {
        els.confirmModal.classList.remove('show');
        currentConfirmController = null;
        
        const currentResolve = els.confirmModal._currentResolve;
        const currentOnCancel = els.confirmModal._currentOnCancel;
        
        delete els.confirmModal._currentResolve;
        delete els.confirmModal._currentOnConfirm;
        delete els.confirmModal._currentOnCancel;
        
        if (currentResolve) currentResolve(false);
        if (currentOnCancel) currentOnCancel();
      };
      
      // 使用 AbortController 管理事件监听器
      els.confirmOk.addEventListener('click', handleConfirm, { signal });
      els.confirmCancel.addEventListener('click', handleCancel, { signal });
      if (els.confirmClose) {
        els.confirmClose.addEventListener('click', handleCancel, { signal });
      }
      
    } catch (err) {
      console.error('确认对话框初始化失败:', err);
      const result = confirm(message || '确认执行该操作？');
      resolve(result);
      if (result && onConfirm) onConfirm();
      if (!result && onCancel) onCancel();
    }
  });
}

/**
 * 关闭当前确认对话框
 */
export function closeConfirm() {
  if (currentConfirmController) {
    currentConfirmController.abort();
    currentConfirmController = null;
  }
  const modal = document.getElementById('confirm-modal');
  if (modal) {
    modal.classList.remove('show');
  }
}

// 导出默认对象
export default {
  showConfirm,
  closeConfirm
};
