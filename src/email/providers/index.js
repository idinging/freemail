/**
 * 发件渠道统一入口与分发器。
 *
 * 业务代码（src/api/send.js 等）应只 import 此模块，不要直接 import
 * 各 provider 子目录，方便未来新增渠道。
 *
 * - resolveProvider(from, env)   按发件人域名决定走哪个渠道
 * - sendEmailAuto / sendBatchAuto  自动分发到对应 provider
 * - resend / sendflare           需要直接调用某渠道特有 API（如 Resend 的
 *   get/update/cancel）时使用命名空间访问
 *
 * @module email/providers
 */

import * as resendProvider from './resend/index.js';
import * as sendflareProvider from './sendflare/index.js';
import {
  parseProviderConfig,
  selectKeyForDomain,
  getConfiguredDomains
} from './shared.js';

export { parseProviderConfig, selectKeyForDomain, getConfiguredDomains };
export const resend = resendProvider;
export const sendflare = sendflareProvider;

/**
 * 解析发件人域名应走哪个渠道。
 *
 * 选择顺序（键值对永远优先于单密钥兜底，避免单密钥渠道"吞掉"另一渠道已具名的域名）：
 *   1. SendFlare 键值对/JSON 映射命中 → SendFlare
 *   2. Resend 键值对/JSON 映射命中 → Resend
 *   3. SendFlare 是单密钥（裸 key，无 `=`） → SendFlare 通配
 *   4. Resend 是单密钥 → Resend 通配
 *   5. 都没命中 → 抛错
 *
 * @param {string} fromEmail
 * @param {{ resendApiKey?: string, sendflareApiKey?: string }} keys
 * @returns {{ provider: 'resend'|'sendflare', apiKey: string }}
 */
export function resolveProvider(fromEmail, { resendApiKey = '', sendflareApiKey = '' } = {}) {
  if (!fromEmail) {
    throw new Error('发件人地址为空');
  }

  const isSingleKey = (token) =>
    typeof token === 'string' && token.length > 0 && !token.includes('=');

  // Step 1-2：键值对/JSON 命中优先
  if (sendflareApiKey && !isSingleKey(sendflareApiKey)) {
    const key = selectKeyForDomain(fromEmail, sendflareApiKey);
    if (key) return { provider: 'sendflare', apiKey: key };
  }
  if (resendApiKey && !isSingleKey(resendApiKey)) {
    const key = selectKeyForDomain(fromEmail, resendApiKey);
    if (key) return { provider: 'resend', apiKey: key };
  }

  // Step 3-4：单密钥兜底
  if (sendflareApiKey && isSingleKey(sendflareApiKey)) {
    return { provider: 'sendflare', apiKey: sendflareApiKey };
  }
  if (resendApiKey && isSingleKey(resendApiKey)) {
    return { provider: 'resend', apiKey: resendApiKey };
  }

  const domain = (String(fromEmail).match(/@([^>]+)/)?.[1] || fromEmail).toLowerCase().trim();
  throw new Error(`未找到域名对应的发件 API Key: ${domain}`);
}

/**
 * 自动分发单封发送。
 *
 * @param {{ resendApiKey?: string, sendflareApiKey?: string }} keys
 * @param {object} payload
 * @returns {Promise<{ provider: string, id: string|null, raw: any }>}
 */
export async function sendEmailAuto(keys, payload) {
  const { provider, apiKey } = resolveProvider(payload?.from, keys);
  if (provider === 'sendflare') {
    const result = await sendflareProvider.sendEmailWithSendflare(apiKey, payload);
    return { provider, id: result.id || null, raw: result.raw };
  }
  const result = await resendProvider.sendEmailWithResend(apiKey, payload);
  return { provider, id: result?.id || null, raw: result };
}

/**
 * 自动分发批量发送。按 provider 分组：
 * - Resend 走 sendBatchWithResend（一次 HTTP 请求多封）
 * - SendFlare 走 sendBatchWithSendflare（并发循环 sendEmail）
 *
 * 返回数组与入参顺序对齐，每项形如 { provider, id, raw }。
 *
 * @param {{ resendApiKey?: string, sendflareApiKey?: string }} keys
 * @param {Array<object>} payloads
 * @returns {Promise<Array<{ provider: string, id: string|null, raw: any }>>}
 */
export async function sendBatchAuto(keys, payloads) {
  if (!Array.isArray(payloads) || payloads.length === 0) return [];

  // 先为每封邮件解析 provider + apiKey，并按 (provider, apiKey) 分组，
  // 记下原始索引以便最终复位顺序。
  const resolved = payloads.map((p, idx) => {
    const { provider, apiKey } = resolveProvider(p?.from, keys);
    return { idx, provider, apiKey, payload: p };
  });

  const groups = new Map(); // key: `${provider}::${apiKey}`
  for (const item of resolved) {
    const k = `${item.provider}::${item.apiKey}`;
    if (!groups.has(k)) groups.set(k, { provider: item.provider, apiKey: item.apiKey, items: [] });
    groups.get(k).items.push(item);
  }

  const out = new Array(payloads.length);

  await Promise.all(Array.from(groups.values()).map(async (group) => {
    if (group.provider === 'sendflare') {
      const results = await sendflareProvider.sendBatchWithSendflare(
        group.apiKey,
        group.items.map(i => i.payload)
      );
      group.items.forEach((item, i) => {
        const r = results[i] || {};
        out[item.idx] = { provider: 'sendflare', id: r.id || null, raw: r.raw };
      });
    } else {
      const arr = await resendProvider.sendBatchWithResend(
        group.apiKey,
        group.items.map(i => i.payload)
      );
      // Resend batch 接口返回 { data: [...] } 或直接数组，做下兼容
      const list = Array.isArray(arr) ? arr : (Array.isArray(arr?.data) ? arr.data : []);
      group.items.forEach((item, i) => {
        const r = list[i] || {};
        out[item.idx] = { provider: 'resend', id: r?.id || null, raw: r };
      });
    }
  }));

  return out;
}
