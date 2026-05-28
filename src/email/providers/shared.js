/**
 * 发件渠道共享工具
 *
 * 抽出原 src/email/sender.js 的通用逻辑：
 * - 三格式（单密钥 / domain=key,... / JSON）配置解析
 * - 按发件人域名挑选 API Key
 * - 列出配置中的所有发信域名
 * - 标准化发件 payload（fromName 拼接、cc/bcc 数组化等）
 *
 * @module email/providers/shared
 */

/**
 * 解析渠道配置 token，支持三种格式：
 * 1. JSON 对象： {"domain1":"key1","domain2":"key2"}
 * 2. 键值对：    domain1=key1,domain2=key2
 * 3. 单密钥：    raw-api-key （此时返回空对象，由调用方判定为单密钥模式）
 *
 * @param {string} token - 原始配置字符串
 * @returns {object} 域名 → API 密钥映射（单密钥模式返回空对象）
 */
export function parseProviderConfig(token) {
  const config = {};
  if (!token) return config;

  try {
    const jsonConfig = JSON.parse(token);
    if (typeof jsonConfig === 'object' && jsonConfig !== null) {
      return jsonConfig;
    }
  } catch (_) {
    // 不是 JSON，继续尝试键值对
  }

  const pairs = String(token).split(',');
  for (const pair of pairs) {
    const [domain, apiKey] = pair.split('=').map(s => s.trim());
    if (domain && apiKey) {
      config[domain.toLowerCase()] = apiKey;
    }
  }

  return config;
}

/**
 * 根据发件人邮箱地址选择合适的 API 密钥。
 * 单密钥模式（字符串且不含 `=`）直接返回原值。
 *
 * @param {string} fromEmail - 发件人邮箱
 * @param {string|object} providerConfig - 渠道配置
 * @returns {string} 选中的 API 密钥，未命中返回空串
 */
export function selectKeyForDomain(fromEmail, providerConfig) {
  if (!fromEmail) return '';

  if (typeof providerConfig === 'string' && !providerConfig.includes('=')) {
    return providerConfig;
  }

  const config = typeof providerConfig === 'object'
    ? providerConfig
    : parseProviderConfig(providerConfig);

  const emailMatch = String(fromEmail).match(/@([^>]+)/);
  if (!emailMatch) return '';

  const domain = emailMatch[1].toLowerCase().trim();
  return config[domain] || '';
}

/**
 * 列出渠道配置里所有已声明的发信域名。
 * 单密钥模式返回空数组（无法推断域名）。
 *
 * @param {string|object} providerConfig - 渠道配置
 * @returns {Array<string>} 域名列表
 */
export function getConfiguredDomains(providerConfig) {
  if (!providerConfig) return [];

  if (typeof providerConfig === 'string' && !providerConfig.includes('=')) {
    return [];
  }

  const config = typeof providerConfig === 'object'
    ? providerConfig
    : parseProviderConfig(providerConfig);

  return Object.keys(config);
}

/**
 * 标准化发件请求体：
 * - 拼接 fromName 为 `Name <addr>` 格式
 * - to/cc/bcc 统一为数组
 * - replyTo / headers / attachments / scheduledAt 透传
 *
 * 返回的字段名沿用 Resend 习惯（reply_to / scheduled_at），各 provider 自行映射。
 *
 * @param {object} payload - 原始 payload
 * @returns {object} 标准化后的对象
 */
export function normalizeSendPayload(payload) {
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
