import { generateRandomId } from './commonUtils.js';

function formatTs(dateMs) {
  return new Date(dateMs).toISOString().replace('T', ' ').slice(0, 19);
}

export function buildMockEmails(count = 6) {
  const now = Date.now();
  const templates = [
    (code) => `您的验证码为 ${code}，5 分钟内有效`,
    (code) => `Your verification code is ${code}. It expires in 5 minutes`,
    (code) => `One-time code: ${code}`,
    (code) => `安全验证 · 验证码 ${code}`,
    (code) => `Login code is ${code}`,
  ];
  return Array.from({ length: count }).map((_, i) => {
    const id = 10000 + i;
    const code = (Math.abs((id * 7919) % 900000) + 100000).toString().slice(0, 6);
    const subject = templates[i % templates.length](code);
    const content = `您好，您正在体验演示模式。验证码: ${code} ，请在 5 分钟内完成验证。If you did not request it, please ignore.`;
    const html_content = `<p>您好，您正在体验 <strong>演示模式</strong>。</p><p><strong>验证码: ${code}</strong></p><p>请在 5 分钟内完成验证。</p>`;
    return {
      id,
      sender: `demo${i}@example.com`,
      subject,
      received_at: formatTs(now - i * 600000),
      is_read: i > 1,
      content,
      html_content,
    };
  });
}

export function buildMockMailboxes(limit = 10, offset = 0, mailDomains = []) {
  const domains = Array.isArray(mailDomains) ? mailDomains : [mailDomains].filter(Boolean);
  const now = Date.now();
  const size = Math.min(limit, 10);
  return Array.from({ length: size }).map((_, i) => ({
    address: `${generateRandomId(10)}@${domains.length ? domains[(offset + i) % domains.length] : 'example.com'}`,
    created_at: formatTs(now - (offset + i) * 3600000),
    is_pinned: i < 2 ? 1 : 0, // 前两个邮箱设为置顶
    password_is_default: i % 3 === 0 ? 1 : 0, // 每三个邮箱有一个是默认密码
    can_login: i < 5 ? 1 : 0, // 前五个邮箱允许登录
  }));
}

export function buildMockEmailDetail(id = 10000) {
  const code = (Math.abs((Number(id) * 7919) % 900000) + 100000).toString().slice(0, 6);
  return {
    id: Number(id) || 10000,
    sender: 'noreply@example.com',
    subject: `演示邮件内容（验证码 ${code}）`,
    received_at: formatTs(Date.now()),
    content: `这是演示模式下的邮件内容，仅用于展示界面效果。验证码：${code}`,
    html_content: `<p><strong>演示模式</strong>：该内容为模拟数据。</p><p>验证码：<strong>${code}</strong></p>`,
  };
}


