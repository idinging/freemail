/**
 * 骨架屏组件模块
 * @module components/skeleton
 */

/**
 * 生成骨架屏卡片
 * @returns {string} HTML 字符串
 */
export function createSkeletonCard() {
  return `
    <div class="skeleton-card">
      <div class="skeleton-line title"></div>
      <div class="skeleton-line subtitle"></div>
      <div class="skeleton-line text"></div>
      <div class="skeleton-line time"></div>
    </div>
  `;
}

/**
 * 生成骨架屏列表项
 * @returns {string} HTML 字符串
 */
export function createSkeletonListItem() {
  return `
    <div class="skeleton-list-item">
      <div class="skeleton-line skeleton-pin"></div>
      <div class="skeleton-content">
        <div class="skeleton-line title"></div>
        <div class="skeleton-line subtitle"></div>
      </div>
      <div class="skeleton-actions">
        <div class="skeleton-line"></div>
        <div class="skeleton-line"></div>
        <div class="skeleton-line"></div>
        <div class="skeleton-line"></div>
      </div>
    </div>
  `;
}

/**
 * 生成骨架屏邮件项
 * @returns {string} HTML 字符串
 */
export function createSkeletonEmailItem() {
  return `
    <div class="skeleton-email-item">
      <div class="skeleton-avatar"></div>
      <div class="skeleton-content">
        <div class="skeleton-line sender"></div>
        <div class="skeleton-line subject"></div>
        <div class="skeleton-line preview"></div>
      </div>
      <div class="skeleton-time"></div>
    </div>
  `;
}

/**
 * 生成骨架屏邮件详情
 * @returns {string} HTML 字符串
 */
export function createSkeletonEmailDetail() {
  return `
    <div class="skeleton-email-detail">
      <div class="skeleton-header">
        <div class="skeleton-line subject-line"></div>
        <div class="skeleton-meta">
          <div class="skeleton-line from-line"></div>
          <div class="skeleton-line date-line"></div>
        </div>
      </div>
      <div class="skeleton-body">
        <div class="skeleton-line"></div>
        <div class="skeleton-line"></div>
        <div class="skeleton-line"></div>
        <div class="skeleton-line short"></div>
      </div>
    </div>
  `;
}

/**
 * 生成骨架屏表格行
 * @param {number} cols - 列数
 * @returns {string} HTML 字符串
 */
export function createSkeletonTableRow(cols = 5) {
  const cells = Array(cols).fill('<td><div class="skeleton-line"></div></td>').join('');
  return `<tr class="skeleton-row">${cells}</tr>`;
}

/**
 * 生成多个骨架屏元素
 * @param {string} type - 类型：'card', 'list', 'email', 'table'
 * @param {number} count - 数量
 * @param {object} options - 选项
 * @returns {string} HTML 字符串
 */
export function generateSkeleton(type = 'card', count = 4, options = {}) {
  const generators = {
    card: createSkeletonCard,
    list: createSkeletonListItem,
    email: createSkeletonEmailItem,
    emailDetail: createSkeletonEmailDetail,
    table: () => createSkeletonTableRow(options.cols || 5)
  };
  
  const generator = generators[type] || generators.card;
  return Array(count).fill(null).map(() => generator()).join('');
}

/**
 * 显示骨架屏
 * @param {HTMLElement} container - 容器元素
 * @param {string} type - 类型
 * @param {number} count - 数量
 * @param {object} options - 选项
 */
export function showSkeleton(container, type = 'card', count = 4, options = {}) {
  if (!container) return;
  container.innerHTML = generateSkeleton(type, count, options);
  container.classList.add('skeleton-loading');
}

/**
 * 隐藏骨架屏
 * @param {HTMLElement} container - 容器元素
 */
export function hideSkeleton(container) {
  if (!container) return;
  container.classList.remove('skeleton-loading');
}

/**
 * 注入骨架屏样式
 */
export function injectSkeletonStyles() {
  if (document.getElementById('skeleton-styles')) return;
  
  const style = document.createElement('style');
  style.id = 'skeleton-styles';
  style.textContent = `
    .skeleton-loading {
      pointer-events: none;
    }
    
    .skeleton-card,
    .skeleton-list-item,
    .skeleton-email-item,
    .skeleton-email-detail {
      padding: 16px;
      background: #fff;
      border-radius: 8px;
      margin-bottom: 12px;
    }
    
    .skeleton-line {
      height: 16px;
      background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
      background-size: 200% 100%;
      animation: skeleton-loading 1.5s infinite;
      border-radius: 4px;
      margin-bottom: 8px;
    }
    
    .skeleton-line.title {
      width: 60%;
      height: 20px;
    }
    
    .skeleton-line.subtitle {
      width: 80%;
    }
    
    .skeleton-line.text {
      width: 100%;
    }
    
    .skeleton-line.time {
      width: 40%;
      height: 12px;
    }
    
    .skeleton-line.short {
      width: 50%;
    }
    
    .skeleton-avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
      background-size: 200% 100%;
      animation: skeleton-loading 1.5s infinite;
    }
    
    .skeleton-content {
      flex: 1;
    }
    
    .skeleton-row td {
      padding: 12px;
    }
    
    @keyframes skeleton-loading {
      0% {
        background-position: 200% 0;
      }
      100% {
        background-position: -200% 0;
      }
    }
  `;
  
  document.head.appendChild(style);
}

// 自动注入样式
if (typeof document !== 'undefined') {
  injectSkeletonStyles();
}

// 导出默认对象
export default {
  createSkeletonCard,
  createSkeletonListItem,
  createSkeletonEmailItem,
  createSkeletonEmailDetail,
  createSkeletonTableRow,
  generateSkeleton,
  showSkeleton,
  hideSkeleton,
  injectSkeletonStyles
};
