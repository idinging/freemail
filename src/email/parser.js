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
  const subjectText = String(subject || '');
  const textBody = String(text || '');
  const htmlBody = stripHtml(html);

  const sources = {
    subject: subjectText,
    body: `${textBody} ${htmlBody}`.trim()
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
      if (n) return n;
    }
  }

  const bodyOrdereds = [
    new RegExp(`${kw}[^\n\r\d]{0,30}(?<!\\d)${codeChunk}(?!\\d)`, 'i'),
    new RegExp(`(?<!\\d)${codeChunk}(?!\\d)[^\n\r\d]{0,30}${kw}`, 'i'),
  ];
  for (const r of bodyOrdereds) {
    const m = sources.body.match(r);
    if (m && m[1]) {
      const n = normalizeDigits(m[1]);
      if (n) return n;
    }
  }

  const looseBodyOrdereds = [
    new RegExp(`${kw}[^\n\r\d]{0,80}(?<!\\d)${codeChunk}(?!\\d)`, 'i'),
    new RegExp(`(?<!\\d)${codeChunk}(?!\\d)[^\n\r\d]{0,80}${kw}`, 'i'),
  ];
  for (const r of looseBodyOrdereds) {
    const m = sources.body.match(r);
    if (m && m[1]) {
      const n = normalizeDigits(m[1]);
      if (n && !isLikelyNonVerificationCode(n, sources.body)) {
        return n;
      }
    }
  }

  return '';
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