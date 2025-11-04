/**
 * 邮件发送 API 模块
 * @module api/send
 */

import { getJwtPayload, errorResponse } from './helpers.js';
import { getCachedSystemStat } from '../utils/cache.js';
import { recordSentEmail, updateSentEmail } from '../db/index.js';
import {
  sendEmailWithAutoResend,
  sendBatchWithAutoResend,
  getEmailFromResend,
  updateEmailInResend,
  cancelEmailInResend
} from '../email/sender.js';

/**
 * 检查发件权限
 * @param {Request} request - HTTP 请求
 * @param {object} db - 数据库连接
 * @param {object} options - 选项
 * @returns {Promise<boolean>} 是否有权限发送
 */
async function checkSendPermission(request, db, options) {
  const payload = getJwtPayload(request, options);
  if (!payload) return false;
  
  // 管理员默认允许
  if (payload.role === 'admin') return true;
  
  // 普通用户检查 can_send 权限（使用缓存）
  if (payload.userId) {
    const cacheKey = `user_can_send_${payload.userId}`;
    
    const canSend = await getCachedSystemStat(db, cacheKey, async (db) => {
      const { results } = await db.prepare('SELECT can_send FROM users WHERE id = ?').bind(payload.userId).all();
      return results?.[0]?.can_send ? 1 : 0;
    });
    
    return canSend === 1;
  }
  
  return false;
}

/**
 * 处理邮件发送相关 API
 * @param {Request} request - HTTP 请求
 * @param {object} db - 数据库连接
 * @param {URL} url - 请求 URL
 * @param {string} path - 请求路径
 * @param {object} options - 选项
 * @returns {Promise<Response|null>} 响应或 null（未匹配）
 */
export async function handleSendApi(request, db, url, path, options) {
  const isMock = !!options.mockOnly;
  const RESEND_API_KEY = options.resendApiKey || '';

  // 发件记录列表
  if (path === '/api/sent' && request.method === 'GET') {
    if (isMock) {
      return Response.json([]);
    }
    const from = url.searchParams.get('from') || url.searchParams.get('mailbox') || '';
    if (!from) { return errorResponse('缺少 from 参数', 400); }
    try {
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 50);
      const { results } = await db.prepare(`
        SELECT id, resend_id, to_addrs as recipients, subject, created_at, status
        FROM sent_emails
        WHERE from_addr = ?
        ORDER BY datetime(created_at) DESC
        LIMIT ?
      `).bind(String(from).trim().toLowerCase(), limit).all();
      return Response.json(results || []);
    } catch (e) {
      console.error('查询发件记录失败:', e);
      return errorResponse('查询发件记录失败', 500);
    }
  }

  // 发件详情
  if (request.method === 'GET' && path.startsWith('/api/sent/')) {
    if (isMock) { return errorResponse('演示模式不可查询真实发送', 403); }
    const id = path.split('/')[3];
    try {
      const { results } = await db.prepare(`
        SELECT id, resend_id, from_addr, to_addrs as recipients, subject,
               html_content, text_content, status, scheduled_at, created_at
        FROM sent_emails WHERE id = ?
      `).bind(id).all();
      if (!results || !results.length) return errorResponse('未找到发件', 404);
      return Response.json(results[0]);
    } catch (e) {
      return errorResponse('查询失败', 500);
    }
  }

  // 删除发件记录
  if (request.method === 'DELETE' && path.startsWith('/api/sent/')) {
    if (isMock) return errorResponse('演示模式不可操作', 403);
    const id = path.split('/')[3];
    try {
      await db.prepare('DELETE FROM sent_emails WHERE id = ?').bind(id).run();
      return Response.json({ success: true });
    } catch (e) {
      return errorResponse('删除发件记录失败: ' + e.message, 500);
    }
  }

  // 发送单封邮件
  if (path === '/api/send' && request.method === 'POST') {
    if (isMock) return errorResponse('演示模式不可发送', 403);
    try {
      if (!RESEND_API_KEY) return errorResponse('未配置 Resend API Key', 500);
      
      const allowed = await checkSendPermission(request, db, options);
      if (!allowed) return errorResponse('未授权发件或该用户未被授予发件权限', 403);
      const sendPayload = await request.json();
      const result = await sendEmailWithAutoResend(RESEND_API_KEY, sendPayload);
      await recordSentEmail(db, {
        resendId: result.id || null,
        fromName: sendPayload.fromName || null,
        from: sendPayload.from,
        to: sendPayload.to,
        subject: sendPayload.subject,
        html: sendPayload.html,
        text: sendPayload.text,
        status: 'delivered',
        scheduledAt: sendPayload.scheduledAt || null
      });
      return Response.json({ success: true, id: result.id });
    } catch (e) {
      return errorResponse('发送失败: ' + e.message, 500);
    }
  }

  // 批量发送
  if (path === '/api/send/batch' && request.method === 'POST') {
    if (isMock) return errorResponse('演示模式不可发送', 403);
    try {
      if (!RESEND_API_KEY) return errorResponse('未配置 Resend API Key', 500);
      
      const allowed = await checkSendPermission(request, db, options);
      if (!allowed) return errorResponse('未授权发件或该用户未被授予发件权限', 403);
      const items = await request.json();
      const result = await sendBatchWithAutoResend(RESEND_API_KEY, items);
      try {
        const arr = Array.isArray(result) ? result : [];
        for (let i = 0; i < arr.length; i++) {
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
      } catch (_) { /* ignore */ }
      return Response.json({ success: true, result });
    } catch (e) {
      return errorResponse('批量发送失败: ' + e.message, 500);
    }
  }

  // 查询发送结果
  if (path.startsWith('/api/send/') && request.method === 'GET') {
    if (isMock) return errorResponse('演示模式不可查询真实发送', 403);
    const id = path.split('/')[3];
    try {
      if (!RESEND_API_KEY) return errorResponse('未配置 Resend API Key', 500);
      const data = await getEmailFromResend(RESEND_API_KEY, id);
      return Response.json(data);
    } catch (e) {
      return errorResponse('查询失败: ' + e.message, 500);
    }
  }

  // 更新（修改定时/状态等）
  if (path.startsWith('/api/send/') && request.method === 'PATCH') {
    if (isMock) return errorResponse('演示模式不可操作', 403);
    const id = path.split('/')[3];
    try {
      if (!RESEND_API_KEY) return errorResponse('未配置 Resend API Key', 500);
      const body = await request.json();
      let data = { ok: true };
      if (body && typeof body.status === 'string') {
        await updateSentEmail(db, id, { status: body.status });
      }
      if (body && body.scheduledAt) {
        data = await updateEmailInResend(RESEND_API_KEY, { id, scheduledAt: body.scheduledAt });
        await updateSentEmail(db, id, { scheduled_at: body.scheduledAt });
      }
      return Response.json(data || { ok: true });
    } catch (e) {
      return errorResponse('更新失败: ' + e.message, 500);
    }
  }

  // 取消发送
  if (path.startsWith('/api/send/') && path.endsWith('/cancel') && request.method === 'POST') {
    if (isMock) return errorResponse('演示模式不可操作', 403);
    const id = path.split('/')[3];
    try {
      if (!RESEND_API_KEY) return errorResponse('未配置 Resend API Key', 500);
      const data = await cancelEmailInResend(RESEND_API_KEY, id);
      await updateSentEmail(db, id, { status: 'canceled' });
      return Response.json(data);
    } catch (e) {
      return errorResponse('取消失败: ' + e.message, 500);
    }
  }

  return null;
}
