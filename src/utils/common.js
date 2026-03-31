/**
 * 通用工具函数模块
 * @module utils/common
 */

/**
 * 从邮件地址中提取纯邮箱地址
 * 处理各种格式如 "Name <email@domain.com>" 或 "<email@domain.com>"
 * @param {string} addr - 原始邮件地址字符串
 * @returns {string} 纯邮箱地址
 */
export function extractEmail(addr) {
  const s = String(addr || '').trim();
  const m = s.match(/<([^>]+)>/);
  if (m) return m[1].trim();
  return s.split(/\s/)[0] || s;
}

/**
 * 规范化邮箱别名地址
 * 类似谷歌别名邮箱功能：点号(.)、加号(+)、减号(-)前面的部分被视为别名前缀
 * 只保留最后一个分隔符后面的部分作为真正的本地部分
 *
 * 例如：
 * - ab.c@qq.ss → c@qq.ss
 * - ab+c@qq.ss → c@qq.ss
 * - ab-c@qq.ss → c@qq.ss
 * - a.b+c@qq.ss → c@qq.ss (最后一个分隔符是 +)
 * - a.b-c@qq.ss → c@qq.ss (最后一个分隔符是 -)
 * - x.y.z@domain.com → z@domain.com
 * - simple@domain.com → simple@domain.com (无分隔符则保持不变)
 *
 * @param {string} email - 邮箱地址
 * @returns {string} 规范化后的邮箱地址
 */
export function normalizeEmailAlias(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return '';

  const atIndex = normalized.indexOf('@');
  if (atIndex <= 0) return normalized;

  const localPart = normalized.slice(0, atIndex);
  const domain = normalized.slice(atIndex + 1);

  // 查找本地部分中最后一个分隔符的位置（支持 . + - 三种）
  const lastDotIndex = localPart.lastIndexOf('.');
  const lastPlusIndex = localPart.lastIndexOf('+');
  const lastDashIndex = localPart.lastIndexOf('-');

  // 找到最后一个分隔符的位置
  const lastSeparatorIndex = Math.max(lastDotIndex, lastPlusIndex, lastDashIndex);

  // 如果没有分隔符，或者分隔符在第一个位置，保持原样
  if (lastSeparatorIndex <= 0) {
    return normalized;
  }

  // 取最后一个分隔符后面的部分作为真正的本地部分
  const realLocalPart = localPart.slice(lastSeparatorIndex + 1);

  // 如果分隔符后面没有内容，保持原样
  if (!realLocalPart) {
    return normalized;
  }

  return `${realLocalPart}@${domain}`;
}

/**
 * 生成指定长度的随机ID
 * @param {number} length - ID长度，默认为8
 * @returns {string} 随机生成的ID字符串
 */
export function generateRandomId(length = 8) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * 验证邮箱地址格式
 * @param {string} email - 邮箱地址
 * @returns {boolean} 是否为有效的邮箱格式
 */
export function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim());
}

/**
 * 计算文本的SHA-256哈希值并返回十六进制字符串
 * @param {string} text - 需要计算哈希的文本内容
 * @returns {Promise<string>} 十六进制格式的SHA-256哈希值
 */
export async function sha256Hex(text) {
  const enc = new TextEncoder();
  const data = enc.encode(String(text || ''));
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * 验证原始密码与哈希密码是否匹配
 * @param {string} rawPassword - 原始明文密码
 * @param {string} hashed - 已哈希的密码
 * @returns {Promise<boolean>} 验证结果，true表示密码匹配
 */
export async function verifyPassword(rawPassword, hashed) {
  if (!hashed) return false;
  try {
    const hex = (await sha256Hex(rawPassword)).toLowerCase();
    return hex === String(hashed || '').toLowerCase();
  } catch (_) {
    return false;
  }
}
