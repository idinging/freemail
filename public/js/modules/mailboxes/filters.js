/**
 * 邮箱筛选模块
 * @module modules/mailboxes/filters
 */

/**
 * 筛选状态
 */
export const filterState = {
  domain: '',
  favorite: '',
  forward: '',
  login: '',
  search: ''
};

/**
 * 更新筛选状态
 * @param {string} key - 筛选键
 * @param {string} value - 筛选值
 */
export function updateFilter(key, value) {
  if (key in filterState) {
    filterState[key] = value;
  }
}

/**
 * 重置所有筛选
 */
export function resetFilters() {
  filterState.domain = '';
  filterState.favorite = '';
  filterState.forward = '';
  filterState.login = '';
  filterState.search = '';
}

/**
 * 获取当前筛选参数
 * @returns {object}
 */
export function getFilterParams() {
  const params = {};
  
  if (filterState.domain) {
    params.domain = filterState.domain;
  }
  if (filterState.favorite) {
    params.favorite = filterState.favorite;
  }
  if (filterState.forward) {
    params.forward = filterState.forward;
  }
  if (filterState.login) {
    params.login = filterState.login;
  }
  
  return params;
}

/**
 * 应用本地搜索筛选
 * @param {Array} mailboxes - 邮箱列表
 * @param {string} searchTerm - 搜索词
 * @returns {Array}
 */
export function applyLocalSearch(mailboxes, searchTerm) {
  if (!searchTerm) return mailboxes;
  
  const term = searchTerm.toLowerCase().trim();
  return mailboxes.filter(m => {
    const address = (m.address || '').toLowerCase();
    return address.includes(term);
  });
}

/**
 * 应用本地筛选
 * @param {Array} mailboxes - 邮箱列表
 * @param {object} filters - 筛选条件
 * @returns {Array}
 */
export function applyLocalFilters(mailboxes, filters = {}) {
  let result = [...mailboxes];
  
  // 域名筛选
  if (filters.domain) {
    result = result.filter(m => {
      const domain = (m.address || '').split('@')[1] || '';
      return domain === filters.domain;
    });
  }
  
  // 收藏筛选
  if (filters.favorite === 'true' || filters.favorite === '1') {
    result = result.filter(m => m.is_favorite);
  } else if (filters.favorite === 'false' || filters.favorite === '0') {
    result = result.filter(m => !m.is_favorite);
  }
  
  // 转发筛选
  if (filters.forward === 'true' || filters.forward === '1') {
    result = result.filter(m => m.forward_to);
  } else if (filters.forward === 'false' || filters.forward === '0') {
    result = result.filter(m => !m.forward_to);
  }
  
  // 登录筛选
  if (filters.login === 'true' || filters.login === '1') {
    result = result.filter(m => m.can_login);
  } else if (filters.login === 'false' || filters.login === '0') {
    result = result.filter(m => !m.can_login);
  }
  
  return result;
}

/**
 * 排序邮箱列表
 * @param {Array} mailboxes - 邮箱列表
 * @param {string} sortBy - 排序字段
 * @param {string} sortOrder - 排序顺序 'asc' | 'desc'
 * @returns {Array}
 */
export function sortMailboxes(mailboxes, sortBy = 'created_at', sortOrder = 'desc') {
  const result = [...mailboxes];
  
  result.sort((a, b) => {
    // 置顶的始终在前
    if (a.is_pinned !== b.is_pinned) {
      return (b.is_pinned || 0) - (a.is_pinned || 0);
    }
    
    // 按指定字段排序
    let valueA, valueB;
    
    switch (sortBy) {
      case 'address':
        valueA = (a.address || '').toLowerCase();
        valueB = (b.address || '').toLowerCase();
        break;
      case 'created_at':
      default:
        valueA = new Date(a.created_at || 0);
        valueB = new Date(b.created_at || 0);
        break;
    }
    
    if (sortOrder === 'asc') {
      return valueA > valueB ? 1 : valueA < valueB ? -1 : 0;
    } else {
      return valueA < valueB ? 1 : valueA > valueB ? -1 : 0;
    }
  });
  
  return result;
}

/**
 * 初始化筛选器 UI
 * @param {object} elements - DOM 元素引用
 * @param {Function} onFilterChange - 筛选变化回调
 */
export function initFilterUI(elements, onFilterChange) {
  const { domainFilter, favoriteFilter, forwardFilter, loginFilter, searchInput } = elements;
  
  // 域名筛选
  if (domainFilter) {
    domainFilter.addEventListener('change', () => {
      updateFilter('domain', domainFilter.value);
      if (onFilterChange) onFilterChange();
    });
  }
  
  // 收藏筛选
  if (favoriteFilter) {
    favoriteFilter.addEventListener('change', () => {
      updateFilter('favorite', favoriteFilter.value);
      if (onFilterChange) onFilterChange();
    });
  }
  
  // 转发筛选
  if (forwardFilter) {
    forwardFilter.addEventListener('change', () => {
      updateFilter('forward', forwardFilter.value);
      if (onFilterChange) onFilterChange();
    });
  }
  
  // 登录筛选
  if (loginFilter) {
    loginFilter.addEventListener('change', () => {
      updateFilter('login', loginFilter.value);
      if (onFilterChange) onFilterChange();
    });
  }
  
  // 搜索
  if (searchInput) {
    let searchTimeout = null;
    searchInput.addEventListener('input', () => {
      if (searchTimeout) clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        updateFilter('search', searchInput.value);
        if (onFilterChange) onFilterChange();
      }, 300);
    });
  }
}

// 导出默认对象
export default {
  filterState,
  updateFilter,
  resetFilters,
  getFilterParams,
  applyLocalSearch,
  applyLocalFilters,
  sortMailboxes,
  initFilterUI
};
