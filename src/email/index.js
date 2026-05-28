/**
 * 邮件模块统一导出
 * @module email
 */

export { parseEmailBody, extractVerificationCode } from './parser.js';
export { forwardByLocalPart, forwardByMailboxConfig } from './forwarder.js';

// 渠道分发器（从 providers/index.js 转发）
export {
  sendEmailAuto,
  sendBatchAuto,
  resolveProvider,
  parseProviderConfig,
  getConfiguredDomains,
  resend,
  sendflare
} from './providers/index.js';
