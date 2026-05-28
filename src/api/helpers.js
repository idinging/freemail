/**
 * API 辅助函数模块
 * @module api/helpers
 */

import { sha256Hex } from '../utils/common.js';
import { hashPassword } from '../middleware/auth.js';

/**
 * 从请求中提取 JWT 载荷
 * @param {Request} request - HTTP 请求对象
 * @param {object} options - 选项对象
 * @returns {object|null} JWT 载荷或 null
 */
export function getJwtPayload(request, options = {}) {
  // 优先使用服务端传入的已解析身份（支持 __root__ 超管）
  if (options && options.authPayload) return options.authPayload;
  try {
    const cookie = request.headers.get('Cookie') || '';
    const token = (cookie.split(';').find(s => s.trim().startsWith('iding-session=')) || '').split('=')[1] || '';
    const parts = token.split('.');
    if (parts.length === 3) {
      const json = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
      return JSON.parse(json);
    }
  } catch (_) { }
  return null;
}

/**
 * 检查是否为严格管理员
 * @param {Request} request - HTTP 请求对象
 * @param {object} options - 选项对象
 * @returns {boolean} 是否为严格管理员
 */
export function isStrictAdmin(request, options = {}) {
  const p = getJwtPayload(request, options);
  if (!p) return false;
  if (p.role !== 'admin') return false;
  // __root__（根管理员）视为严格管理员
  if (String(p.username || '') === '__root__') return true;
  if (options?.adminName) {
    return String(p.username || '').toLowerCase() === String(options.adminName || '').toLowerCase();
  }
  return true;
}

/**
 * 创建标准 JSON 响应
 * @param {any} data - 响应数据
 * @param {number} status - HTTP 状态码
 * @returns {Response} HTTP 响应对象
 */
export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * 创建错误响应
 * @param {string} message - 错误消息
 * @param {number} status - HTTP 状态码
 * @returns {Response} HTTP 响应对象
 */
export function errorResponse(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * 规范化邮箱地址，兼容 "Name <user@example.com>" 格式。
 */
export function normalizeEmailAddress(address) {
  const s = String(address || '').trim().toLowerCase();
  const m = s.match(/<([^>]+)>/);
  return (m ? m[1] : s).trim();
}

/**
 * 提取当前请求身份，并统一计算严格管理员和邮箱登录身份。
 */
export function getAuthContext(request, options = {}) {
  const payload = getJwtPayload(request, options) || {};
  return {
    payload,
    strictAdmin: isStrictAdmin(request, options),
    role: payload.role || '',
    userId: Number(payload.userId || 0),
    mailboxId: Number(payload.mailboxId || 0),
    mailboxAddress: normalizeEmailAddress(payload.mailboxAddress || '')
  };
}

/**
 * 校验当前身份是否能访问指定邮箱。
 */
export async function getMailboxAccess(db, request, options = {}, { mailboxId = null, address = '' } = {}) {
  const ctx = getAuthContext(request, options);
  let mailbox = null;

  if (mailboxId) {
    mailbox = await db.prepare('SELECT id, address FROM mailboxes WHERE id = ? LIMIT 1')
      .bind(Number(mailboxId)).first();
  } else {
    const normalized = normalizeEmailAddress(address);
    if (normalized) {
      mailbox = await db.prepare('SELECT id, address FROM mailboxes WHERE address = ? LIMIT 1')
        .bind(normalized).first();
    }
  }

  if (!mailbox) {
    return { exists: false, allowed: false, mailbox: null };
  }

  if (ctx.strictAdmin) {
    return { exists: true, allowed: true, mailbox };
  }

  if (ctx.role === 'mailbox') {
    const sameId = ctx.mailboxId && Number(mailbox.id) === ctx.mailboxId;
    const sameAddress = ctx.mailboxAddress && normalizeEmailAddress(mailbox.address) === ctx.mailboxAddress;
    return { exists: true, allowed: !!(sameId || sameAddress), mailbox };
  }

  if (ctx.userId) {
    const own = await db.prepare(
      'SELECT 1 FROM user_mailboxes WHERE user_id = ? AND mailbox_id = ? LIMIT 1'
    ).bind(ctx.userId, Number(mailbox.id)).first();
    return { exists: true, allowed: !!own, mailbox };
  }

  return { exists: true, allowed: false, mailbox };
}

/**
 * 校验当前身份是否能访问指定邮件。
 */
export async function getMessageAccess(db, request, options = {}, messageId) {
  const id = Number(messageId || 0);
  if (!id) return { exists: false, allowed: false, message: null };

  const message = await db.prepare('SELECT id, mailbox_id FROM messages WHERE id = ? LIMIT 1')
    .bind(id).first();
  if (!message) return { exists: false, allowed: false, message: null };

  const access = await getMailboxAccess(db, request, options, { mailboxId: message.mailbox_id });
  return { exists: true, allowed: access.allowed, message, mailbox: access.mailbox };
}

/**
 * 校验当前身份是否能访问指定发件记录。
 */
export async function getSentEmailAccess(db, request, options = {}, identifier, by = 'id') {
  const column = by === 'resend_id' ? 'resend_id' : 'id';
  const value = by === 'resend_id' ? String(identifier || '') : Number(identifier || 0);
  if (!value) return { exists: false, allowed: false, sent: null };

  const sent = await db.prepare(
    `SELECT id, resend_id, from_addr FROM sent_emails WHERE ${column} = ? LIMIT 1`
  ).bind(value).first();
  if (!sent) return { exists: false, allowed: false, sent: null };

  const ctx = getAuthContext(request, options);
  if (ctx.strictAdmin) {
    return { exists: true, allowed: true, sent, mailbox: null };
  }

  const access = await getMailboxAccess(db, request, options, { address: sent.from_addr });
  return { exists: true, allowed: access.allowed, sent, mailbox: access.mailbox };
}

export { sha256Hex, hashPassword };
