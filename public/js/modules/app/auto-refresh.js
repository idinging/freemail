/**
 * 自动刷新模块
 * @module modules/app/auto-refresh
 */

// 自动刷新状态
let autoRefreshInterval = null;
let isAutoRefreshEnabled = true;
const AUTO_REFRESH_INTERVAL = 15000; // 15秒

// 页面可见性追踪
let isPageVisible = true;
let lastRefreshTime = 0;

/**
 * 初始化页面可见性追踪
 */
export function initVisibilityTracking() {
  document.addEventListener('visibilitychange', () => {
    isPageVisible = !document.hidden;
    if (isPageVisible && isAutoRefreshEnabled) {
      // 页面变为可见时，如果距离上次刷新超过间隔时间，立即刷新
      const now = Date.now();
      if (now - lastRefreshTime > AUTO_REFRESH_INTERVAL) {
        triggerRefresh();
      }
    }
  });
}

/**
 * 触发刷新回调
 */
let refreshCallback = null;

/**
 * 设置刷新回调
 * @param {Function} callback - 刷新回调函数
 */
export function setRefreshCallback(callback) {
  refreshCallback = callback;
}

/**
 * 触发刷新
 */
async function triggerRefresh() {
  if (refreshCallback && isPageVisible) {
    lastRefreshTime = Date.now();
    try {
      await refreshCallback();
    } catch (e) {
      console.error('Auto refresh error:', e);
    }
  }
}

/**
 * 启动自动刷新
 * @param {Function} callback - 刷新回调函数
 */
export function startAutoRefresh(callback) {
  if (callback) {
    refreshCallback = callback;
  }
  
  stopAutoRefresh();
  isAutoRefreshEnabled = true;
  
  autoRefreshInterval = setInterval(() => {
    if (isPageVisible && isAutoRefreshEnabled) {
      triggerRefresh();
    }
  }, AUTO_REFRESH_INTERVAL);
}

/**
 * 停止自动刷新
 */
export function stopAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
}

/**
 * 暂停自动刷新
 */
export function pauseAutoRefresh() {
  isAutoRefreshEnabled = false;
}

/**
 * 恢复自动刷新
 */
export function resumeAutoRefresh() {
  isAutoRefreshEnabled = true;
}

/**
 * 检查是否正在自动刷新
 * @returns {boolean}
 */
export function isAutoRefreshing() {
  return autoRefreshInterval !== null && isAutoRefreshEnabled;
}

/**
 * 获取距离下次刷新的时间
 * @returns {number} 毫秒
 */
export function getTimeUntilNextRefresh() {
  const elapsed = Date.now() - lastRefreshTime;
  return Math.max(0, AUTO_REFRESH_INTERVAL - elapsed);
}

// 导出默认对象
export default {
  initVisibilityTracking,
  setRefreshCallback,
  startAutoRefresh,
  stopAutoRefresh,
  pauseAutoRefresh,
  resumeAutoRefresh,
  isAutoRefreshing,
  getTimeUntilNextRefresh
};
