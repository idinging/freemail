/**
 * 全局状态管理模块
 * @module core/state
 */

// 全局状态
const state = {
  // 用户信息
  user: {
    role: null,
    username: null,
    isGuest: false,
    isAdmin: false,
    isStrictAdmin: false
  },
  
  // 域名列表
  domains: [],
  
  // 当前选中的邮箱
  currentMailbox: null,
  
  // 邮箱列表
  mailboxes: [],
  
  // 当前邮件列表
  emails: [],
  
  // 当前查看的邮件
  currentEmail: null,
  
  // 用户配额
  quota: {
    limit: 0,
    used: 0,
    remaining: 0
  },
  
  // UI 状态
  ui: {
    loading: false,
    error: null,
    sidebarCollapsed: false
  }
};

// 状态变化监听器
const listeners = new Map();

/**
 * 获取状态
 * @param {string} path - 状态路径（如 'user.role'）
 * @returns {any}
 */
export function getState(path) {
  if (!path) return state;
  
  const keys = path.split('.');
  let current = state;
  
  for (const key of keys) {
    if (current === null || current === undefined) return undefined;
    current = current[key];
  }
  
  return current;
}

/**
 * 设置状态
 * @param {string} path - 状态路径
 * @param {any} value - 新值
 */
export function setState(path, value) {
  const keys = path.split('.');
  const lastKey = keys.pop();
  let current = state;
  
  for (const key of keys) {
    if (current[key] === undefined) {
      current[key] = {};
    }
    current = current[key];
  }
  
  const oldValue = current[lastKey];
  current[lastKey] = value;
  
  // 通知监听器
  notifyListeners(path, value, oldValue);
}

/**
 * 更新状态（合并对象）
 * @param {string} path - 状态路径
 * @param {object} updates - 更新内容
 */
export function updateState(path, updates) {
  const current = getState(path);
  if (typeof current === 'object' && current !== null) {
    setState(path, { ...current, ...updates });
  } else {
    setState(path, updates);
  }
}

/**
 * 订阅状态变化
 * @param {string} path - 状态路径
 * @param {Function} callback - 回调函数
 * @returns {Function} 取消订阅函数
 */
export function subscribe(path, callback) {
  if (!listeners.has(path)) {
    listeners.set(path, new Set());
  }
  listeners.get(path).add(callback);
  
  // 返回取消订阅函数
  return () => {
    const pathListeners = listeners.get(path);
    if (pathListeners) {
      pathListeners.delete(callback);
    }
  };
}

/**
 * 通知监听器
 * @param {string} path - 状态路径
 * @param {any} newValue - 新值
 * @param {any} oldValue - 旧值
 */
function notifyListeners(path, newValue, oldValue) {
  // 通知精确匹配的监听器
  const pathListeners = listeners.get(path);
  if (pathListeners) {
    for (const callback of pathListeners) {
      try {
        callback(newValue, oldValue, path);
      } catch (e) {
        console.error('State listener error:', e);
      }
    }
  }
  
  // 通知父级路径的监听器
  const parts = path.split('.');
  for (let i = parts.length - 1; i > 0; i--) {
    const parentPath = parts.slice(0, i).join('.');
    const parentListeners = listeners.get(parentPath);
    if (parentListeners) {
      const parentValue = getState(parentPath);
      for (const callback of parentListeners) {
        try {
          callback(parentValue, undefined, parentPath);
        } catch (e) {
          console.error('State listener error:', e);
        }
      }
    }
  }
}

/**
 * 重置状态
 */
export function resetState() {
  state.user = { role: null, username: null, isGuest: false, isAdmin: false, isStrictAdmin: false };
  state.domains = [];
  state.currentMailbox = null;
  state.mailboxes = [];
  state.emails = [];
  state.currentEmail = null;
  state.quota = { limit: 0, used: 0, remaining: 0 };
  state.ui = { loading: false, error: null, sidebarCollapsed: false };
}

/**
 * 初始化用户状态
 * @param {object} sessionData - 会话数据
 */
export function initUserState(sessionData) {
  if (!sessionData) return;
  
  setState('user', {
    role: sessionData.role || null,
    username: sessionData.username || null,
    isGuest: sessionData.role === 'guest',
    isAdmin: sessionData.role === 'admin',
    isStrictAdmin: sessionData.strictAdmin === true
  });
}

/**
 * 设置加载状态
 * @param {boolean} loading - 是否加载中
 */
export function setLoading(loading) {
  setState('ui.loading', loading);
}

/**
 * 设置错误信息
 * @param {string|null} error - 错误信息
 */
export function setError(error) {
  setState('ui.error', error);
}

// 导出状态对象（只读访问）
export { state };

// 导出默认对象
export default {
  getState,
  setState,
  updateState,
  subscribe,
  resetState,
  initUserState,
  setLoading,
  setError,
  state
};
