/**
 * 邮箱设置 API 模块 - 处理转发和收藏相关的 API 逻辑
 * @module api/mailboxSettings
 */

import { isValidEmail } from '../utils/common.js';

/**
 * 检查用户是否有权限操作指定邮箱
 * @param {object} db - 数据库连接
 * @param {object} user - 用户对象
 * @param {number} mailboxId - 邮箱 ID
 * @returns {Promise<boolean>} 是否有权限
 */
async function canUserAccessMailbox(db, user, mailboxId) {
  // strictAdmin 和 admin 有全部权限
  if (user.role === 'strictAdmin' || user.role === 'admin') {
    return true;
  }
  
  // 普通用户检查邮箱所有权
  if (user.role === 'user' && user.id) {
    const res = await db.prepare(
      'SELECT 1 FROM user_mailboxes WHERE user_id = ? AND mailbox_id = ? LIMIT 1'
    ).bind(user.id, mailboxId).all();
    return res.results && res.results.length > 0;
  }
  
  // mailbox 角色检查是否是自己的邮箱
  if (user.role === 'mailbox' && user.mailboxId) {
    return user.mailboxId === mailboxId;
  }
  
  return false;
}

/**
 * 设置邮箱转发目标
 * POST /api/mailbox/forward
 * Body: { mailbox_id: number, forward_to: string | null | "" }
 * @param {Request} req - 请求对象
 * @param {object} env - 环境变量
 * @returns {Promise<Response>} 响应对象
 */
export async function handleSetForward(req, env) {
  try {
    const user = req.user;
    if (!user || user.role === 'guest') {
      return new Response(JSON.stringify({ error: '无权限' }), { status: 403 });
    }
    
    const body = await req.json();
    const mailbox_id = Number(body.mailbox_id);
    const { forward_to } = body;
    
    if (!mailbox_id || isNaN(mailbox_id)) {
      return new Response(JSON.stringify({ error: '缺少有效的邮箱 ID' }), { status: 400 });
    }
    
    // 验证转发目标格式（如果提供了的话）
    const forwardTarget = forward_to ? String(forward_to).trim() : null;
    if (forwardTarget && !isValidEmail(forwardTarget)) {
      return new Response(JSON.stringify({ error: '转发目标邮箱格式无效' }), { status: 400 });
    }
    
    const db = env.TEMP_MAIL_DB;
    
    // 检查邮箱是否存在
    const mailbox = await db.prepare('SELECT id, address FROM mailboxes WHERE id = ? LIMIT 1')
      .bind(mailbox_id).first();
    if (!mailbox) {
      return new Response(JSON.stringify({ error: '邮箱不存在' }), { status: 404 });
    }
    
    // 检查权限
    const hasAccess = await canUserAccessMailbox(db, user, mailbox_id);
    if (!hasAccess) {
      return new Response(JSON.stringify({ error: '无权限操作此邮箱' }), { status: 403 });
    }
    
    // 更新转发设置
    await db.prepare('UPDATE mailboxes SET forward_to = ? WHERE id = ?')
      .bind(forwardTarget, mailbox_id).run();
    
    return new Response(JSON.stringify({
      success: true,
      mailbox_id,
      forward_to: forwardTarget
    }), { status: 200 });
    
  } catch (error) {
    console.error('设置转发失败:', error);
    return new Response(JSON.stringify({ error: '设置转发失败' }), { status: 500 });
  }
}

/**
 * 切换邮箱收藏状态
 * POST /api/mailbox/favorite
 * Body: { mailbox_id: number }
 * @param {Request} req - 请求对象
 * @param {object} env - 环境变量
 * @returns {Promise<Response>} 响应对象
 */
