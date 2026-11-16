/**
 * 邮件解析模块
 * @module email/parser
 */

import PostalMime from 'postal-mime';

/**
 * 解析邮件正文，提取文本和HTML内容
 * @param {string} raw - 原始邮件内容 (EML 格式)
 * @returns {Promise<object>} 包含 text 和 html 属性的对象
 */
export async function parseEmailBody(raw) {
  if (!raw) return { text: '', html: '' };
  const email = await PostalMime.parse(raw);
  return {
    text: email.text || '',
    html: email.html || '',
  };
}

/**
 * 从邮件主题、文本和HTML中智能提取验证码（4-8位数字）
 * @param {object} params - 提取参数对象
 * @param {string} params.subject - 邮件主题
 * @param {string} params.text - 纯文本内容
 * @param {string} params.html - HTML内容
 * @returns {string} 提取的验证码，如果未找到返回空字符串
 */
export function extractVerificationCode({ subject = '', text = '', html = '' } = {}) {
  // 先剔除邮箱地址与 URL：转发邮件正文/头部里的 xxx888888@example.com、链接里的数字串
  // 只要落在关键词 80 字符内就会被当成验证码写库，而前端优先展示库里这个值，事后无法纠正
  const subjectText = stripNoise(String(subject || ''));
  const textBody = stripNoise(String(text || '')).replace(/\s+/g, ' ').trim();
  const htmlBody = stripNoise(stripHtml(html)).replace(/\s+/g, ' ').trim();

  const sources = {
    subject: subjectText,
    body: (textBody || htmlBody || '').trim()
  };

  const minLen = 4;
  const maxLen = 8;

  function normalizeDigits(s) {
    const digits = String(s || '').replace(/\D+/g, '');
    if (digits.length >= minLen && digits.length <= maxLen) return digits;
    return '';
  }

  const kw = '(?:verification|one[-\\s]?time|two[-\\s]?factor|2fa|security|auth|login|confirm|code|otp|验证码|校验码|驗證碼|確認碼|認證碼|認証コード|인증코드|코드)';
  const sepClass = "[\\u00A0\\s\\-–—_.·•∙‧'']";
  const codeChunk = `([0-9](?:${sepClass}?[0-9]){3,7})`;

  const subjectOrdereds = [
    new RegExp(`${kw}[^\n\r\d]{0,20}(?<!\\d)${codeChunk}(?!\\d)`, 'i'),
    new RegExp(`(?<!\\d)${codeChunk}(?!\\d)[^\n\r\d]{0,20}${kw}`, 'i'),
  ];
  for (const r of subjectOrdereds) {
    const m = sources.subject.match(r);
    if (m && m[1]) {
      const n = normalizeDigits(m[1]);
      if (n && !looksLikeDate(n)) return n;
    }
  }

  const bodyOrdereds = [
    new RegExp(`${kw}[\\s\\S]{0,30}?(?<!\\d)${codeChunk}(?!\\d)`, 'i'),
    new RegExp(`(?<!\\d)${codeChunk}(?!\\d)[\\s\\S]{0,30}?${kw}`, 'i'),
  ];
  for (const r of bodyOrdereds) {
    const m = sources.body.match(r);
    if (m && m[1]) {
      const n = normalizeDigits(m[1]);
      if (n && !looksLikeDate(n)) return n;
    }
  }

  const looseBodyOrdereds = [
    new RegExp(`${kw}[\\s\\S]{0,80}?(?<!\\d)${codeChunk}(?!\\d)`, 'i'),
    new RegExp(`(?<!\\d)${codeChunk}(?!\\d)[\\s\\S]{0,80}?${kw}`, 'i'),
  ];
  for (const r of looseBodyOrdereds) {
    const m = sources.body.match(r);
    if (m && m[1]) {
      const n = normalizeDigits(m[1]);
      if (n && !looksLikeDate(n) && !isLikelyNonVerificationCode(n, sources.body)) {
        return n;
      }
    }
  }

  return '';
}

/**
 * 剔除邮箱地址与 URL，避免其中的数字串被关键词规则误判成验证码
 * 先处理 URL（自身可能含 @），再处理邮箱
 * @param {string} s - 原始文本
 * @returns {string}
 */
function stripNoise(s) {
  return String(s || '')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\bwww\.\S+/gi, ' ')
    .replace(/[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, ' ');
}

function stripHtml(html) {
  const s = String(html || '');
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, n) => {
      try { return String.fromCharCode(parseInt(n, 10)); } catch (_) { return ' '; }
    })
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 判断是否为日期型数字串（如转发邮件头部的 Date: 2026-10-29 → 20261029）
 * 这类值常与 login/security/code 等关键词同处一个窗口内，不能当验证码
 * @param {string} digits - 纯数字串
 * @returns {boolean}
 */
function looksLikeDate(digits) {
  if (String(digits || '').length !== 8) return false;
  const y = parseInt(digits.slice(0, 4), 10);
  const mo = parseInt(digits.slice(4, 6), 10);
  const d = parseInt(digits.slice(6, 8), 10);
  return y >= 2000 && y <= 2099 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31;
}

function isLikelyNonVerificationCode(digits, context = '') {
  if (!digits) return true;

  const year = parseInt(digits, 10);
  if (digits.length === 4 && year >= 2000 && year <= 2099) {
    return true;
  }

  if (digits.length === 5) {
    const lowerContext = context.toLowerCase();
    if (lowerContext.includes('address') ||
      lowerContext.includes('street') ||
      lowerContext.includes('zip') ||
      lowerContext.includes('postal') ||
      /\b[a-z]{2,}\s+\d{5}\b/i.test(context)) {
      return true;
    }
  }

  const addressPattern = new RegExp(`\\b${digits}\\s+[A-Z][a-z]+(?:,|\\b)`, 'i');
  if (addressPattern.test(context)) {
    return true;
  }

  return false;
}