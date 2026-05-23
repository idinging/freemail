/**
 * SendFlare 发件渠道
 *
 * 基于 sendflare-sdk-ts 实现。SDK 只暴露简化接口：单字段 body、单收件人、
 * 不支持 scheduled / get / update / cancel。此模块负责把项目内部
 * 标准化 payload 适配到 SendFlare 的 SendEmailReq。
 *
 * @module email/providers/sendflare
 */

import { createSendflare } from 'sendflare-sdk-ts';
import { selectKeyForDomain, normalizeSendPayload } from '../shared.js';

/**
 * 把标准化的 payload 转换为 SendFlare SDK 期望的 SendEmailReq。
 * SendFlare 没有独立的 html/text 字段，统一塞进 body，优先 html。
 */
function toSendflareRequest(payload) {
  const body = normalizeSendPayload(payload);
  const recipients = Array.isArray(body.to) ? body.to : [];
  const replyTo = body.reply_to
    ? (Array.isArray(body.reply_to) ? body.reply_to : [body.reply_to])
    : [];
  return {
    from: body.from,
    // SendFlare SDK 的 SendEmailReq.to 是单个字符串；多收件人需自行拆分
    to: recipients[0] || '',
    subject: body.subject || '',
    body: body.html || body.text || '',
    cc: body.cc || [],
    bcc: body.bcc || [],
    replyTo
  };
}

/**
 * 提取 SendFlare 响应中的稳定标识。
 * SDK 返回 CommonResponse { requestId, code, success, message, ts, data }，
 * 优先取 data.id，其次 requestId。
 */
function extractId(resp) {
  if (!resp || typeof resp !== 'object') return null;
  if (resp.data && typeof resp.data === 'object' && resp.data.id) {
    return String(resp.data.id);
  }
  return resp.requestId ? String(resp.requestId) : null;
}

/**
 * SendFlare 响应里成功的标志是 success===true，但 SDK 在 HTTP 非 2xx 时已抛错；
 * 这里再兜底校验业务层 success 字段。
 */
function assertResponseOk(resp) {
  if (resp && resp.success === false) {
    const msg = resp.message || 'SendFlare 发送失败';
    throw new Error(msg);
  }
}

export async function sendEmailWithSendflare(apiKey, payload) {
  const client = createSendflare(apiKey);
  const req = toSendflareRequest(payload);
  if (!req.to) {
    throw new Error('SendFlare 渠道至少需要一个收件人');
  }
  const resp = await client.sendEmail(req);
  assertResponseOk(resp);
  return { id: extractId(resp), raw: resp };
}

/**
 * 智能发送：按发件人域名挑选 API 密钥。
 */
export async function sendEmailWithAutoSendflare(sendflareConfig, payload) {
  const apiKey = selectKeyForDomain(payload.from, sendflareConfig);
  if (!apiKey) {
    throw new Error(`未找到域名对应的API密钥: ${payload.from}`);
  }
  return await sendEmailWithSendflare(apiKey, payload);
}

/**
 * 批量发送：SendFlare 自身的 batchSendEmail 语义是「一封邮件多收件人」，
 * 不符合本项目「多封不同邮件」的语义。这里退化为并发循环 sendEmail。
 */
export async function sendBatchWithSendflare(apiKey, payloads) {
  if (!Array.isArray(payloads) || payloads.length === 0) return [];
  return await Promise.all(
    payloads.map(p => sendEmailWithSendflare(apiKey, p))
  );
}

/**
 * 智能批量：按域名分组并发。返回数组顺序与入参一致。
 */
export async function sendBatchWithAutoSendflare(sendflareConfig, payloads) {
  if (!Array.isArray(payloads) || payloads.length === 0) return [];
  return await Promise.all(
    payloads.map(p => sendEmailWithAutoSendflare(sendflareConfig, p))
  );
}
