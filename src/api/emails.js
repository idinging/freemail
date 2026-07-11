/**
 * 邮件 API 处理器。
 * @module api/emails
 */

import { getMailboxAccess, getMessageAccess, errorResponse } from './helpers.js';
import { buildMockEmails, buildMockEmailDetail } from './mock.js';
import { extractEmail } from '../utils/common.js';
import { getMailboxIdByAddress } from '../db/index.js';
import { parseEmailBody } from '../email/parser.js';
import { createEmailStorage } from '../email/storage.js';
import { purgeMailboxData } from '../db/mailboxCleanup.js';

// 邮箱登录模式只允许查看最近 24 小时内的邮件。
function mailboxOnlyTimeFilter(enabled) {
  if (!enabled) return { sql: '', params: [] };
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);
  return {
    sql: ' AND received_at >= ?',
    params: [cutoff]
  };
}

// 邮件正文优先从对象存储的原始 EML 解析，失败时由调用方回退到数据库字段。
async function loadEmailBodyFromStorage(storage, objectKey, storageType) {
  if (!storage || !objectKey) return { content: '', html_content: '' };
  try {
    const value = await storage.get(objectKey, storageType);
    if (!value) return { content: '', html_content: '' };
    const raw = new TextDecoder().decode(value);
    const parsed = await parseEmailBody(raw || '');
    return { content: parsed.text || '', html_content: parsed.html || '' };
  } catch (_) {
    return { content: '', html_content: '' };
  }
}

