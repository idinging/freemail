/**
 * Admin 模块入口
 * @module modules/admin
 */

export * from './user-list.js';
export * from './user-edit.js';
export * from './api.js';

// 导入并重新导出默认对象
import userList from './user-list.js';
import userEdit from './user-edit.js';
import apiModule from './api.js';

export {
  userList,
  userEdit,
  apiModule
};
