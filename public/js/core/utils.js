/**
 * 通用工具函数模块
 * @module core/utils
 */

/**
 * 格式化时间戳为本地时间
 * @param {string|number} ts - 时间戳
 * @param {object} options - 格式化选项
 * @returns {string}
 */
export function formatTime(ts, options = {}) {
  if (!ts) return '';
  try {
    const isoStr = String(ts).includes('T') ? ts : ts.replace(' ', 'T');
    const d = new Date(isoStr + (isoStr.endsWith('Z') ? '' : 'Z'));
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour12: false,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      ...options
    }).format(d);
  } catch (_) {
    return String(ts);
  }
}

/**
 * 格式化相对时间
 * @param {string|number} ts - 时间戳
 * @returns {string}
 */
export function formatRelativeTime(ts) {
  if (!ts) return '';
  try {
    const isoStr = String(ts).includes('T') ? ts : ts.replace(' ', 'T');
    const d = new Date(isoStr + (isoStr.endsWith('Z') ? '' : 'Z'));
    const now = new Date();
    const diff = now - d;
    
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    if (days < 7) return `${days}天前`;
    
    return formatTime(ts, { year: 'numeric', month: 'numeric', day: 'numeric' });
  } catch (_) {
    return String(ts);
  }
}

/**
 * HTML 转义
 * @param {string} str - 原始字符串
 * @returns {string}
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * HTML 属性转义
 * @param {string} str - 原始字符串
 * @returns {string}
 */
export function escapeAttr(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * 复制文本到剪贴板
 * @param {string} text - 要复制的文本
 * @returns {Promise<boolean>}
 */
export async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    // 降级方案
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const success = document.execCommand('copy');
    document.body.removeChild(textarea);
    return success;
  } catch (_) {
    return false;
  }
}

/**
 * 防抖函数
 * @param {Function} fn - 要防抖的函数
 * @param {number} delay - 延迟时间（毫秒）
 * @returns {Function}
 */
export function debounce(fn, delay = 300) {
  let timer = null;
  return function (...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      fn.apply(this, args);
      timer = null;
    }, delay);
  };
}

/**
 * 节流函数
 * @param {Function} fn - 要节流的函数
 * @param {number} limit - 限制时间（毫秒）
 * @returns {Function}
 */
export function throttle(fn, limit = 300) {
  let inThrottle = false;
  return function (...args) {
    if (!inThrottle) {
      fn.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

/**
 * 生成随机 ID
 * @param {number} length - 长度
 * @returns {string}
 */
export function generateId(length = 8) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

/**
 * 检查是否为移动设备
 * @returns {boolean}
 */
export function isMobile() {
  return window.innerWidth < 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

/**
 * 解析邮箱地址的本地部分和域名
 * @param {string} email - 邮箱地址
 * @returns {{ local: string, domain: string }}
 */
export function parseEmail(email) {
  const parts = String(email || '').split('@');
  return {
    local: parts[0] || '',
    domain: parts[1] || ''
  };
}

/**
 * 验证邮箱格式
 * @param {string} email - 邮箱地址
 * @returns {boolean}
 */
export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * 截断字符串
 * @param {string} str - 原始字符串
 * @param {number} maxLength - 最大长度
 * @param {string} suffix - 后缀
 * @returns {string}
 */
export function truncate(str, maxLength = 50, suffix = '...') {
  if (!str) return '';
  const s = String(str);
  if (s.length <= maxLength) return s;
  return s.slice(0, maxLength - suffix.length) + suffix;
}

/**
 * 等待指定时间
 * @param {number} ms - 毫秒
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 安全解析 JSON
 * @param {string} str - JSON 字符串
 * @param {any} defaultValue - 默认值
 * @returns {any}
 */
export function safeJsonParse(str, defaultValue = null) {
  try {
    return JSON.parse(str);
  } catch (_) {
    return defaultValue;
  }
}

/**
 * 获取 URL 查询参数
 * @param {string} name - 参数名
 * @returns {string|null}
 */
export function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

/**
 * 设置 URL 查询参数
 * @param {string} name - 参数名
 * @param {string} value - 参数值
 */
export function setQueryParam(name, value) {
  const url = new URL(window.location.href);
  if (value === null || value === undefined || value === '') {
    url.searchParams.delete(name);
  } else {
    url.searchParams.set(name, value);
  }
  window.history.replaceState({}, '', url.toString());
}

// 导出默认对象
export default {
  formatTime,
  formatRelativeTime,
  escapeHtml,
  escapeAttr,
  copyToClipboard,
  debounce,
  throttle,
  generateId,
  isMobile,
  parseEmail,
  isValidEmail,
  truncate,
  sleep,
  safeJsonParse,
  getQueryParam,
  setQueryParam
};
