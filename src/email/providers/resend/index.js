/**
 * Resend 发件渠道
 *
 * 通过 Resend REST API (https://api.resend.com) 实现邮件发送。
 * 支持单密钥与多域名密钥（参见 shared.js 的 parseProviderConfig）。
 *
 * @module email/providers/resend
 */

import { parseProviderConfig, selectKeyForDomain, normalizeSendPayload } from '../shared.js';

function buildHeaders(apiKey) {
  return {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  };
}

export async function sendEmailWithResend(apiKey, payload) {
  const body = normalizeSendPayload(payload);
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: buildHeaders(apiKey),
    body: JSON.stringify(body)
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = data?.message || data?.error || resp.statusText || 'Resend send failed';
    throw new Error(msg);
  }
  return data;
}

/**
 * 智能发送邮件：根据发件人域名自动选择 API 密钥。
 */
export async function sendEmailWithAutoResend(resendConfig, payload) {
  const apiKey = selectKeyForDomain(payload.from, resendConfig);
  if (!apiKey) {
    throw new Error(`未找到域名对应的API密钥: ${payload.from}`);
  }
  return await sendEmailWithResend(apiKey, payload);
}

export async function sendBatchWithResend(apiKey, payloads) {
  const items = Array.isArray(payloads) ? payloads.map(normalizeSendPayload) : [];
  const resp = await fetch('https://api.resend.com/emails/batch', {
    method: 'POST',
    headers: buildHeaders(apiKey),
    body: JSON.stringify(items)
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = data?.message || data?.error || resp.statusText || 'Resend batch send failed';
    throw new Error(msg);
  }
  return data;
}

/**
 * 智能批量发送邮件：自动按域名分组并使用对应的 API 密钥。
 */
export async function sendBatchWithAutoResend(resendConfig, payloads) {
  if (!Array.isArray(payloads) || payloads.length === 0) {
    return [];
  }

  const groupedByDomain = {};
  for (const payload of payloads) {
    const apiKey = selectKeyForDomain(payload.from, resendConfig);
    if (!apiKey) {
      throw new Error(`未找到域名对应的API密钥: ${payload.from}`);
    }

    if (!groupedByDomain[apiKey]) {
      groupedByDomain[apiKey] = [];
    }
    groupedByDomain[apiKey].push(payload);
  }

  const results = [];
  const promises = Object.entries(groupedByDomain).map(async ([apiKey, groupPayloads]) => {
    try {
      const batchResult = await sendBatchWithResend(apiKey, groupPayloads);
      return { success: true, apiKey, results: batchResult };
    } catch (error) {
      return { success: false, apiKey, error: error.message };
    }
  });

  const batchResults = await Promise.all(promises);

  for (const batchResult of batchResults) {
    if (batchResult.success) {
      if (Array.isArray(batchResult.results)) {
        results.push(...batchResult.results);
      } else {
        results.push(batchResult.results);
      }
    } else {
      throw new Error(`批量发送失败 (API密钥: ${batchResult.apiKey}): ${batchResult.error}`);
    }
  }

  return results;
}

export async function getEmailFromResend(apiKey, id) {
  const resp = await fetch(`https://api.resend.com/emails/${id}`, {
    method: 'GET',
    headers: buildHeaders(apiKey)
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = data?.message || data?.error || resp.statusText || 'Resend get failed';
    throw new Error(msg);
  }
  return data;
}

export async function updateEmailInResend(apiKey, { id, scheduledAt }) {
  const body = {};
  if (scheduledAt) body.scheduled_at = scheduledAt;
  const resp = await fetch(`https://api.resend.com/emails/${id}`, {
    method: 'PATCH',
    headers: buildHeaders(apiKey),
    body: JSON.stringify(body)
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = data?.message || data?.error || resp.statusText || 'Resend update failed';
    throw new Error(msg);
  }
  return data;
}

export async function cancelEmailInResend(apiKey, id) {
  const resp = await fetch(`https://api.resend.com/emails/${id}/cancel`, {
    method: 'POST',
    headers: buildHeaders(apiKey)
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = data?.message || data?.error || resp.statusText || 'Resend cancel failed';
    throw new Error(msg);
  }
  return data;
}

// 向后兼容：原 sender.js 暴露的 helper 在此重导出
export { parseProviderConfig as parseResendConfig, selectKeyForDomain as selectApiKeyForDomain, getConfiguredDomains } from '../shared.js';
