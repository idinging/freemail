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
 * @param {object} headers - 邮件头部对象
 * @param {string} body - 邮件正文内容
 * @returns {object} 包含text和html属性的对象
 */
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

/**
 * 分割邮件头部和正文
 * @param {string} input - 包含头部和正文的完整邮件内容
 * @returns {object} 包含headers对象和body字符串的对象
 */
function splitHeadersAndBody(input) {
  const idx = input.indexOf('\r\n\r\n');
  const idx2 = idx === -1 ? input.indexOf('\n\n') : idx;
  const sep = idx !== -1 ? 4 : (idx2 !== -1 ? 2 : -1);
  if (sep === -1) return { headers: {}, body: input };
  const rawHeaders = input.slice(0, (idx !== -1 ? idx : idx2));
  const body = input.slice((idx !== -1 ? idx : idx2) + sep);
  return { headers: parseHeaders(rawHeaders), body };
}

/**
 * 解析邮件头部字符串为对象
 * @param {string} rawHeaders - 原始头部字符串
 * @returns {object} 头部字段对象，键为小写的头部名称
 */
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

/**
 * 从Content-Type头部中提取boundary分隔符
 * @param {string} contentType - Content-Type头部值
 * @returns {string} boundary分隔符，如果没有找到返回空字符串
 */
function getBoundary(contentType) {
  if (!contentType) return '';
  // 不改变大小写以保留 boundary 原值；用不区分大小写的匹配
  const m = contentType.match(/boundary\s*=\s*"?([^";\r\n]+)"?/i);
  return m ? m[1].trim() : '';
}

/**
 * 根据boundary分隔符分割多部分邮件正文
 * @param {string} body - 多部分邮件正文
 * @param {string} boundary - boundary分隔符
 * @returns {Array<string>} 分割后的部分数组
 */
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

/**
 * 根据传输编码解码邮件正文
 * @param {string} body - 编码的正文内容
 * @param {string} transferEncoding - 传输编码类型（base64、quoted-printable等）
 * @returns {string} 解码后的正文内容
 */
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

/**
 * 根据Content-Type中的charset和传输编码解码正文
 * @param {string} body - 编码的正文内容
 * @param {string} transferEncoding - 传输编码类型
 * @param {string} contentType - Content-Type头部值，包含charset信息
 * @returns {string} 解码后的正文内容
 */
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

/**
 * 解码Quoted-Printable编码的内容
 * @param {string} input - Quoted-Printable编码的字符串
 * @returns {string} 解码后的字符串
 */
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

/**
 * 从原始内容中猜测并提取HTML片段
 * @param {string} raw - 原始内容
 * @returns {string} 提取的HTML内容，如果没有找到返回空字符串
 */
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

/**
 * 转义HTML特殊字符
 * @param {string} s - 需要转义的字符串
 * @returns {string} 转义后的字符串
 */
function escapeHtml(s){
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'': '&#39;'}[c] || c));
}

/**
 * 将纯文本转换为HTML格式，保持空白格式
 * @param {string} text - 纯文本内容
 * @returns {string} HTML格式的内容
 */
function textToHtml(text){
  return `<div style="white-space:pre-wrap">${escapeHtml(text)}</div>`;
}

/**
 * 将HTML内容转换为纯文本，去除标签、脚本、样式等
 * @param {string} html - HTML内容
 * @returns {string} 转换后的纯文本内容
 */
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

/**
 * 从邮件主题、文本和HTML中智能提取验证码（4-8位数字）
 * 支持空格、连字符等分隔符，并识别多语言关键词
 * @param {object} params - 提取参数对象
 * @param {string} params.subject - 邮件主题，默认为空字符串
 * @param {string} params.text - 纯文本内容，默认为空字符串
 * @param {string} params.html - HTML内容，默认为空字符串
 * @returns {string} 提取的验证码，如果未找到返回空字符串
 */
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

  // 优先 3：宽松匹配，但需要更明确的验证码上下文（扩展距离范围）
  // 适用于某些验证码邮件中关键词和数字距离较远的情况
  const looseBodyOrdereds = [
    new RegExp(`${kw}[^\n\r\d]{0,80}(?<!\\d)${codeChunk}(?!\\d)`, 'i'),
    new RegExp(`(?<!\\d)${codeChunk}(?!\\d)[^\n\r\d]{0,80}${kw}`, 'i'),
  ];
  for (const r of looseBodyOrdereds){
    const m = sources.body.match(r);
    if (m && m[1]){
      const n = normalizeDigits(m[1]);
      // 额外过滤：排除明显的年份（2000-2099）和常见误匹配模式
      if (n && !isLikelyNonVerificationCode(n, sources.body)) {
        return n;
      }
    }
  }

  // 不再使用无关键词的兜底逻辑，避免误识别年份、地址、电话号码等
  // 只返回有明确验证码关键词提示的数字
  return '';
}

/**
 * 判断数字是否可能不是验证码（用于过滤误匹配）
 * @param {string} digits - 提取的数字
 * @param {string} context - 上下文文本
 * @returns {boolean} 如果可能不是验证码返回true
 */
function isLikelyNonVerificationCode(digits, context = '') {
  if (!digits) return true;
  
  // 排除年份（2000-2099，常见于邮件日期、活动年份等）
  const year = parseInt(digits, 10);
  if (digits.length === 4 && year >= 2000 && year <= 2099) {
    return true;
  }
  
  // 排除常见的邮政编码模式（5位数字，且上下文包含地址相关词汇）
  if (digits.length === 5) {
    const lowerContext = context.toLowerCase();
    if (lowerContext.includes('address') || 
        lowerContext.includes('street') || 
        lowerContext.includes('zip') ||
        lowerContext.includes('postal') ||
        /\b[a-z]{2,}\s+\d{5}\b/i.test(context)) { // 如 "CA 94114"
      return true;
    }
  }
  
  // 排除包含在明显的地址格式中的数字（如 "1000 Sofia"）
  const addressPattern = new RegExp(`\\b${digits}\\s+[A-Z][a-z]+(?:,|\\b)`, 'i');
  if (addressPattern.test(context)) {
    return true;
  }
  
  return false;
}


