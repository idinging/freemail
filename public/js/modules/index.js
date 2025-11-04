/**
 * 模块总入口
 * @module modules
 */

// 导出所有模块
export * as app from './app/index.js';
export * as mailboxes from './mailboxes/index.js';
export * as admin from './admin/index.js';
export * as mailbox from './mailbox/index.js';

// 导入并重新导出默认对象
import * as appModule from './app/index.js';
import * as mailboxesModule from './mailboxes/index.js';
import * as adminModule from './admin/index.js';
import * as mailboxModule from './mailbox/index.js';

export default {
  app: appModule,
  mailboxes: mailboxesModule,
  admin: adminModule,
  mailbox: mailboxModule
};
