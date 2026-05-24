/**
 * Cyberpersons 发件渠道
 *
 * 通过 Cyberpersons Email Delivery REST API (https://platform.cyberpersons.com)
 * 实现邮件发送。支持单密钥与多域名键值对/JSON 配置（参见 shared.js 的 parseProviderConfig）。
 *
 * 与 Resend 的关键差异：
 * - 成功状态码是 202，响应体里 id 位于 data.message_id（不是顶层 id）
 * - from 只接受纯邮箱地址，显示名必须放到独立的 from_name 字段，
 *   不能拼成 RFC 5322 的 "Name <addr>" 格式（normalizeSendPayload 默认会拼）
 * - to / cc / bcc 字段只接受单字符串（**不接受数组**），数组直接返 500
 * - 错误响应是 { success: false, error: { type, message } }，error 是对象不是字符串
 * - 无原生 batch 端点，批量按 SendFlare 模式 Promise.all 循环单发
 *
 * @module email/providers/cyberpersons
 */

import { parseProviderConfig, selectKeyForDomain, normalizeSendPayload } from '../shared.js';

const CYBERPERSONS_ENDPOINT = 'https://platform.cyberpersons.com/email/v1/send';

function buildHeaders(apiKey) {
  return {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  };
}

// Cyberpersons 的 to/cc/bcc 只接受单字符串。多收件人时取数组首个，
// 与 SendFlare 行为一致。调用方如需真正多发应循环单发。
function flattenRecipient(v) {
  if (Array.isArray(v)) return v[0] || '';
  return v || '';
}

// 把 "Name <addr@x>" 拆回 { name, addr }；非该格式时把整串当 addr。
// normalizeSendPayload 在 fromName 存在时会把 from 拼成 "Name <addr>"，
// Cyberpersons 不吃这套，必须拆回 from + from_name。
function splitFromAddress(from) {
  const s = String(from || '').trim();
  const m = s.match(/^(.*?)\s*<\s*([^>]+)\s*>\s*$/);
  if (m) {
    return { name: m[1].trim().replace(/^"|"$/g, ''), addr: m[2].trim() };
  }
  return { name: '', addr: s };
}

// Cyberpersons body shape：from / to / subject / html / text / cc / bcc / reply_to / headers
// 都是标量字符串。from 必须是纯邮箱，显示名走 from_name。
function toCyberpersonsBody(payload) {
  const body = normalizeSendPayload(payload);
  const { name: parsedName, addr: bareFrom } = splitFromAddress(body.from);
  const fromName = (payload && typeof payload.fromName === 'string' ? payload.fromName.trim() : '') || parsedName;

  const out = {
    from: bareFrom,
    to: flattenRecipient(body.to),
    subject: body.subject || '',
  };
  if (fromName) out.from_name = fromName;
  if (body.html) out.html = body.html;
  if (body.text) out.text = body.text;
  const cc = flattenRecipient(body.cc);
  if (cc) out.cc = cc;
  const bcc = flattenRecipient(body.bcc);
  if (bcc) out.bcc = bcc;
  if (body.reply_to) out.reply_to = Array.isArray(body.reply_to) ? body.reply_to[0] : body.reply_to;
  if (body.headers && typeof body.headers === 'object') out.headers = body.headers;
  return out;
}

function extractId(data) {
  const id = data?.data?.message_id;
  return id ? String(id) : '';
}

// Cyberpersons 错误体形如 { success:false, error:{ type, message } }
// 直接拼成 "type: message" 方便日志定位；其他形态做兜底。
function extractErrorMessage(data, resp) {
  const err = data?.error;
  if (err && typeof err === 'object') {
    const type = err.type ? String(err.type) : '';
    const msg = err.message ? String(err.message) : '';
    if (type && msg) return `${type}: ${msg}`;
    if (msg) return msg;
    if (type) return type;
    try { return JSON.stringify(err); } catch (_) { return 'unknown error'; }
  }
  if (typeof err === 'string' && err) return err;
  if (typeof data?.message === 'string' && data.message) return data.message;
  if (resp?.statusText) return `HTTP ${resp.status} ${resp.statusText}`;
  return 'Cyberpersons send failed';
}

export async function sendEmailWithCyberpersons(apiKey, payload) {
  const body = toCyberpersonsBody(payload);
  if (!body.to) {
    throw new Error('Cyberpersons 渠道至少需要一个收件人');
  }
  const resp = await fetch(CYBERPERSONS_ENDPOINT, {
    method: 'POST',
    headers: buildHeaders(apiKey),
    body: JSON.stringify(body)
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data?.success === false) {
    throw new Error('Cyberpersons send failed: ' + extractErrorMessage(data, resp));
  }
  return { id: extractId(data), raw: data };
}

/**
 * 智能发送：按发件人域名挑选 API 密钥。
 */
export async function sendEmailWithAutoCyberpersons(cyberpersonsConfig, payload) {
  const apiKey = selectKeyForDomain(payload.from, cyberpersonsConfig);
  if (!apiKey) {
    throw new Error(`未找到域名对应的API密钥: ${payload.from}`);
  }
  return await sendEmailWithCyberpersons(apiKey, payload);
}

/**
 * 批量发送：Cyberpersons 没有原生 batch 端点，退化为并发循环 sendEmail。
 */
export async function sendBatchWithCyberpersons(apiKey, payloads) {
  if (!Array.isArray(payloads) || payloads.length === 0) return [];
  return await Promise.all(
    payloads.map(p => sendEmailWithCyberpersons(apiKey, p))
  );
}

/**
 * 智能批量：按域名分组并发。返回数组顺序与入参一致。
 */
export async function sendBatchWithAutoCyberpersons(cyberpersonsConfig, payloads) {
  if (!Array.isArray(payloads) || payloads.length === 0) return [];
  return await Promise.all(
    payloads.map(p => sendEmailWithAutoCyberpersons(cyberpersonsConfig, p))
  );
}

export { parseProviderConfig, selectKeyForDomain, getConfiguredDomains } from '../shared.js';
