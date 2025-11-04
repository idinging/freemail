/**
 * 邮件解析模块
 * @module email/parser
 */

/**
 * 解析邮件正文，提取文本和HTML内容
 * @param {string} raw - 原始邮件内容
 * @returns {object} 包含text和html属性的对象
 */
export function parseEmailBody(raw) {
  if (!raw) return { text: '', html: '' };
  const { headers: topHeaders, body: topBody } = splitHeadersAndBody(raw);
  return parseEntity(topHeaders, topBody);
}

/**
 * 解析邮件实体内容，处理单体和多部分内容
 */
function parseEntity(headers, body) {
  const ctRaw = headers['content-type'] || '';
  const ct = ctRaw.toLowerCase();
  const transferEnc = (headers['content-transfer-encoding'] || '').toLowerCase();
  const boundary = getBoundary(ctRaw);

  if (!ct.startsWith('multipart/')) {
    const decoded = decodeBodyWithCharset(body, transferEnc, ct);
    const isHtml = ct.includes('text/html');
    const isText = ct.includes('text/plain') || !isHtml;
    if (!ct || ct === '') {
      const guessHtml = guessHtmlFromRaw(decoded || body || '');
      if (guessHtml) return { text: '', html: guessHtml };
    }
    return { text: isText ? decoded : '', html: isHtml ? decoded : '' };
  }

  let text = '';
  let html = '';
  if (boundary) {
    const parts = splitMultipart(body, boundary);
    for (const part of parts) {
      const { headers: ph, body: pb } = splitHeadersAndBody(part);
      const pct = (ph['content-type'] || '').toLowerCase();
      if (pct.startsWith('multipart/')) {
        const nested = parseEntity(ph, pb);
        if (!html && nested.html) html = nested.html;
        if (!text && nested.text) text = nested.text;
      } else if (pct.startsWith('message/rfc822')) {
        const nested = parseEmailBody(pb);
        if (!html && nested.html) html = nested.html;
        if (!text && nested.text) text = nested.text;
      } else if (pct.includes('rfc822-headers')) {
        continue;
      } else {
        const res = parseEntity(ph, pb);
        if (!html && res.html) html = res.html;
        if (!text && res.text) text = res.text;
      }
      if (text && html) break;
    }
  }

  if (!html) {
    html = guessHtmlFromRaw(body);
    if (!html && /<\w+[\s\S]*?>[\s\S]*<\/\w+>/.test(body || '')) {
      html = body;
    }
  }
  if (!html && text) {
    html = textToHtml(text);
  }
  return { text, html };
}

function splitHeadersAndBody(input) {
  const idx = input.indexOf('\r\n\r\n');
  const idx2 = idx === -1 ? input.indexOf('\n\n') : idx;
  const sep = idx !== -1 ? 4 : (idx2 !== -1 ? 2 : -1);
  if (sep === -1) return { headers: {}, body: input };
  const rawHeaders = input.slice(0, (idx !== -1 ? idx : idx2));
  const body = input.slice((idx !== -1 ? idx : idx2) + sep);
  return { headers: parseHeaders(rawHeaders), body };
}

function parseHeaders(rawHeaders) {
  const headers = {};
  const lines = rawHeaders.split(/\r?\n/);
  let lastKey = '';
  for (const line of lines) {
    if (/^\s/.test(line) && lastKey) {
      headers[lastKey] += ' ' + line.trim();
      continue;
    }
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (m) {
      lastKey = m[1].toLowerCase();
      headers[lastKey] = m[2];
    }
  }
  return headers;
}

function getBoundary(contentType) {
  if (!contentType) return '';
  const m = contentType.match(/boundary\s*=\s*"?([^";\r\n]+)"?/i);
  return m ? m[1].trim() : '';
}

function splitMultipart(body, boundary) {
  const delim = '--' + boundary;
  const endDelim = delim + '--';
  const lines = body.split(/\r?\n/);
  const parts = [];
  let current = [];
  let inPart = false;
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.trim() === delim) {
      if (inPart && current.length) parts.push(current.join('\n'));
      current = [];
      inPart = true;
      continue;
    }
    if (line.trim() === endDelim) {
      if (inPart && current.length) parts.push(current.join('\n'));
      break;
    }
    if (inPart) current.push(rawLine);
  }
  return parts;
}

function decodeBody(body, transferEncoding) {
  if (!body) return '';
  const enc = transferEncoding.trim();
  if (enc === 'base64') {
    const cleaned = body.replace(/\s+/g, '');
    try {
      const bin = atob(cleaned);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      try {
        return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      } catch (_) {
        return bin;
      }
    } catch (_) {
      return body;
    }
  }
  if (enc === 'quoted-printable') {
    return decodeQuotedPrintable(body);
  }
  return body;
}

function decodeBodyWithCharset(body, transferEncoding, contentType) {
  const decodedRaw = decodeBody(body, transferEncoding);
  const m = /charset\s*=\s*"?([^";]+)/i.exec(contentType || '');
  const charset = (m && m[1] ? m[1].trim().toLowerCase() : '') || 'utf-8';
  if (!decodedRaw) return '';
  if (charset === 'utf-8' || charset === 'utf8' || charset === 'us-ascii') return decodedRaw;
  try {
    const bytes = new Uint8Array(decodedRaw.split('').map(c => c.charCodeAt(0)));
    return new TextDecoder(charset, { fatal: false }).decode(bytes);
  } catch (_) {
    return decodedRaw;
  }
}

function decodeQuotedPrintable(input) {
  let s = input.replace(/=\r?\n/g, '');
  const bytes = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '=' && i + 2 < s.length) {
      const hex = s.substring(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    bytes.push(ch.charCodeAt(0));
  }
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes));
  } catch (_) {
    return s;
  }
}

function guessHtmlFromRaw(raw) {
  if (!raw) return '';
  const lower = raw.toLowerCase();
  let hs = lower.indexOf('<html');
  if (hs === -1) hs = lower.indexOf('<!doctype html');
  if (hs !== -1) {
    const he = lower.lastIndexOf('</html>');
    if (he !== -1) return raw.slice(hs, he + 7);
  }
  return '';
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
}

function textToHtml(text) {
  return `<div style="white-space:pre-wrap">${escapeHtml(text)}</div>`;
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
