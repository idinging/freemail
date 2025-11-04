/**
 * 组件模块入口
 * @module components
 */

export * from './modal.js';
export * from './skeleton.js';
export * from './toast.js';

// 导入并重新导出默认对象
import modal from './modal.js';
import skeleton from './skeleton.js';
import toast from './toast.js';

export {
  modal,
  skeleton,
  toast
};
