export function parseEmailBody(raw) {
  if (!raw) return { text: '', html: '' };
  const { headers: topHeaders, body: topBody } = splitHeadersAndBody(raw);
  return parseEntity(topHeaders, topBody);
}

function parseEntity(headers, body) {
  // 注意：boundary 区分大小写，不能对 content-type 整体小写后再提取
  const ctRaw = headers['content-type'] || '';
  const ct = ctRaw.toLowerCase();
  const transferEnc = (headers['content-transfer-encoding'] || '').toLowerCase();
  const boundary = getBoundary(ctRaw);

  // 单体：text/html 或 text/plain
  if (!ct.startsWith('multipart/')) {
    const decoded = decodeBodyWithCharset(body, transferEnc, ct);
    const isHtml = ct.includes('text/html');
    const isText = ct.includes('text/plain') || !isHtml;
    // 某些邮件不带 content-type 或是 message/rfc822 等，将其作为纯文本尝试
    if (!ct || ct === '') {
      const guessHtml = guessHtmlFromRaw(decoded || body || '');
      if (guessHtml) return { text: '', html: guessHtml };
    }
    return { text: isText ? decoded : '', html: isHtml ? decoded : '' };
  }

  // 复合：递归解析，优先取 text/html，再退回 text/plain
  let text = '';
  let html = '';
  if (boundary) {
    const parts = splitMultipart(body, boundary);
    for (const part of parts) {
      const { headers: ph, body: pb } = splitHeadersAndBody(part);
      const pct = (ph['content-type'] || '').toLowerCase();
      // 对转发/嵌套邮件的更强兼容：
      // 1) message/rfc822（完整原始邮件作为 part）
      // 2) text/rfc822-headers（仅头部）后常跟随一个 text/html 或 text/plain 部分
      // 3) 某些服务会将原始邮件整体放在 text/plain/base64 中，里面再包含 HTML 片段
      if (pct.startsWith('multipart/')) {
        const nested = parseEntity(ph, pb);
        if (!html && nested.html) html = nested.html;
        if (!text && nested.text) text = nested.text;
      } else if (pct.startsWith('message/rfc822')) {
        const nested = parseEmailBody(pb);
        if (!html && nested.html) html = nested.html;
        if (!text && nested.text) text = nested.text;
      } else if (pct.includes('rfc822-headers')) {
        // 跳过纯头部，尝试在后续 part 中抓取正文
        continue;
      } else {
        const res = parseEntity(ph, pb);
        if (!html && res.html) html = res.html;
        if (!text && res.text) text = res.text;
      }
      if (text && html) break;
    }
  }

  // 如果仍无 html，尝试在原始体里直接抓取 HTML 片段（处理某些非标准邮件）
  if (!html) {
    // 尝试从各 part 的原始体里猜测 HTML（有些邮件未正确声明 content-type）
    html = guessHtmlFromRaw(body);
    // 如果仍为空，且 text 存在 HTML 痕迹（如标签密集），尝试容错解析
    if (!html && /<\w+[\s\S]*?>[\s\S]*<\/\w+>/.test(body || '')){
      html = body;
    }
  }
  // 如果还没有 html，但有 text，用简单换行转 <br> 的方式提供可读 html
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
  // 不改变大小写以保留 boundary 原值；用不区分大小写的匹配
  const m = contentType.match(/boundary\s*=\s*"?([^";\r\n]+)"?/i);
  return m ? m[1].trim() : '';
}

function splitMultipart(body, boundary) {
  // 容错：RFC 规定分隔行形如 "--boundary" 与终止 "--boundary--"；
  // 这里允许前后空白、以及行中仅包含该标记
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
  // 7bit/8bit/binary 直接返回
  return body;
}

