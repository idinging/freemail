export function parseEmailBody(raw) {
  if (!raw) return { text: '', html: '' };
  const { headers: topHeaders, body: topBody } = splitHeadersAndBody(raw);
  const ct = (topHeaders['content-type'] || '').toLowerCase();
  const boundary = getBoundary(ct);

  if (!boundary) {
    const transferEnc = (topHeaders['content-transfer-encoding'] || '').toLowerCase();
    const decoded = decodeBody(topBody, transferEnc);
    const isHtml = ct.includes('text/html');
    const isText = ct.includes('text/plain') || !isHtml;
    return { text: isText ? decoded : '', html: isHtml ? decoded : '' };
  }

  const parts = splitMultipart(topBody, boundary);
  let text = '';
  let html = '';
  for (const part of parts) {
    const { headers, body } = splitHeadersAndBody(part);
    const pct = (headers['content-type'] || '').toLowerCase();
    const penc = (headers['content-transfer-encoding'] || '').toLowerCase();
    const decoded = decodeBody(body, penc);
    if (!html && pct.includes('text/html')) html = decoded;
    if (!text && pct.includes('text/plain')) text = decoded;
    if (text && html) break;
  }
  if (!html) {
    const lower = raw.toLowerCase();
    const hs = lower.indexOf('<html');
    if (hs !== -1) {
      const he = lower.lastIndexOf('</html>');
      if (he !== -1) html = raw.slice(hs, he + 7);
    }
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
  const m = contentType.match(/boundary=\"?([^\";\r\n]+)\"?/i);
  return m ? m[1] : '';
}

function splitMultipart(body, boundary) {
  const delim = '--' + boundary;
  const endDelim = delim + '--';
  const lines = body.split(/\r?\n/);
  const parts = [];
  let current = [];
  let inPart = false;
  for (const line of lines) {
    if (line === delim) {
      if (inPart && current.length) parts.push(current.join('\n'));
      current = [];
      inPart = true;
      continue;
    }
    if (line === endDelim) {
      if (inPart && current.length) parts.push(current.join('\n'));
      break;
    }
    if (inPart) current.push(line);
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

