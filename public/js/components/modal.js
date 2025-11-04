/**
 * 弹窗组件模块
 * @module components/modal
 */

/**
 * 创建弹窗
 * @param {object} options - 弹窗选项
 * @returns {object} 弹窗控制对象
 */
export function createModal(options = {}) {
  const {
    title = '',
    content = '',
    confirmText = '确定',
    cancelText = '取消',
    showCancel = true,
    onConfirm = null,
    onCancel = null,
    onClose = null,
    className = ''
  } = options;

  // 创建遮罩
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    opacity: 0;
    transition: opacity 0.2s ease;
  `;

  // 创建弹窗容器
  const modal = document.createElement('div');
  modal.className = `modal-container ${className}`;
  modal.style.cssText = `
    background: white;
    border-radius: 12px;
    padding: 24px;
    min-width: 320px;
    max-width: 90vw;
    max-height: 90vh;
    overflow: auto;
    transform: scale(0.9);
    transition: transform 0.2s ease;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
  `;

  // 构建内容
  modal.innerHTML = `
    ${title ? `<div class="modal-title" style="font-size: 18px; font-weight: 600; margin-bottom: 16px;">${title}</div>` : ''}
    <div class="modal-content" style="margin-bottom: 20px;">${content}</div>
    <div class="modal-actions" style="display: flex; gap: 12px; justify-content: flex-end;">
      ${showCancel ? `<button class="modal-cancel" style="padding: 8px 16px; border: 1px solid #ddd; background: white; border-radius: 6px; cursor: pointer;">${cancelText}</button>` : ''}
      <button class="modal-confirm" style="padding: 8px 16px; border: none; background: #3b82f6; color: white; border-radius: 6px; cursor: pointer;">${confirmText}</button>
    </div>
  `;

  overlay.appendChild(modal);

  // 关闭函数
  const close = () => {
    overlay.style.opacity = '0';
    modal.style.transform = 'scale(0.9)';
    setTimeout(() => {
      overlay.remove();
      if (onClose) onClose();
    }, 200);
  };

  // 绑定事件
  const confirmBtn = modal.querySelector('.modal-confirm');
  const cancelBtn = modal.querySelector('.modal-cancel');

  confirmBtn.addEventListener('click', async () => {
    if (onConfirm) {
      const result = await onConfirm();
      if (result !== false) close();
    } else {
      close();
    }
  });

  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      if (onCancel) onCancel();
      close();
    });
  }

  // 点击遮罩关闭
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      if (onCancel) onCancel();
      close();
    }
  });

  // ESC 关闭
  const handleKeydown = (e) => {
    if (e.key === 'Escape') {
      if (onCancel) onCancel();
      close();
      document.removeEventListener('keydown', handleKeydown);
    }
  };
  document.addEventListener('keydown', handleKeydown);

  // 显示
  document.body.appendChild(overlay);
  requestAnimationFrame(() => {
    overlay.style.opacity = '1';
    modal.style.transform = 'scale(1)';
  });

  return {
    close,
    element: modal,
    overlay
  };
}

/**
 * 确认弹窗
 * @param {string} message - 确认消息
 * @param {object} options - 选项
 * @returns {Promise<boolean>}
 */
export function confirm(message, options = {}) {
  return new Promise((resolve) => {
    createModal({
      title: options.title || '确认',
      content: `<p style="margin: 0; color: #666;">${message}</p>`,
      confirmText: options.confirmText || '确定',
      cancelText: options.cancelText || '取消',
      showCancel: true,
      onConfirm: () => {
        resolve(true);
        return true;
      },
      onCancel: () => {
        resolve(false);
      },
      ...options
    });
  });
}

/**
 * 警告弹窗
 * @param {string} message - 消息
 * @param {object} options - 选项
 * @returns {Promise<void>}
 */
export function alert(message, options = {}) {
  return new Promise((resolve) => {
    createModal({
      title: options.title || '提示',
      content: `<p style="margin: 0; color: #666;">${message}</p>`,
      confirmText: options.confirmText || '知道了',
      showCancel: false,
      onConfirm: () => {
        resolve();
        return true;
      },
      ...options
    });
  });
}

/**
 * 输入弹窗
 * @param {string} message - 提示消息
 * @param {object} options - 选项
 * @returns {Promise<string|null>}
 */
export function prompt(message, options = {}) {
  return new Promise((resolve) => {
    const inputId = 'modal-input-' + Date.now();
    const content = `
      <p style="margin: 0 0 12px; color: #666;">${message}</p>
      <input id="${inputId}" type="${options.type || 'text'}" 
             placeholder="${options.placeholder || ''}"
             value="${options.defaultValue || ''}"
             style="width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 6px; box-sizing: border-box;">
    `;
    
    const modal = createModal({
      title: options.title || '输入',
      content,
      confirmText: options.confirmText || '确定',
      cancelText: options.cancelText || '取消',
      showCancel: true,
      onConfirm: () => {
        const input = document.getElementById(inputId);
        resolve(input ? input.value : null);
        return true;
      },
      onCancel: () => {
        resolve(null);
      },
      ...options
    });

    // 自动聚焦
    setTimeout(() => {
      const input = document.getElementById(inputId);
      if (input) input.focus();
    }, 100);
  });
}

// 导出默认对象
export default {
  createModal,
  confirm,
  alert,
  prompt
};
