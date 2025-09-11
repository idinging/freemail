/**
 * 根据收件人本地部分前缀转发邮件。
 *
 * 可通过环境变量 env.FORWARD_RULES 配置两种格式的规则：
 * 1) JSON 数组字符串：[{"prefix":"xms","email":"a@example.com"}, {"prefix":"*","email":"default@example.com"}]
 * 2) 逗号分隔的 KV 字符串："xms=a@example.com,lz=b@example.com,*=default@example.com"
 *
 * 未设置该变量时：不做任何转发（默认关闭）。
 * 若显式设置为空/禁用（""、"[]"、"disabled"、"none"），也不做任何转发。
 * @param {object} message - 邮件消息对象
 * @param {string} localPart - 收件人的本地部分（@符号前的部分）
 * @param {object} ctx - 上下文对象，用于waitUntil处理异步操作
 * @param {object} env - 环境变量对象，包含转发规则配置
 */
export function forwardByLocalPart(message, localPart, ctx, env) {
  const rules = parseForwardRules(env?.FORWARD_RULES);
  const target = resolveTargetEmail(localPart, rules);
  if (!target) return;
  try {
    ctx.waitUntil(message.forward(target));
  } catch (e) {
    console.error('Forward error:', e);
  }
}

/**
 * 解析转发规则字符串，支持JSON和KV格式
 * @param {string} rulesRaw - 原始规则字符串，可以是JSON数组或逗号分隔的KV对
 * @returns {Array<object>} 标准化的规则数组，每个元素包含prefix和email属性
 */
function parseForwardRules(rulesRaw) {
  // 未设置变量 → 不转发（默认关闭）
  if (rulesRaw === undefined || rulesRaw === null) {
    return [];
  }
  const trimmed = String(rulesRaw).trim();
  // 显式设置为空/禁用 → 不转发
  if (
    trimmed === '' ||
    trimmed === '[]' ||
    trimmed.toLowerCase() === 'disabled' ||
    trimmed.toLowerCase() === 'none'
  ) {
    return [];
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return normalizeRules(parsed);
    }
  } catch (_) {
    // 非 JSON → 按 kv 语法解析
  }
  const rules = [];
  for (const pair of trimmed.split(',')) {
    const [prefix, email] = pair.split('=').map(s => (s || '').trim());
    if (!prefix || !email) continue;
    rules.push({ prefix, email });
  }
  return normalizeRules(rules);
}

/**
 * 标准化规则数组，确保每个规则包含有效的prefix和email
 * @param {Array<object>} items - 原始规则项数组
 * @returns {Array<object>} 标准化后的规则数组
 */
function normalizeRules(items) {
  const result = [];
  for (const it of items) {
    const prefix = String(it.prefix || '').toLowerCase();
    const email = String(it.email || '').trim();
    if (!prefix || !email) continue;
    result.push({ prefix, email });
  }
  return result;
}

/**
 * 根据本地部分和规则解析目标邮箱地址
 * @param {string} localPart - 收件人的本地部分
 * @param {Array<object>} rules - 转发规则数组
 * @returns {string|null} 目标邮箱地址，如果没有匹配的规则则返回null
 */
function resolveTargetEmail(localPart, rules) {
  const lp = String(localPart || '').toLowerCase();
  for (const r of rules) {
    if (r.prefix === '*') continue;
    if (lp.startsWith(r.prefix)) return r.email;
  }
  const wildcard = rules.find(r => r.prefix === '*');
  return wildcard ? wildcard.email : null;
}
