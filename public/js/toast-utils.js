/**
 * 统一Toast工具模块 - 高内聚低耦合设计
 * 
 * 功能特性:
 * - 统一使用 /templates/toast.html 模板
 * - 左上角显示 (top: 24px, left: 24px)
 * - 图标映射自动处理
 * - 统一动画效果
 * - 自动容器管理
 */

// Toast模板缓存
let __toastTpl = null;
let __toastTplPromise = null;

// 图标映射配置 - 使用最基本的字符确保兼容性
const ICON_MAP = {
  'success': '✓',
  'warn': '!', 
  'error': '×',
  'info': 'i'
};

// Toast容器配置
const CONTAINER_STYLES = {
  position: 'fixed',
  top: '24px',
  left: '24px',
  right: 'auto',
  zIndex: '2000',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  maxWidth: '420px',
  pointerEvents: 'none'
};

/**
 * 预加载Toast模板
 */
function preloadToastTemplate() {
  try {
    __toastTplPromise = fetch('/templates/toast.html', { cache: 'force-cache' })
      .then(r => r && r.ok ? r.text() : null)
      .then(t => { __toastTpl = t; return t; })
      .catch(() => null);
  } catch (_) { }
}

/**
 * 确保Toast容器存在并应用正确样式
 */
function ensureToastContainer() {
  let container = document.getElementById('toast');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast';
    container.className = 'toast';
    document.body.appendChild(container);
  }
  
  // 应用容器样式 - 确保左上角显示
  Object.assign(container.style, CONTAINER_STYLES);
  
  return container;
}

/**
 * 统一Toast显示函数
 * @param {string} message - 提示消息
 * @param {string} type - 类型 (success|warn|error|info)
 * @param {number} duration - 显示时长(ms), 默认3000
 */
async function showToast(message, type = 'info', duration = 3000) {
  try {
    // 获取模板
    if (!__toastTpl) {
      if (!__toastTplPromise) {
        try { 
          __toastTplPromise = fetch('/templates/toast.html', { cache: 'force-cache' })
            .then(r => r && r.ok ? r.text() : null)
            .then(t => { __toastTpl = t; return t; }); 
        } catch (_) { }
      }
      try { __toastTpl = await __toastTplPromise; } catch (_) { }
    }
    
    // 获取图标
    const icon = ICON_MAP[type] || ICON_MAP.info;
    
    // 渲染模板
    const tpl = __toastTpl || '';
    const html = tpl
      .replace('{{type}}', String(type || 'info'))
      .replace('{{icon}}', icon)
      .replace('{{message}}', String(message || ''));
    
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    
    // 注入样式（仅一次）
    const styleEl = wrapper.querySelector('#toast-style');
    if (styleEl && !document.getElementById('toast-style')) {
      document.head.appendChild(styleEl);
    }
    
    // 插入toast元素
    const toastEl = wrapper.querySelector('.toast-item');
    if (toastEl) {
      const container = ensureToastContainer();
      container.appendChild(toastEl);
      
      // 统一消失动画
      setTimeout(() => {
        toastEl.style.animation = 'slideOutLeft 0.3s cubic-bezier(0.4, 0, 1, 1) forwards';
        setTimeout(() => toastEl.remove(), 300);
      }, duration);
      return;
    }
    
    // 模板失败时的降级处理
    throw new Error('toast template missing');
    
  } catch (_) {
    // 降级到简易toast
    const div = document.createElement('div');
    div.className = `toast-item ${type}`;
    div.innerHTML = `<span class="toast-icon">${ICON_MAP[type] || ICON_MAP.info}</span><span class="toast-message">${message}</span>`;
    
    const container = ensureToastContainer();
    container.appendChild(div);
    
    setTimeout(() => {
      div.style.transition = 'opacity .3s ease';
      div.style.opacity = '0';
      setTimeout(() => div.remove(), 300);
    }, duration);
  }
}

/**
 * 便捷方法
 */
const Toast = {
  success: (message, duration) => showToast(message, 'success', duration),
  warn: (message, duration) => showToast(message, 'warn', duration),
  error: (message, duration) => showToast(message, 'error', duration),
  info: (message, duration) => showToast(message, 'info', duration),
  show: showToast
};

// 预加载模板
preloadToastTemplate();

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { showToast, Toast };
} else {
  window.showToast = showToast;
  window.Toast = Toast;
}
