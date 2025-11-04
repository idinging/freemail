/**
 * Toast 通知组件模块
 * @module components/toast
 */

// Toast 容器
let toastContainer = null;

/**
 * 获取或创建 Toast 容器
 * @returns {HTMLElement}
 */
function getToastContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    toastContainer.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 99999;
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-width: 360px;
    `;
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

/**
 * 显示 Toast 通知
 * @param {string} message - 消息内容
 * @param {string} type - 类型：'success', 'error', 'warning', 'info'
 * @param {number} duration - 显示时长（毫秒）
 * @returns {Promise<void>}
 */
export async function showToast(message, type = 'info', duration = 3000) {
  const container = getToastContainer();
  
  // 创建 Toast 元素
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  // 图标映射
  const icons = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ'
  };
  
  // 背景色映射
  const colors = {
    success: '#10b981',
    error: '#ef4444',
    warning: '#f59e0b',
    info: '#3b82f6'
  };
  
  toast.style.cssText = `
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    background: ${colors[type] || colors.info};
    color: white;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    font-size: 14px;
    opacity: 0;
    transform: translateX(100%);
    transition: opacity 0.3s ease, transform 0.3s ease;
  `;
  
  toast.innerHTML = `
    <span style="font-size: 16px;">${icons[type] || icons.info}</span>
    <span>${message}</span>
  `;
  
  container.appendChild(toast);
  
  // 显示动画
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(0)';
  });
  
  // 自动隐藏
  return new Promise((resolve) => {
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      setTimeout(() => {
        toast.remove();
        resolve();
      }, 300);
    }, duration);
  });
}

/**
 * 成功提示
 * @param {string} message - 消息
 * @param {number} duration - 时长
 */
export function success(message, duration = 3000) {
  return showToast(message, 'success', duration);
}

/**
 * 错误提示
 * @param {string} message - 消息
 * @param {number} duration - 时长
 */
export function error(message, duration = 3000) {
  return showToast(message, 'error', duration);
}

/**
 * 警告提示
 * @param {string} message - 消息
 * @param {number} duration - 时长
 */
export function warning(message, duration = 3000) {
  return showToast(message, 'warning', duration);
}

/**
 * 信息提示
 * @param {string} message - 消息
 * @param {number} duration - 时长
 */
export function info(message, duration = 3000) {
  return showToast(message, 'info', duration);
}

// 将 showToast 挂载到全局（兼容现有代码）
if (typeof window !== 'undefined') {
  window.showToast = showToast;
}

// 导出默认对象
export default {
  showToast,
  success,
  error,
  warning,
  info
};