export async function handleToggleFavorite(req, env) {
  try {
    const user = req.user;
    if (!user || user.role === 'guest') {
      return new Response(JSON.stringify({ error: '无权限' }), { status: 403 });
    }
    
    const body = await req.json();
    const mailbox_id = Number(body.mailbox_id);
    
    if (!mailbox_id || isNaN(mailbox_id)) {
      return new Response(JSON.stringify({ error: '缺少有效的邮箱 ID' }), { status: 400 });
    }
    
    const db = env.TEMP_MAIL_DB;
    
    // 检查邮箱是否存在
    const mailbox = await db.prepare('SELECT id, is_favorite FROM mailboxes WHERE id = ? LIMIT 1')
      .bind(mailbox_id).first();
    if (!mailbox) {
      return new Response(JSON.stringify({ error: '邮箱不存在' }), { status: 404 });
    }
    
    // 检查权限
    const hasAccess = await canUserAccessMailbox(db, user, mailbox_id);
    if (!hasAccess) {
      return new Response(JSON.stringify({ error: '无权限操作此邮箱' }), { status: 403 });
    }
    
    // 切换收藏状态
    const newFavorite = mailbox.is_favorite ? 0 : 1;
    await db.prepare('UPDATE mailboxes SET is_favorite = ? WHERE id = ?')
      .bind(newFavorite, mailbox_id).run();
    
    return new Response(JSON.stringify({
      success: true,
      mailbox_id,
      is_favorite: newFavorite
    }), { status: 200 });
    
  } catch (error) {
    console.error('切换收藏失败:', error);
    return new Response(JSON.stringify({ error: '切换收藏失败' }), { status: 500 });
  }
}

/**
 * 批量设置收藏状态
 * POST /api/mailboxes/batch-favorite
 * Body: { mailbox_ids: number[], is_favorite: boolean }
 * @param {Request} req - 请求对象
 * @param {object} env - 环境变量
 * @returns {Promise<Response>} 响应对象
 */
export async function handleBatchFavorite(req, env) {
  try {
    const user = req.user;
    if (!user || user.role !== 'strictAdmin') {
      return new Response(JSON.stringify({ error: '需要管理员权限' }), { status: 403 });
    }
    
    const body = await req.json();
    const { mailbox_ids, is_favorite } = body;
    
    if (!Array.isArray(mailbox_ids) || mailbox_ids.length === 0) {
      return new Response(JSON.stringify({ error: '缺少邮箱 ID 列表' }), { status: 400 });
    }
    
    if (mailbox_ids.length > 100) {
      return new Response(JSON.stringify({ error: '单次最多操作 100 个邮箱' }), { status: 400 });
    }
    
    const db = env.TEMP_MAIL_DB;
    const favoriteValue = is_favorite ? 1 : 0;
    
    // 批量更新
    const placeholders = mailbox_ids.map(() => '?').join(',');
    await db.prepare(`UPDATE mailboxes SET is_favorite = ? WHERE id IN (${placeholders})`)
      .bind(favoriteValue, ...mailbox_ids).run();
    
    return new Response(JSON.stringify({
      success: true,
      updated_count: mailbox_ids.length,
      is_favorite: favoriteValue
    }), { status: 200 });
    
  } catch (error) {
    console.error('批量设置收藏失败:', error);
    return new Response(JSON.stringify({ error: '批量设置收藏失败' }), { status: 500 });
  }
}

/**
 * 批量设置转发目标
 * POST /api/mailboxes/batch-forward
 * Body: { mailbox_ids: number[], forward_to: string | null | "" }
 * @param {Request} req - 请求对象
 * @param {object} env - 环境变量
 * @returns {Promise<Response>} 响应对象
 */
export async function handleBatchForward(req, env) {
  try {
    const user = req.user;
    if (!user || user.role !== 'strictAdmin') {
      return new Response(JSON.stringify({ error: '需要管理员权限' }), { status: 403 });
    }
    
    const body = await req.json();
    const { mailbox_ids, forward_to } = body;
    
    if (!Array.isArray(mailbox_ids) || mailbox_ids.length === 0) {
      return new Response(JSON.stringify({ error: '缺少邮箱 ID 列表' }), { status: 400 });
    }
    
    if (mailbox_ids.length > 100) {
      return new Response(JSON.stringify({ error: '单次最多操作 100 个邮箱' }), { status: 400 });
    }
    
    // 验证转发目标格式（如果提供了的话）
    const forwardTarget = forward_to ? String(forward_to).trim() : null;
    if (forwardTarget && !isValidEmail(forwardTarget)) {
      return new Response(JSON.stringify({ error: '转发目标邮箱格式无效' }), { status: 400 });
    }
    
    const db = env.TEMP_MAIL_DB;
    
    // 批量更新
    const placeholders = mailbox_ids.map(() => '?').join(',');
    await db.prepare(`UPDATE mailboxes SET forward_to = ? WHERE id IN (${placeholders})`)
      .bind(forwardTarget, ...mailbox_ids).run();
    
    return new Response(JSON.stringify({
      success: true,
      updated_count: mailbox_ids.length,
      forward_to: forwardTarget
    }), { status: 200 });
    
  } catch (error) {
    console.error('批量设置转发失败:', error);
    return new Response(JSON.stringify({ error: '批量设置转发失败' }), { status: 500 });
  }
}

