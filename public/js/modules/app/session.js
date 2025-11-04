/**
 * 会话管理模块
 * @module modules/app/session
 */

import { cacheGet, cacheSet, setCurrentUserKey } from '../../storage.js';

// 会话状态
let sessionData = null;
let isGuestMode = false;

/**
 * 获取会话数据
 * @returns {object|null}
 */
export function getSession() {
  return sessionData;
}

/**
 * 设置会话数据
 * @param {object} data - 会话数据
 */
export function setSession(data) {
  sessionData = data;
  if (data) {
    isGuestMode = data.role === 'guest';
    window.__GUEST_MODE__ = isGuestMode;
  }
}

/**
 * 检查是否为访客模式
 * @returns {boolean}
 */
export function isGuest() {
  return isGuestMode;
}

/**
 * 检查是否为管理员
 * @returns {boolean}
 */
export function isAdmin() {
  return sessionData?.strictAdmin || sessionData?.role === 'admin';
}

/**
 * 检查是否为严格管理员
 * @returns {boolean}
 */
export function isStrictAdmin() {
  return sessionData?.strictAdmin === true;
}

/**
 * 应用会话 UI
 * @param {object} session - 会话数据
 */
export function applySessionUI(session) {
  try {
    const badge = document.getElementById('role-badge');
    if (badge) {
      badge.className = 'role-badge';
      if (session.strictAdmin) {
        badge.classList.add('role-super');
        badge.textContent = '超级管理员';
      } else if (session.role === 'admin') {
        badge.classList.add('role-admin');
        badge.textContent = `高级用户：${session.username || ''}`;
      } else if (session.role === 'user') {
        badge.classList.add('role-user');
        badge.textContent = `用户：${session.username || ''}`;
      } else if (session.role === 'guest') {
        badge.classList.add('role-user');
        badge.textContent = '演示模式';
      }
    }
    
    const adminLink = document.getElementById('admin');
    const allMailboxesLink = document.getElementById('all-mailboxes');
    
    if (session && (session.strictAdmin || session.role === 'guest')) {
      if (adminLink) adminLink.style.display = 'inline-flex';
      if (allMailboxesLink) allMailboxesLink.style.display = 'inline-flex';
    } else {
      if (adminLink) adminLink.style.display = 'none';
      if (allMailboxesLink) allMailboxesLink.style.display = 'none';
    }
  } catch(_) {}
}

/**
 * 初始化会话（从缓存）
 */
export function initSessionFromCache() {
  try {
    const cachedS = cacheGet('session', 24 * 60 * 60 * 1000);
    if (cachedS) {
      setCurrentUserKey(`${cachedS.role || ''}:${cachedS.username || ''}`);
      applySessionUI(cachedS);
      setSession(cachedS);
    }
  } catch(_) {}
}

/**
 * 验证会话
 * @returns {Promise<object|null>}
 */
export async function validateSession() {
  try {
    const r = await fetch('/api/session');
    if (!r.ok) {
      return null;
    }
    const s = await r.json();
    cacheSet('session', s);
    setCurrentUserKey(`${s.role || ''}:${s.username || ''}`);
    setSession(s);
    applySessionUI(s);
    return s;
  } catch(_) {
    return null;
  }
}

/**
 * 显示访客模式横幅
 */
export function showGuestBanner() {
  const bar = document.createElement('div');
  bar.className = 'demo-banner';
  bar.innerHTML = '👀 当前为 <strong>观看模式</strong>（模拟数据，仅演示）。要接收真实邮件，请自建部署或联系部署。';
  document.body.prepend(bar);
}

/**
 * 初始化访客模式
 */
export function initGuestMode() {
  window.__GUEST_MODE__ = true;
  window.__MOCK_STATE__ = { domains: ['example.com'], mailboxes: [], emailsByMailbox: new Map() };
  showGuestBanner();
}

export default {
  getSession,
  setSession,
  isGuest,
  isAdmin,
  isStrictAdmin,
  applySessionUI,
  initSessionFromCache,
  validateSession,
  showGuestBanner,
  initGuestMode
};
