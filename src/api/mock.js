/**
 * 演示模式数据模块
 * @module api/mock
 */

// 演示模式邮箱域名
export const MOCK_DOMAINS = ['exa.cc', 'exr.yp', 'duio.ty'];

/**
 * 初始化演示模式用户数据
 */
export function initMockUsers() {
  if (!globalThis.__MOCK_USERS__) {
    const now = new Date();
    globalThis.__MOCK_USERS__ = [
      { id: 1, username: 'demo1', role: 'user', can_send: 0, mailbox_limit: 5, created_at: now.toISOString().replace('T', ' ').slice(0, 19) },
      { id: 2, username: 'demo2', role: 'user', can_send: 0, mailbox_limit: 8, created_at: now.toISOString().replace('T', ' ').slice(0, 19) },
      { id: 3, username: 'operator', role: 'admin', can_send: 0, mailbox_limit: 20, created_at: now.toISOString().replace('T', ' ').slice(0, 19) },
    ];
    globalThis.__MOCK_USER_MAILBOXES__ = new Map();
    
    // 为每个演示用户预生成若干邮箱
    try {
      for (const u of globalThis.__MOCK_USERS__) {
        const maxCount = Math.min(u.mailbox_limit || 10, 8);
        const minCount = Math.min(3, maxCount);
        const count = Math.max(minCount, Math.min(maxCount, Math.floor(Math.random() * (maxCount - minCount + 1)) + minCount));
        const boxes = buildMockMailboxes(count, 0, MOCK_DOMAINS);
        globalThis.__MOCK_USER_MAILBOXES__.set(u.id, boxes);
      }
    } catch (_) {
      // 忽略演示数据预生成失败
    }
    globalThis.__MOCK_USER_LAST_ID__ = 3;
  }
}

/**
 * 生成模拟邮件列表
 * @param {number} count - 邮件数量
 * @returns {Array<object>} 模拟邮件列表
 */
export function buildMockEmails(count = 5) {
  const senders = ['support@example.com', 'noreply@service.com', 'admin@mock.test'];
  const subjects = [
    '[演示数据] 欢迎使用临时邮箱',
    '[演示数据] 您的验证码是 123456',
    '[演示数据] 订单已发货',
    '[演示数据] 密码重置请求',
    '[演示数据] 账户安全提醒'
  ];
  const previews = [
    '这是一封演示邮件，用于展示系统功能...',
    '您的验证码是 123456，请在5分钟内使用...',
    '您的订单已发货，预计3-5天送达...',
    '您请求重置密码，请点击链接...',
    '检测到您的账户有异常登录...'
  ];
  
  const emails = [];
  const now = Date.now();
  
  for (let i = 0; i < count; i++) {
    emails.push({
      id: 1000 + i,
      sender: senders[i % senders.length],
      subject: subjects[i % subjects.length],
      received_at: new Date(now - i * 3600000).toISOString(),
      is_read: i > 2 ? 1 : 0,
      preview: previews[i % previews.length],
      verification_code: i === 1 ? '123456' : null
    });
  }
  
  return emails;
}

/**
 * 生成模拟邮箱列表
 * @param {number} count - 邮箱数量
 * @param {number} offset - 偏移量
 * @param {Array<string>} domains - 域名列表
 * @returns {Array<object>} 模拟邮箱列表
 */
export function buildMockMailboxes(count = 5, offset = 0, domains = MOCK_DOMAINS) {
  const mailboxes = [];
  const now = Date.now();
  
  for (let i = 0; i < count; i++) {
    const idx = offset + i;
    const domain = domains[idx % domains.length];
    const local = `demo${String(idx + 1).padStart(3, '0')}`;
    
    mailboxes.push({
      id: 2000 + idx,
      address: `${local}@${domain}`,
      created_at: new Date(now - idx * 86400000).toISOString().replace('T', ' ').slice(0, 19),
      is_pinned: idx < 2 ? 1 : 0,
      password_is_default: 1,
      can_login: 0,
      forward_to: null,
      is_favorite: idx < 1 ? 1 : 0
    });
  }
  
  return mailboxes;
}

/**
 * 生成模拟邮件详情
 * @param {number|string} emailId - 邮件ID
 * @returns {object} 模拟邮件详情
 */
export function buildMockEmailDetail(emailId) {
  return {
    id: Number(emailId),
    sender: 'support@example.com',
    to_addrs: 'demo@exa.cc',
    subject: '[演示数据] 这是一封演示邮件',
    verification_code: '123456',
    preview: '这是演示邮件的内容预览...',
    content: '这是演示邮件的纯文本内容。\n\n您的验证码是：123456\n\n请在5分钟内使用。',
    html_content: '<div style="padding:20px;"><h2>演示邮件</h2><p>您的验证码是：<strong>123456</strong></p><p>请在5分钟内使用。</p></div>',
    received_at: new Date().toISOString(),
    is_read: 1,
    r2_bucket: null,
    r2_object_key: null
  };
}
