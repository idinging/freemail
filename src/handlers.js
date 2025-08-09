import { extractEmail, generateRandomId } from './utils.js';
import { buildMockEmails, buildMockMailboxes, buildMockEmailDetail } from './mock.js';
import { getOrCreateMailboxId, getMailboxIdByAddress } from './db.js';

export async function handleApiRequest(request, db, mailDomains, options = { mockOnly: false }) {
  const url = new URL(request.url);
  const path = url.pathname;
  const isMock = !!options.mockOnly;

  // 返回域名列表给前端
  if (path === '/api/domains' && request.method === 'GET') {
    const domains = Array.isArray(mailDomains) ? mailDomains : [(mailDomains || 'temp.example.com')];
    return Response.json(domains);
  }

  if (path === '/api/generate') {
    const lengthParam = Number(url.searchParams.get('length') || 0);
    const randomId = generateRandomId(lengthParam || undefined);
    const domains = Array.isArray(mailDomains) ? mailDomains : [(mailDomains || 'temp.example.com')];
    const domainIdx = Math.max(0, Math.min(domains.length - 1, Number(url.searchParams.get('domainIndex') || 0)));
    const chosenDomain = domains[domainIdx] || domains[0];
    const email = `${randomId}@${chosenDomain}`;
    // 访客模式不写入历史
    if (!isMock) {
      try { await getOrCreateMailboxId(db, email); } catch (_) {}
    }
    return Response.json({ email, expires: Date.now() + 3600000 });
  }

  if (path === '/api/emails' && request.method === 'GET') {
    const mailbox = url.searchParams.get('mailbox');
    if (!mailbox) {
      return new Response('缺少 mailbox 参数', { status: 400 });
    }
    try {
      if (isMock) {
        return Response.json(buildMockEmails(6));
      }
      const normalized = extractEmail(mailbox).trim().toLowerCase();
      const mailboxId = await getOrCreateMailboxId(db, normalized);
      const { results } = await db.prepare(`
        SELECT id, sender, subject, received_at, is_read 
        FROM messages 
        WHERE mailbox_id = ? 
        ORDER BY received_at DESC 
        LIMIT 50
      `).bind(mailboxId).all();
      return Response.json(results);
    } catch (e) {
      console.error('查询邮件失败:', e);
      return new Response('查询邮件失败', { status: 500 });
    }
  }

  // 历史邮箱列表（按创建时间倒序）支持分页
  if (path === '/api/mailboxes' && request.method === 'GET') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '10', 10), 100);
    const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10), 0);
    if (isMock) {
      return Response.json(buildMockMailboxes(limit, offset, mailDomains));
    }
    const { results } = await db.prepare(`
      SELECT address, created_at
      FROM mailboxes
      ORDER BY datetime(created_at) DESC
      LIMIT ? OFFSET ?
    `).bind(limit, offset).all();
    return Response.json(results || []);
  }

  // 删除邮箱（及其所有邮件）
  if (path === '/api/mailboxes' && request.method === 'DELETE') {
    if (isMock) return new Response('演示模式不可删除', { status: 403 });
    const address = url.searchParams.get('address');
    if (!address) return new Response('缺少 address 参数', { status: 400 });
    try {
      const mailboxId = await getMailboxIdByAddress(db, address);
      if (!mailboxId) return Response.json({ success: true });
      await db.prepare('DELETE FROM messages WHERE mailbox_id = ?').bind(mailboxId).run();
      await db.prepare('DELETE FROM mailboxes WHERE id = ?').bind(mailboxId).run();
      return Response.json({ success: true });
    } catch (e) {
      return new Response('删除失败', { status: 500 });
    }
  }

  if (request.method === 'GET' && path.startsWith('/api/email/')) {
    const emailId = path.split('/')[3];
    if (isMock) {
      return Response.json(buildMockEmailDetail(emailId));
    }
    const { results } = await db.prepare(`
      SELECT * FROM messages WHERE id = ?
    `).bind(emailId).all();
    if (results.length === 0) {
      return new Response('未找到邮件', { status: 404 });
    }
    await db.prepare(`
      UPDATE messages SET is_read = 1 WHERE id = ?
    `).bind(emailId).run();
    return Response.json(results[0]);
  }

  if (request.method === 'DELETE' && path.startsWith('/api/email/')) {
    if (isMock) return new Response('演示模式不可删除', { status: 403 });
    const emailId = path.split('/')[3];
    
    if (!emailId || !Number.isInteger(parseInt(emailId))) {
      return new Response('无效的邮件ID', { status: 400 });
    }
    
    try {
      // 先检查邮件是否存在
      const existsResult = await db.prepare(`SELECT COUNT(*) as count FROM messages WHERE id = ?`).bind(emailId).all();
      const existsBefore = existsResult.results[0]?.count || 0;
      
      if (existsBefore === 0) {
        return Response.json({ success: true, deleted: false, message: '邮件不存在或已被删除' });
      }
      
      await db.prepare(`DELETE FROM messages WHERE id = ?`).bind(emailId).run();
      
      // 再次检查确认删除
      const existsAfterResult = await db.prepare(`SELECT COUNT(*) as count FROM messages WHERE id = ?`).bind(emailId).all();
      const existsAfter = existsAfterResult.results[0]?.count || 0;
      
      const actualDeleted = existsBefore - existsAfter;
      
      return Response.json({ 
        success: true, 
        deleted: actualDeleted > 0,
        message: actualDeleted > 0 ? '邮件已删除' : '删除操作未生效'
      });
    } catch (e) {
      console.error('删除邮件失败:', e);
      return new Response('删除邮件时发生错误: ' + e.message, { status: 500 });
    }
  }

  if (request.method === 'DELETE' && path === '/api/emails') {
    if (isMock) return new Response('演示模式不可清空', { status: 403 });
    const mailbox = url.searchParams.get('mailbox');
    if (!mailbox) {
      return new Response('缺少 mailbox 参数', { status: 400 });
    }
    try {
      const normalized = extractEmail(mailbox).trim().toLowerCase();
      const mailboxId = await getOrCreateMailboxId(db, normalized);
      
      // 先查询当前有多少邮件
      const countBeforeResult = await db.prepare(`SELECT COUNT(*) as count FROM messages WHERE mailbox_id = ?`).bind(mailboxId).all();
      const countBefore = countBeforeResult.results[0]?.count || 0;
      
      await db.prepare(`DELETE FROM messages WHERE mailbox_id = ?`).bind(mailboxId).run();
      
      // 再次查询确认删除后的数量
      const countAfterResult = await db.prepare(`SELECT COUNT(*) as count FROM messages WHERE mailbox_id = ?`).bind(mailboxId).all();
      const countAfter = countAfterResult.results[0]?.count || 0;
      
      // 通过前后对比计算实际删除的数量
      const actualDeletedCount = countBefore - countAfter;
      
      return Response.json({ 
        success: true, 
        deletedCount: actualDeletedCount, 
        previousCount: countBefore
      });
    } catch (e) {
      console.error('清空邮件失败:', e);
      return new Response('清空邮件失败', { status: 500 });
    }
  }

  return new Response('未找到 API 路径', { status: 404 });
}

export async function handleEmailReceive(request, db) {
  try {
    const emailData = await request.json();
    const { to, from, subject, text, html } = emailData;
    const mailbox = extractEmail(to);
    const sender = extractEmail(from);
    await db.prepare(`
      INSERT INTO emails (mailbox, sender, subject, content, html_content)
      VALUES (?, ?, ?, ?, ?)
    `).bind(mailbox, sender, subject || '(无主题)', text || '', html || '').run();
    return Response.json({ success: true });
  } catch (error) {
    console.error('处理邮件时出错:', error);
    return new Response('处理邮件失败', { status: 500 });
  }
}

