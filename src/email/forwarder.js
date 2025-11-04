/**
 * 邮件转发模块
 * @module email/forwarder
 */

/**
 * 根据收件人本地部分前缀转发邮件
 * @param {object} message - 邮件消息对象
 * @param {string} localPart - 收件人的本地部分
 * @param {object} ctx - 上下文对象
 * @param {object} env - 环境变量对象
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
 * 解析转发规则字符串
 * @param {string} rulesRaw - 原始规则字符串
 * @returns {Array<object>} 标准化的规则数组
 */
function parseForwardRules(rulesRaw) {
  if (rulesRaw === undefined || rulesRaw === null) {
    return [];
  }
  const trimmed = String(rulesRaw).trim();
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
 * 标准化规则数组
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
 * @returns {string|null} 目标邮箱地址
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

/**
 * 根据邮箱数据库配置转发邮件
 * @param {object} message - 邮件消息对象
 * @param {string} forwardTo - 数据库中配置的转发目标地址
 * @param {object} ctx - 上下文对象
 * @returns {boolean} 是否成功触发转发
 */
export function forwardByMailboxConfig(message, forwardTo, ctx) {
  if (!forwardTo || typeof forwardTo !== 'string') return false;
  const target = forwardTo.trim();
  if (!target) return false;

  try {
    ctx.waitUntil(message.forward(target));
    console.log(`邮件已转发至: ${target} (邮箱配置)`);
    return true;
  } catch (e) {
    console.error('邮箱配置转发失败:', e);
    return false;
  }
}
