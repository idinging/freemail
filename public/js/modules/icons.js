/**
 * SVG 图标辅助模块
 * 用于替代 emoji 图标，提供统一的 SVG 图标渲染接口
 */

const IconHelper = {
  /**
   * 获取 SVG 图标 HTML
   * @param {string} iconId - 图标 ID（如 'icon-mail', 'icon-copy'）
   * @param {number} width - 宽度（默认 18）
   * @param {number} height - 高度（默认 18）
   * @param {string} className - CSS 类名（可选）
   * @returns {string} SVG HTML 字符串
   */
  getIcon(iconId, width = 18, height = 18, className = '') {
    return `<svg width="${width}" height="${height}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${className}">
      <use href="/icons/sprites.svg#${iconId}"/>
    </svg>`;
  },

  /**
   * 常用图标快捷方法
   */
  mail(w = 18, h = 18) { return this.getIcon('icon-mail', w, h); },
  copy(w = 18, h = 18) { return this.getIcon('icon-copy', w, h); },
  trash(w = 18, h = 18) { return this.getIcon('icon-trash', w, h); },
  refresh(w = 18, h = 18) { return this.getIcon('icon-refresh', w, h); },
  forward(w = 18, h = 18) { return this.getIcon('icon-forward', w, h); },
  star(w = 18, h = 18, filled = false) { return this.getIcon(filled ? 'icon-star' : 'icon-star-empty', w, h); },
  pin(w = 18, h = 18) { return this.getIcon('icon-pin', w, h); },
  send(w = 18, h = 18) { return this.getIcon('icon-send', w, h); },
  inbox(w = 18, h = 18) { return this.getIcon('icon-inbox', w, h); },
  user(w = 18, h = 18) { return this.getIcon('icon-user', w, h); },
  dice(w = 18, h = 18) { return this.getIcon('icon-dice', w, h); },
  settings(w = 18, h = 18) { return this.getIcon('icon-settings', w, h); },
  globe(w = 18, h = 18) { return this.getIcon('icon-globe', w, h); },
  ruler(w = 18, h = 18) { return this.getIcon('icon-ruler', w, h); },
  x(w = 18, h = 18) { return this.getIcon('icon-x', w, h); },
  alert(w = 18, h = 18) { return this.getIcon('icon-alert', w, h); },
  chevronLeft(w = 16, h = 16) { return this.getIcon('icon-chevron-left', w, h); },
  chevronDown(w = 16, h = 16) { return this.getIcon('icon-chevron-down', w, h); },

  /**
   * 创建带 icon 的按钮 HTML
   * @param {string} text - 按钮文本
   * @param {string} iconId - 图标 ID
   * @param {string} btnClass - 按钮类名（默认 'btn btn-ghost'）
   * @param {string} extraAttrs - 额外属性（如 aria-label）
   * @returns {string} 按钮 HTML
   */
  button(text, iconId, btnClass = 'btn btn-ghost', extraAttrs = '') {
    return `<button class="${btnClass}" ${extraAttrs}>
      <span class="btn-icon">${this.getIcon(iconId)}</span>
      <span>${text}</span>
    </button>`;
  },

  /**
   * 创建带 icon 的链接 HTML
   * @param {string} text - 链接文本
   * @param {string} iconId - 图标 ID
   * @param {string} href - 链接地址
   * @param {string} linkClass - 链接类名（默认 'btn btn-ghost'）
   * @param {string} extraAttrs - 额外属性
   * @returns {string} 链接 HTML
   */
  link(text, iconId, href, linkClass = 'btn btn-ghost', extraAttrs = '') {
    return `<a class="${linkClass}" href="${href}" ${extraAttrs}>
      <span class="btn-icon">${this.getIcon(iconId)}</span>
      <span class="btn-text">${text}</span>
    </a>`;
  }
};

// 导出到全局（兼容非模块化代码）
if (typeof window !== 'undefined') {
  window.IconHelper = IconHelper;
}

// ES Module 导出
export default IconHelper;