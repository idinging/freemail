/**
 * 域名管理模块
 * @module modules/app/domains
 */

import { cacheGet, cacheSet, readPrefetch } from '../../storage.js';
import { isGuest } from './session.js';

// 域名列表
let domains = [];

// 存储键
export const STORAGE_KEYS = {
  domain: 'mailfree:lastDomain',
  length: 'mailfree:lastLen'
};

/**
 * 获取域名列表
 * @returns {Array}
 */
export function getDomains() {
  return domains;
}

/**
 * 设置域名列表
 * @param {Array} list - 域名列表
 */
export function setDomains(list) {
  domains = Array.isArray(list) ? list : [];
}

/**
 * 填充域名下拉框
 * @param {Array} domainList - 域名列表
 * @param {HTMLSelectElement} selectElement - 下拉框元素
 */
export function populateDomains(domainList, selectElement) {
  if (!selectElement) return;
  const list = Array.isArray(domainList) ? domainList : [];
  selectElement.innerHTML = list.map((d, i) => `<option value="${i}">${d}</option>`).join('');
  
  const stored = localStorage.getItem(STORAGE_KEYS.domain) || '';
  const idx = stored ? list.indexOf(stored) : -1;
  selectElement.selectedIndex = idx >= 0 ? idx : 0;
  
  selectElement.addEventListener('change', () => {
    const opt = selectElement.options[selectElement.selectedIndex];
    if (opt) localStorage.setItem(STORAGE_KEYS.domain, opt.textContent || '');
  }, { once: true });
  
  setDomains(list);
}

/**
 * 从 API 加载域名列表
 * @param {HTMLSelectElement} selectElement - 下拉框元素
 * @param {Function} api - API 函数
 */
export async function loadDomains(selectElement, api) {
  if (isGuest()) {
    populateDomains(['example.com'], selectElement);
    return;
  }
  
  let domainSet = false;
  
  // 尝试从缓存加载
  try {
    const cached = cacheGet('domains', 24 * 60 * 60 * 1000);
    if (Array.isArray(cached) && cached.length) {
      populateDomains(cached, selectElement);
      domainSet = true;
    }
  } catch(_) {}
  
  // 尝试从预取加载
  try {
    const prefetched = readPrefetch('mf:prefetch:domains');
    if (Array.isArray(prefetched) && prefetched.length) {
      populateDomains(prefetched, selectElement);
      domainSet = true;
    }
  } catch(_) {}
  
  // 从 API 加载
  try {
    const r = await api('/api/domains');
    const domainList = await r.json();
    if (Array.isArray(domainList) && domainList.length) {
      populateDomains(domainList, selectElement);
      cacheSet('domains', domainList);
      domainSet = true;
    }
  } catch(_) {}
  
  // 降级处理
  if (!domainSet) {
    const meta = (document.querySelector('meta[name="mail-domains"]')?.getAttribute('content') || '')
      .split(',').map(s => s.trim()).filter(Boolean);
    const fallback = [];
    if (window.currentMailbox && window.currentMailbox.includes('@')) {
      fallback.push(window.currentMailbox.split('@')[1]);
    }
    if (!meta.length && location.hostname) {
      fallback.push(location.hostname);
    }
    const list = [...new Set(meta.length ? meta : fallback)].filter(Boolean);
    populateDomains(list, selectElement);
  }
}

/**
 * 获取存储的长度
 * @returns {number}
 */
export function getStoredLength() {
  const stored = Number(localStorage.getItem(STORAGE_KEYS.length) || '8');
  return Math.max(8, Math.min(30, isNaN(stored) ? 8 : stored));
}

/**
 * 保存长度
 * @param {number} length - 长度
 */
export function saveLength(length) {
  const clamped = Math.max(8, Math.min(30, isNaN(length) ? 8 : length));
  localStorage.setItem(STORAGE_KEYS.length, String(clamped));
}

/**
 * 获取选中的域名索引
 * @param {HTMLSelectElement} selectElement - 下拉框元素
 * @returns {number}
 */
export function getSelectedDomainIndex(selectElement) {
  return Number(selectElement?.value || 0);
}

/**
 * 更新范围滑块进度
 * @param {HTMLInputElement} input - 滑块元素
 */
export function updateRangeProgress(input) {
  if (!input) return;
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const val = Number(input.value || min);
  const percent = ((val - min) * 100) / (max - min);
  input.style.background = `linear-gradient(to right, var(--primary) ${percent}%, var(--border-light) ${percent}%)`;
}

export default {
  getDomains,
  setDomains,
  populateDomains,
  loadDomains,
  getStoredLength,
  saveLength,
  getSelectedDomainIndex,
  updateRangeProgress,
  STORAGE_KEYS
};