/**
 * 批量设置收藏状态（通过邮箱地址）
 * POST /api/mailboxes/batch-favorite-by-address
 * Body: { addresses: string[], is_favorite: boolean }
 * @param {Request} req - 请求对象
 * @param {object} env - 环境变量
 * @returns {Promise<Response>} 响应对象
 */
export async function handleBatchFavoriteByAddress(req, env) {
  try {
    const user = req.user;
    if (!user || user.role !== 'strictAdmin') {
      return new Response(JSON.stringify({ error: '需要管理员权限' }), { status: 403 });
    }
    
    const body = await req.json();
    const { addresses, is_favorite } = body;
    
    if (!Array.isArray(addresses) || addresses.length === 0) {
      return new Response(JSON.stringify({ error: '缺少邮箱地址列表' }), { status: 400 });
    }
    
    if (addresses.length > 100) {
      return new Response(JSON.stringify({ error: '单次最多操作 100 个邮箱' }), { status: 400 });
    }
    
    const db = env.TEMP_MAIL_DB;
    const favoriteValue = is_favorite ? 1 : 0;
    
    // 规范化地址
    const normalizedAddresses = addresses.map(a => String(a || '').trim().toLowerCase()).filter(a => a);
    
    if (normalizedAddresses.length === 0) {
      return new Response(JSON.stringify({ error: '没有有效的邮箱地址' }), { status: 400 });
    }
    
    // 批量更新
    const placeholders = normalizedAddresses.map(() => '?').join(',');
    const result = await db.prepare(`UPDATE mailboxes SET is_favorite = ? WHERE address IN (${placeholders})`)
      .bind(favoriteValue, ...normalizedAddresses).run();
    
    return new Response(JSON.stringify({
      success: true,
      updated_count: result.meta?.changes || normalizedAddresses.length,
      is_favorite: favoriteValue
    }), { status: 200 });
    
  } catch (error) {
    console.error('批量设置收藏失败:', error);
    return new Response(JSON.stringify({ error: '批量设置收藏失败' }), { status: 500 });
  }
}

/**
 * 批量设置转发（通过邮箱地址）
 * POST /api/mailboxes/batch-forward-by-address
 * Body: { addresses: string[], forward_to: string | null }
 * @param {Request} req - 请求对象
 * @param {object} env - 环境变量
 * @returns {Promise<Response>} 响应对象
 */
export async function handleBatchForwardByAddress(req, env) {
  try {
    const user = req.user;
    if (!user || user.role !== 'strictAdmin') {
      return new Response(JSON.stringify({ error: '需要管理员权限' }), { status: 403 });
    }
    
    const body = await req.json();
    const { addresses, forward_to } = body;
    
    if (!Array.isArray(addresses) || addresses.length === 0) {
      return new Response(JSON.stringify({ error: '缺少邮箱地址列表' }), { status: 400 });
    }
    
    if (addresses.length > 100) {
      return new Response(JSON.stringify({ error: '单次最多操作 100 个邮箱' }), { status: 400 });
    }
    
    // 验证转发目标格式（如果提供了的话）
    const forwardTarget = forward_to ? String(forward_to).trim() : null;
    if (forwardTarget && !isValidEmail(forwardTarget)) {
      return new Response(JSON.stringify({ error: '转发目标邮箱格式无效' }), { status: 400 });
    }
    
    const db = env.TEMP_MAIL_DB;
    
    // 规范化地址
    const normalizedAddresses = addresses.map(a => String(a || '').trim().toLowerCase()).filter(a => a);
    
    if (normalizedAddresses.length === 0) {
      return new Response(JSON.stringify({ error: '没有有效的邮箱地址' }), { status: 400 });
    }
    
    // 批量更新
    const placeholders = normalizedAddresses.map(() => '?').join(',');
    const result = await db.prepare(`UPDATE mailboxes SET forward_to = ? WHERE address IN (${placeholders})`)
      .bind(forwardTarget, ...normalizedAddresses).run();
    
    return new Response(JSON.stringify({
      success: true,
      updated_count: result.meta?.changes || normalizedAddresses.length,
      forward_to: forwardTarget
    }), { status: 200 });
    
  } catch (error) {
    console.error('批量设置转发失败:', error);
    return new Response(JSON.stringify({ error: '批量设置转发失败' }), { status: 500 });
  }
}
