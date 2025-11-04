/**
 * 邮件发送模块（Resend API）
 * @module email/sender
 */

/**
 * 解析 RESEND_TOKEN 配置，支持多域名API密钥映射
 * @param {string} resendToken - RESEND_TOKEN 配置字符串
 * @returns {object} 域名到API密钥的映射对象
 */
function parseResendConfig(resendToken) {
  const config = {};
  if (!resendToken) return config;

  try {
    const jsonConfig = JSON.parse(resendToken);
    if (typeof jsonConfig === 'object' && jsonConfig !== null) {
      return jsonConfig;
    }
  } catch (_) {
    // 不是JSON格式，继续尝试键值对格式
  }

  const pairs = String(resendToken).split(',');
  for (const pair of pairs) {
    const [domain, apiKey] = pair.split('=').map(s => s.trim());
    if (domain && apiKey) {
      config[domain.toLowerCase()] = apiKey;
    }
  }

  return config;
}

/**
 * 根据发件人邮箱地址选择合适的API密钥
 * @param {string} fromEmail - 发件人邮箱地址
 * @param {string|object} resendConfig - RESEND配置
 * @returns {string} 选择的API密钥
 */
export function selectApiKeyForDomain(fromEmail, resendConfig) {
  if (!fromEmail) return '';

  if (typeof resendConfig === 'string' && !resendConfig.includes('=')) {
    return resendConfig;
  }

  const config = typeof resendConfig === 'object'
    ? resendConfig
    : parseResendConfig(resendConfig);

  const emailMatch = String(fromEmail).match(/@([^>]+)/);
  if (!emailMatch) return '';

  const domain = emailMatch[1].toLowerCase().trim();
  return config[domain] || '';
}

/**
 * 获取所有配置的发送域名
 * @param {string|object} resendConfig - RESEND配置
 * @returns {Array<string>} 配置的域名列表
 */
export function getConfiguredDomains(resendConfig) {
  if (!resendConfig) return [];

  if (typeof resendConfig === 'string' && !resendConfig.includes('=')) {
    return [];
  }

  const config = typeof resendConfig === 'object'
    ? resendConfig
    : parseResendConfig(resendConfig);

  return Object.keys(config);
}

function buildHeaders(apiKey) {
  return {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  };
}

function normalizeSendPayload(payload) {
  const {
    from, to, subject, html, text, cc, bcc, replyTo, headers, attachments, scheduledAt
  } = payload || {};

  const body = {
    from,
    to: Array.isArray(to) ? to : (to ? [to] : []),
    subject,
    html,
    text,
  };

  if (payload && typeof payload.fromName === 'string' && from) {
    const displayName = payload.fromName.trim();
    if (displayName) {
      body.from = `${displayName} <${from}>`;
    }
  }
  if (cc) body.cc = Array.isArray(cc) ? cc : [cc];
  if (bcc) body.bcc = Array.isArray(bcc) ? bcc : [bcc];
  if (replyTo) body.reply_to = replyTo;
  if (headers && typeof headers === 'object') body.headers = headers;
  if (attachments && Array.isArray(attachments)) body.attachments = attachments;
  if (scheduledAt) body.scheduled_at = scheduledAt;
  return body;
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
 * 智能发送邮件：根据发件人域名自动选择API密钥
 */
export async function sendEmailWithAutoResend(resendConfig, payload) {
  const apiKey = selectApiKeyForDomain(payload.from, resendConfig);
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
 * 智能批量发送邮件：自动按域名分组并使用对应的API密钥
 */
export async function sendBatchWithAutoResend(resendConfig, payloads) {
  if (!Array.isArray(payloads) || payloads.length === 0) {
    return [];
  }

  const groupedByDomain = {};
  for (const payload of payloads) {
    const apiKey = selectApiKeyForDomain(payload.from, resendConfig);
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