// 根据 content-type 中的 charset 尝试解码
function decodeBodyWithCharset(body, transferEncoding, contentType) {
  const decodedRaw = decodeBody(body, transferEncoding);
  // base64/qp 已按 utf-8 解码为字符串；若 charset 指定为 gbk/gb2312 等，尝试再次按该编码解码
  const m = /charset\s*=\s*"?([^";]+)/i.exec(contentType || '');
  const charset = (m && m[1] ? m[1].trim().toLowerCase() : '') || 'utf-8';
  if (!decodedRaw) return '';
  if (charset === 'utf-8' || charset === 'utf8' || charset === 'us-ascii') return decodedRaw;
  try {
    // 将字符串转回字节再按指定编码解码；Cloudflare 运行时支持常见编码（utf-8、iso-8859-1）。
    // 对于 gbk/gb2312 可能不被支持，则直接返回已得到的字符串。
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

function escapeHtml(s){
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'': '&#39;'}[c] || c));
}

function textToHtml(text){
  return `<div style="white-space:pre-wrap">${escapeHtml(text)}</div>`;
}

// 将 HTML 粗略转为可检索纯文本（去标签/脚本/样式，并处理常见实体）
function stripHtml(html){
  const s = String(html || '');
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, n) => {
      try{ return String.fromCharCode(parseInt(n, 10)); }catch(_){ return ' '; }
    })
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 更智能地从主题/文本/HTML 中提取验证码（4-8 位），支持空格/连字符分隔
export function extractVerificationCode({ subject = '', text = '', html = '' } = {}){
  const subjectText = String(subject || '');
  const textBody = String(text || '');
  const htmlBody = stripHtml(html);

  const sources = {
    subject: subjectText,
    body: `${textBody} ${htmlBody}`.trim()
  };

  // 允许的数字长度范围
  const minLen = 4;
  const maxLen = 8;

  // 将匹配结果中的分隔去掉，仅保留数字并校验长度
  function normalizeDigits(s){
    const digits = String(s || '').replace(/\D+/g, '');
    if (digits.length >= minLen && digits.length <= maxLen) return digits;
    return '';
  }

  // 关键词（多语言，非捕获）
  const kw = '(?:verification|one[-\s]?time|two[-\s]?factor|2fa|security|auth|login|confirm|code|otp|验证码|校验码|驗證碼|確認碼|認證碼|認証コード|인증코드|코드)';
  // 代码片段：4-8 位数字，允许以常见分隔符分隔（空格、NBSP、短/长破折号、点号、中点、引号等）
  const sepClass = "[\\u00A0\\s\-–—_.·•∙‧'’]";
  const codeChunk = `([0-9](?:${sepClass}?[0-9]){3,7})`;

  // 优先 1：subject 中 关键词 邻近 代码（双向）
  const subjectOrdereds = [
    new RegExp(`${kw}[^\n\r\d]{0,20}(?<!\\d)${codeChunk}(?!\\d)`, 'i'),
    new RegExp(`(?<!\\d)${codeChunk}(?!\\d)[^\n\r\d]{0,20}${kw}`, 'i'),
  ];
  for (const r of subjectOrdereds){
    const m = sources.subject.match(r);
    if (m && m[1]){
      const n = normalizeDigits(m[1]);
      if (n) return n;
    }
  }

  // 优先 2：正文中 关键词 邻近 代码（双向）
  const bodyOrdereds = [
    new RegExp(`${kw}[^\n\r\d]{0,30}(?<!\\d)${codeChunk}(?!\\d)`, 'i'),
    new RegExp(`(?<!\\d)${codeChunk}(?!\\d)[^\n\r\d]{0,30}${kw}`, 'i'),
  ];
  for (const r of bodyOrdereds){
    const m = sources.body.match(r);
    if (m && m[1]){
      const n = normalizeDigits(m[1]);
      if (n) return n;
    }
  }

  // 兜底 1：正文里的分隔/连续数字（优先正文，避免主题中的无关数字抢占）
  {
    // 添加数字边界，避免从更长数字尾部截取；放宽分隔符范围
    const r = new RegExp(`(?<!\\d)([0-9](?:${sepClass}?[0-9]){3,7})(?!\\d)`);
    const m = sources.body.match(r);
    if (m){
      const n = normalizeDigits(m[1]);
      if (n) return n;
    }
  }

  // 兜底 2：subject 里的孤立 4-8 位数字（最后再考虑）
  {
    const r = /(?<!\d)(\d{4,8})(?!\d)/;
    const m = sources.subject.match(r);
    if (m){
      const n = normalizeDigits(m[1]);
      if (n) return n;
    }
  }

  return '';
}

