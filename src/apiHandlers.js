import { extractEmail, generateRandomId } from './commonUtils.js';
import { buildMockEmails, buildMockMailboxes, buildMockEmailDetail } from './mockData.js';
import { getOrCreateMailboxId, getMailboxIdByAddress, recordSentEmail, updateSentEmail, ensureSentEmailsTable, toggleMailboxPin } from './database.js';
import { sendEmailWithResend, sendBatchWithResend, getEmailFromResend, updateEmailInResend, cancelEmailInResend } from './emailSender.js';

export async function handleApiRequest(request, db, mailDomains, options = { mockOnly: false, resendApiKey: '' }) {
  const url = new URL(request.url);
  const path = url.pathname;
  const isMock = !!options.mockOnly;
  const RESEND_API_KEY = options.resendApiKey || '';

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

  // 自定义创建邮箱：{ local, domainIndex }
  if (path === '/api/create' && request.method === 'POST'){
    if (isMock){
      // demo 模式下仍然允许创建到 example.com（仅内存，不写库）
      try{
        const body = await request.json();
        const local = String(body.local || '').trim().toLowerCase();
        const valid = /^[a-z0-9._-]{1,64}$/i.test(local);
        if (!valid) return new Response('非法用户名', { status: 400 });
        const domains = Array.isArray(mailDomains) ? mailDomains : [(mailDomains || 'example.com')];
        const domainIdx = Math.max(0, Math.min(domains.length - 1, Number(body.domainIndex || 0)));
        const chosenDomain = domains[domainIdx] || domains[0];
        const email = `${local}@${chosenDomain}`;
        return Response.json({ email, expires: Date.now() + 3600000 });
      }catch(_){ return new Response('Bad Request', { status: 400 }); }
    }
    try{
      const body = await request.json();
      const local = String(body.local || '').trim().toLowerCase();
      const valid = /^[a-z0-9._-]{1,64}$/i.test(local);
      if (!valid) return new Response('非法用户名', { status: 400 });
      const domains = Array.isArray(mailDomains) ? mailDomains : [(mailDomains || 'temp.example.com')];
      const domainIdx = Math.max(0, Math.min(domains.length - 1, Number(body.domainIndex || 0)));
      const chosenDomain = domains[domainIdx] || domains[0];
      const email = `${local}@${chosenDomain}`;
      await getOrCreateMailboxId(db, email);
      return Response.json({ email, expires: Date.now() + 3600000 });
    }catch(e){ return new Response('创建失败', { status: 500 }); }
  }

  // 发件记录列表（按发件人地址过滤）
  if (path === '/api/sent' && request.method === 'GET'){
    if (isMock){
      return Response.json([]);
    }
    const from = url.searchParams.get('from') || url.searchParams.get('mailbox') || '';
    if (!from){ return new Response('缺少 from 参数', { status: 400 }); }
    try{
      await ensureSentEmailsTable(db);
      const { results } = await db.prepare(`
        SELECT id, resend_id, to_addrs as recipients, subject, created_at, status
        FROM sent_emails
        WHERE from_addr = ?
        ORDER BY datetime(created_at) DESC
        LIMIT 50
      `).bind(String(from).trim().toLowerCase()).all();
      return Response.json(results || []);
    }catch(e){
      console.error('查询发件记录失败:', e);
      return new Response('查询发件记录失败', { status: 500 });
    }
  }

  // 发件详情
  if (request.method === 'GET' && path.startsWith('/api/sent/')){
    if (isMock){ return new Response('演示模式不可查询真实发送', { status: 403 }); }
    const id = path.split('/')[3];
    try{
      const { results } = await db.prepare(`
        SELECT id, resend_id, from_addr, to_addrs as recipients, subject,
               html_content, text_content, status, scheduled_at, created_at
        FROM sent_emails WHERE id = ?
      `).bind(id).all();
      if (!results || !results.length) return new Response('未找到发件', { status: 404 });
      return Response.json(results[0]);
    }catch(e){
      return new Response('查询失败', { status: 500 });
    }
  }

  // 发送单封邮件
  if (path === '/api/send' && request.method === 'POST'){
    if (isMock) return new Response('演示模式不可发送', { status: 403 });
    try{
      if (!RESEND_API_KEY) return new Response('未配置 Resend API Key', { status: 500 });
      const payload = await request.json();
      const result = await sendEmailWithResend(RESEND_API_KEY, payload);
      await ensureSentEmailsTable(db);
      await recordSentEmail(db, {
        resendId: result.id || null,
        fromName: payload.fromName || null,
        from: payload.from,
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        status: 'delivered',
        scheduledAt: payload.scheduledAt || null
      });
      return Response.json({ success: true, id: result.id });
    }catch(e){
      return new Response('发送失败: ' + e.message, { status: 500 });
    }
  }

  // 批量发送
  if (path === '/api/send/batch' && request.method === 'POST'){
    if (isMock) return new Response('演示模式不可发送', { status: 403 });
    try{
      if (!RESEND_API_KEY) return new Response('未配置 Resend API Key', { status: 500 });
      const items = await request.json();
      const result = await sendBatchWithResend(RESEND_API_KEY, items);
      try{
        await ensureSentEmailsTable(db);
        // 尝试记录（如果返回结构包含 id 列表）
        const arr = Array.isArray(result) ? result : [];
        for (let i = 0; i < arr.length; i++){
          const id = arr[i]?.id;
          const payload = items[i] || {};
          await recordSentEmail(db, {
            resendId: id || null,
            fromName: payload.fromName || null,
            from: payload.from,
            to: payload.to,
            subject: payload.subject,
            html: payload.html,
            text: payload.text,
            status: 'delivered',
            scheduledAt: payload.scheduledAt || null
          });
        }
      }catch(_){/* ignore */}
      return Response.json({ success: true, result });
    }catch(e){
      return new Response('批量发送失败: ' + e.message, { status: 500 });
    }
  }

  // 查询发送结果
  if (path.startsWith('/api/send/') && request.method === 'GET'){
    if (isMock) return new Response('演示模式不可查询真实发送', { status: 403 });
    const id = path.split('/')[3];
    try{
      if (!RESEND_API_KEY) return new Response('未配置 Resend API Key', { status: 500 });
      const data = await getEmailFromResend(RESEND_API_KEY, id);
      return Response.json(data);
    }catch(e){
      return new Response('查询失败: ' + e.message, { status: 500 });
    }
  }

  // 更新（修改定时/状态等）
  if (path.startsWith('/api/send/') && request.method === 'PATCH'){
    if (isMock) return new Response('演示模式不可操作', { status: 403 });
    const id = path.split('/')[3];
    try{
      if (!RESEND_API_KEY) return new Response('未配置 Resend API Key', { status: 500 });
      const body = await request.json();
      let data = { ok: true };
      // 如果只是更新本地状态，不必请求 Resend
      if (body && typeof body.status === 'string'){
        await updateSentEmail(db, id, { status: body.status });
      }
      // 更新定时设置时需要触达 Resend
      if (body && body.scheduledAt){
        data = await updateEmailInResend(RESEND_API_KEY, { id, scheduledAt: body.scheduledAt });
        await updateSentEmail(db, id, { scheduled_at: body.scheduledAt });
      }
      return Response.json(data || { ok: true });
    }catch(e){
      return new Response('更新失败: ' + e.message, { status: 500 });
    }
  }

  // 取消发送
  if (path.startsWith('/api/send/') && path.endsWith('/cancel') && request.method === 'POST'){
    if (isMock) return new Response('演示模式不可操作', { status: 403 });
    const id = path.split('/')[3];
    try{
      if (!RESEND_API_KEY) return new Response('未配置 Resend API Key', { status: 500 });
      const data = await cancelEmailInResend(RESEND_API_KEY, id);
      await updateSentEmail(db, id, { status: 'canceled' });
      return Response.json(data);
    }catch(e){
      return new Response('取消失败: ' + e.message, { status: 500 });
    }
  }

  // 删除发件记录
  if (request.method === 'DELETE' && path.startsWith('/api/sent/')){
    if (isMock) return new Response('演示模式不可操作', { status: 403 });
    const id = path.split('/')[3];
    try{
      await db.prepare('DELETE FROM sent_emails WHERE id = ?').bind(id).run();
      return Response.json({ success: true });
    }catch(e){
      return new Response('删除发件记录失败: ' + e.message, { status: 500 });
    }
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
      SELECT address, created_at, is_pinned
      FROM mailboxes
      ORDER BY is_pinned DESC, datetime(created_at) DESC
      LIMIT ? OFFSET ?
    `).bind(limit, offset).all();
    return Response.json(results || []);
  }

  // 切换邮箱置顶状态
  if (path === '/api/mailboxes/pin' && request.method === 'POST') {
    if (isMock) return new Response('演示模式不可操作', { status: 403 });
    const address = url.searchParams.get('address');
    if (!address) return new Response('缺少 address 参数', { status: 400 });
    try {
      const result = await toggleMailboxPin(db, address);
      return Response.json({ success: true, ...result });
    } catch (e) {
      return new Response('操作失败: ' + e.message, { status: 500 });
    }
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

