/**
 * 邮件模块统一导出
 * @module email
 */

export { parseEmailBody, extractVerificationCode } from './parser.js';
export {
  sendEmailWithResend,
  sendEmailWithAutoResend,
  sendBatchWithResend,
  sendBatchWithAutoResend,
  getEmailFromResend,
  updateEmailInResend,
  cancelEmailInResend,
  selectApiKeyForDomain,
  getConfiguredDomains
} from './sender.js';
export { forwardByLocalPart, forwardByMailboxConfig } from './forwarder.js';
export { handleEmailReceive } from './receiver.js';
