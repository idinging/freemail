/**
 * Mailbox 模块入口
 * @module modules/mailbox
 */

export * from './email-list.js';
export * from './email-detail.js';

// 导入并重新导出默认对象
import emailList from './email-list.js';
import emailDetail from './email-detail.js';

export {
  emailList,
  emailDetail
};
