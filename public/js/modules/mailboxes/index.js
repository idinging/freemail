/**
 * Mailboxes 模块入口
 * @module modules/mailboxes
 */

export * from './grid-view.js';
export * from './list-view.js';
export * from './filters.js';
export * from './api.js';
export * from './render.js';

// 导入并重新导出默认对象
import gridView from './grid-view.js';
import listView from './list-view.js';
import filters from './filters.js';
import apiModule from './api.js';
import render from './render.js';

export {
  gridView,
  listView,
  filters,
  apiModule,
  render
};