export async function handleEmailsApi(request, db, url, path, options) {
  const isMock = !!options.mockOnly;
  const isMailboxOnly = !!options.mailboxOnly;
  const storage = options.storage || createEmailStorage({ kv: options.kv, r2: options.r2 });

  if (path === '/api/emails' && request.method === 'GET') {
    const mailbox = url.searchParams.get('mailbox');
    if (!mailbox) return errorResponse('缺少 mailbox 参数', 400);
    try {
      if (isMock) return Response.json(buildMockEmails(6));

      const normalized = extractEmail(mailbox).trim().toLowerCase();
      const mailboxId = await getMailboxIdByAddress(db, normalized);
      if (!mailboxId) return Response.json([]);
      const access = await getMailboxAccess(db, request, options, { mailboxId });
      if (!access.allowed) return errorResponse('Forbidden', 403);

      const filter = mailboxOnlyTimeFilter(isMailboxOnly);
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 50);
      try {
        const { results } = await db.prepare(`
          SELECT id, sender, to_addrs, subject, received_at, is_read, preview, verification_code
          FROM messages
          WHERE mailbox_id = ?${filter.sql}
          ORDER BY received_at DESC
          LIMIT ?
        `).bind(mailboxId, ...filter.params, limit).all();
        return Response.json(results || []);
      } catch (_) {
        const { results } = await db.prepare(`
          SELECT id, sender, to_addrs, subject, received_at, is_read,
                 CASE WHEN content IS NOT NULL AND content <> ''
                      THEN SUBSTR(content, 1, 120)
                      ELSE SUBSTR(COALESCE(html_content, ''), 1, 120)
                 END AS preview
          FROM messages
          WHERE mailbox_id = ?${filter.sql}
          ORDER BY received_at DESC
          LIMIT ?
        `).bind(mailboxId, ...filter.params, limit).all();
        return Response.json(results || []);
      }
    } catch (e) {
      console.error('查询邮件失败:', e);
      return errorResponse('查询邮件失败', 500);
    }
  }

  if (path === '/api/emails/batch' && request.method === 'GET') {
    try {
      const idsParam = String(url.searchParams.get('ids') || '').trim();
      if (!idsParam) return Response.json([]);
      const ids = idsParam.split(',').map(s => parseInt(s, 10)).filter(n => Number.isInteger(n) && n > 0);
      if (!ids.length) return Response.json([]);
      if (ids.length > 50) return errorResponse('单次最多查询50封邮件', 400);
      if (isMock) return Response.json(ids.map(id => buildMockEmailDetail(id)));

      for (const id of ids) {
        const access = await getMessageAccess(db, request, options, id);
        if (access.exists && !access.allowed) return errorResponse('Forbidden', 403);
      }

      const filter = mailboxOnlyTimeFilter(isMailboxOnly);
      const placeholders = ids.map(() => '?').join(',');
      try {
        const { results } = await db.prepare(`
          SELECT id, sender, to_addrs, subject, verification_code, preview, r2_bucket, r2_object_key, received_at, is_read
          FROM messages WHERE id IN (${placeholders})${filter.sql}
        `).bind(...ids, ...filter.params).all();
        return Response.json(results || []);
      } catch (_) {
        const { results } = await db.prepare(`
          SELECT id, sender, to_addrs, subject, content, html_content, received_at, is_read
          FROM messages WHERE id IN (${placeholders})${filter.sql}
        `).bind(...ids, ...filter.params).all();
        return Response.json(results || []);
      }
    } catch (_) {
      return errorResponse('批量查询失败', 500);
    }
  }

  if (request.method === 'DELETE' && path === '/api/emails') {
    if (isMock) return errorResponse('演示模式不可清空', 403);
    const mailbox = url.searchParams.get('mailbox');
    if (!mailbox) return errorResponse('缺少 mailbox 参数', 400);
    try {
      const normalized = extractEmail(mailbox).trim().toLowerCase();
      const mailboxId = await getMailboxIdByAddress(db, normalized);
      if (!mailboxId) return Response.json({ success: true, deletedCount: 0 });
      const access = await getMailboxAccess(db, request, options, { mailboxId });
      if (!access.allowed) return errorResponse('Forbidden', 403);

      const deleted = await purgeMailboxData({
        db,
        mailboxId,
        address: normalized,
        storage,
        deleteMailbox: false
      });

      return Response.json({
        success: true,
        deletedCount: deleted.inboxDeletedCount + deleted.sentDeletedCount,
        inboxDeletedCount: deleted.inboxDeletedCount,
        sentDeletedCount: deleted.sentDeletedCount
      });
    } catch (e) {
      console.error('清空邮件失败:', e);
      return errorResponse('清空邮件失败', 500);
    }
  }

  if (request.method === 'GET' && path.startsWith('/api/email/') && path.endsWith('/download')) {
    if (isMock) return errorResponse('演示模式不可下载', 403);
    const id = path.split('/')[3];
    const access = await getMessageAccess(db, request, options, id);
    if (!access.exists) return errorResponse('未找到邮件', 404);
    if (!access.allowed) return errorResponse('Forbidden', 403);

    const filter = mailboxOnlyTimeFilter(isMailboxOnly);
    const { results } = await db.prepare(
      `SELECT r2_bucket, r2_object_key FROM messages WHERE id = ?${filter.sql}`
    ).bind(id, ...filter.params).all();
    const row = (results || [])[0];
    if (!row || !row.r2_object_key) return errorResponse('未找到对象', 404);
    try {
      if (!storage.available) return errorResponse('邮件存储未绑定', 500);
      const value = await storage.get(row.r2_object_key, row.r2_bucket);
      if (!value) return errorResponse('对象不存在', 404);
      const headers = new Headers({ 'Content-Type': 'message/rfc822' });
      headers.set('Content-Disposition', `attachment; filename="${String(row.r2_object_key).split('/').pop()}"`);
      return new Response(value, { headers });
    } catch (_) {
      return errorResponse('下载失败', 500);
    }
  }

  if (request.method === 'GET' && path.startsWith('/api/email/')) {
    const emailId = path.split('/')[3];
    if (isMock) return Response.json(buildMockEmailDetail(emailId));

    const access = await getMessageAccess(db, request, options, emailId);
    if (!access.exists) return errorResponse('未找到邮件', 404);
    if (!access.allowed) return errorResponse('Forbidden', 403);

    const filter = mailboxOnlyTimeFilter(isMailboxOnly);
    try {
      const { results } = await db.prepare(`
        SELECT id, sender, to_addrs, subject, verification_code, preview, r2_bucket, r2_object_key, received_at, is_read
        FROM messages WHERE id = ?${filter.sql}
      `).bind(emailId, ...filter.params).all();
      if (!results || results.length === 0) return errorResponse('未找到邮件', 404);

      await db.prepare('UPDATE messages SET is_read = 1 WHERE id = ?').bind(emailId).run();
      const row = results[0];
      let { content, html_content } = await loadEmailBodyFromStorage(storage, row.r2_object_key, row.r2_bucket);

      if (!content && !html_content) {
        try {
          const fallback = await db.prepare('SELECT content, html_content FROM messages WHERE id = ?').bind(emailId).all();
          const fr = (fallback?.results || [])[0] || {};
          content = fr.content || '';
          html_content = fr.html_content || '';
        } catch (_) { }
      }

      return Response.json({
        ...row,
        content,
        html_content,
        download: row.r2_object_key ? `/api/email/${emailId}/download` : ''
      });
    } catch (_) {
      const { results } = await db.prepare(`
        SELECT id, sender, to_addrs, subject, content, html_content, received_at, is_read
        FROM messages WHERE id = ?${filter.sql}
      `).bind(emailId, ...filter.params).all();
      if (!results || !results.length) return errorResponse('未找到邮件', 404);
      await db.prepare('UPDATE messages SET is_read = 1 WHERE id = ?').bind(emailId).run();
      return Response.json(results[0]);
    }
  }

  if (request.method === 'DELETE' && path.startsWith('/api/email/')) {
    if (isMock) return errorResponse('演示模式不可删除', 403);
    const emailId = path.split('/')[3];
    if (!emailId || !Number.isInteger(parseInt(emailId, 10))) return errorResponse('无效的邮件ID', 400);

    const access = await getMessageAccess(db, request, options, emailId);
    if (!access.exists) return errorResponse('未找到邮件', 404);
    if (!access.allowed) return errorResponse('Forbidden', 403);

    try {
      const filter = mailboxOnlyTimeFilter(isMailboxOnly);
      const row = await db.prepare(
        `SELECT r2_bucket, r2_object_key FROM messages WHERE id = ?${filter.sql}`
      ).bind(emailId, ...filter.params).first();
      if (!row) return errorResponse('未找到邮件', 404);
      if (row.r2_object_key) {
        const objectDeleted = await storage.delete(row.r2_object_key, row.r2_bucket);
        if (!objectDeleted) return errorResponse('邮件对象删除失败，请稍后重试', 500);
      }
      const result = await db.prepare('DELETE FROM messages WHERE id = ?').bind(emailId).run();
      const deleted = (result?.meta?.changes || 0) > 0;

      return Response.json({
        success: true,
        deleted,
        message: deleted ? '邮件已删除' : '邮件不存在或已被删除'
      });
    } catch (e) {
      console.error('删除邮件失败:', e);
      return errorResponse('删除邮件时发生错误: ' + e.message, 500);
    }
  }

  return null;
}
