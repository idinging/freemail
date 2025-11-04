/**
 * 邮箱状态管理模块
 * @module modules/app/mailbox-state
 */

import { getCurrentUserKey } from '../../storage.js';

// 当前邮箱
let currentMailbox = '';

// 当前邮箱信息
let currentMailboxInfo = null;

/**
 * 获取当前邮箱
 * @returns {string}
 */
export function getCurrentMailbox() {
  return currentMailbox;
}

/**
 * 设置当前邮箱
 * @param {string} mailbox - 邮箱地址
 */
export function setCurrentMailbox(mailbox) {
  currentMailbox = mailbox || '';
  window.currentMailbox = currentMailbox;
  saveCurrentMailbox(currentMailbox);
}

/**
 * 获取当前邮箱信息
 * @returns {object|null}
 */
export function getCurrentMailboxInfo() {
  return currentMailboxInfo;
}

/**
 * 设置当前邮箱信息
 * @param {object} info - 邮箱信息
 */
export function setCurrentMailboxInfo(info) {
  currentMailboxInfo = info;
}

/**
 * 保存当前邮箱到本地存储（用户隔离）
 * @param {string} mailbox - 邮箱地址
 */
export function saveCurrentMailbox(mailbox) {
  try {
    const userKey = getCurrentUserKey();
    if (userKey && userKey !== 'unknown') {
      sessionStorage.setItem(`mf:currentMailbox:${userKey}`, mailbox);
    }
  } catch(_) {}
}

/**
 * 从本地存储加载当前邮箱
 * @returns {string|null}
 */
export function loadCurrentMailbox() {
  try {
    const userKey = getCurrentUserKey();
    if (userKey && userKey !== 'unknown') {
      return sessionStorage.getItem(`mf:currentMailbox:${userKey}`);
    }
  } catch(_) {}
  return null;
}

/**
 * 清除当前邮箱状态
 */
export function clearCurrentMailbox() {
  currentMailbox = '';
  currentMailboxInfo = null;
  window.currentMailbox = '';
  try {
    const userKey = getCurrentUserKey();
    if (userKey && userKey !== 'unknown') {
      sessionStorage.removeItem(`mf:currentMailbox:${userKey}`);
    }
    sessionStorage.removeItem('mf:currentMailbox');
  } catch(_) {}
}

// 初始化全局变量
window.currentMailbox = currentMailbox;

export default {
  getCurrentMailbox,
  setCurrentMailbox,
  getCurrentMailboxInfo,
  setCurrentMailboxInfo,
  saveCurrentMailbox,
  loadCurrentMailbox,
  clearCurrentMailbox
};
