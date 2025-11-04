/**
 * 发送邮件记录数据库操作模块
 * @module db/sentEmails
 */

/**
 * 记录发送的邮件信息到数据库
 * @param {object} db - 数据库连接对象
 * @param {object} params - 邮件参数对象
 * @param {string} params.resendId - Resend服务的邮件ID
 * @param {string} params.fromName - 发件人姓名
 * @param {string} params.from - 发件人邮箱地址
 * @param {string|Array<string>} params.to - 收件人邮箱地址
 * @param {string} params.subject - 邮件主题
 * @param {string} params.html - HTML内容
 * @param {string} params.text - 纯文本内容
 * @param {string} params.status - 邮件状态，默认为'queued'
 * @param {string} params.scheduledAt - 计划发送时间，默认为null
 * @returns {Promise<void>} 记录完成后无返回值
 */
export async function recordSentEmail(db, { resendId, fromName, from, to, subject, html, text, status = 'queued', scheduledAt = null }) {
  const toAddrs = Array.isArray(to) ? to.join(',') : String(to || '');
  await db.prepare(`
    INSERT INTO sent_emails (resend_id, from_name, from_addr, to_addrs, subject, html_content, text_content, status, scheduled_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(resendId || null, fromName || null, from, toAddrs, subject, html || null, text || null, status, scheduledAt || null).run();
}

/**
 * 更新已发送邮件的状态信息
 * @param {object} db - 数据库连接对象
 * @param {string} resendId - Resend服务的邮件ID
 * @param {object} fields - 需要更新的字段对象
 * @returns {Promise<void>} 更新完成后无返回值
 */
export async function updateSentEmail(db, resendId, fields) {
  if (!resendId) return;
  const allowed = ['status', 'scheduled_at'];
  const setClauses = [];
  const values = [];
  for (const key of allowed) {
    if (key in (fields || {})) {
      setClauses.push(`${key} = ?`);
      values.push(fields[key]);
    }
  }
  if (!setClauses.length) return;
  setClauses.push('updated_at = CURRENT_TIMESTAMP');
  const sql = `UPDATE sent_emails SET ${setClauses.join(', ')} WHERE resend_id = ?`;
  values.push(resendId);
  await db.prepare(sql).bind(...values).run();
}
