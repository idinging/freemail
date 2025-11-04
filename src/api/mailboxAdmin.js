/**
 * 邮箱管理员 API 模块 - 处理邮箱管理员相关操作
 * @module api/mailboxAdmin
 */

import { getJwtPayload, isStrictAdmin, sha256Hex, errorResponse } from './helpers.js';
import { invalidateMailboxCache, invalidateSystemStatCache } from '../utils/cache.js';
import { getMailboxIdByAddress } from '../db/index.js';
import {
  handleSetForward,
  handleToggleFavorite,
  handleBatchFavorite,
  handleBatchForward,
  handleBatchFavoriteByAddress,
  handleBatchForwardByAddress
} from './mailboxSettings.js';

/**
 * 处理邮箱管理员相关 API
 * @param {Request} request - HTTP 请求
 * @param {object} db - 数据库连接
 * @param {URL} url - 请求 URL
 * @param {string} path - 请求路径
 * @param {object} options - 选项
 * @returns {Promise<Response|null>} 响应或 null（未匹配）
 */
export async function handleMailboxAdminApi(request, db, url, path, options) {
  const isMock = !!options.mockOnly;

  // 删除邮箱
  if (path === '/api/mailboxes' && request.method === 'DELETE') {
    if (isMock) return errorResponse('演示模式不可删除', 403);
    const raw = url.searchParams.get('address');
    if (!raw) return errorResponse('缺少 address 参数', 400);
    const normalized = String(raw || '').trim().toLowerCase();
    try {
      const mailboxId = await getMailboxIdByAddress(db, normalized);
      if (!mailboxId) return new Response(JSON.stringify({ success: false, message: '邮箱不存在' }), { status: 404 });

      if (!isStrictAdmin(request, options)) {
        const payload = getJwtPayload(request, options);
        if (!payload || payload.role !== 'admin' || !payload.userId) return errorResponse('Forbidden', 403);
        const own = await db.prepare('SELECT 1 FROM user_mailboxes WHERE user_id = ? AND mailbox_id = ? LIMIT 1')
          .bind(Number(payload.userId), mailboxId).all();
        if (!own?.results?.length) return errorResponse('Forbidden', 403);
      }

      try { await db.exec('BEGIN'); } catch (_) { }
      await db.prepare('DELETE FROM messages WHERE mailbox_id = ?').bind(mailboxId).run();
      const deleteResult = await db.prepare('DELETE FROM mailboxes WHERE id = ?').bind(mailboxId).run();
      try { await db.exec('COMMIT'); } catch (_) { }

      const deleted = (deleteResult?.meta?.changes || 0) > 0;

      if (deleted) {
        invalidateMailboxCache(normalized);
        invalidateSystemStatCache('total_mailboxes');
      }

      return Response.json({ success: deleted, deleted });
    } catch (e) {
      try { await db.exec('ROLLBACK'); } catch (_) { }
      return errorResponse('删除失败', 500);
    }
  }

  // 重置邮箱密码
  if (path === '/api/mailboxes/reset-password' && request.method === 'POST') {
    if (isMock) return Response.json({ success: true, mock: true });
    try {
      if (!isStrictAdmin(request, options)) return errorResponse('Forbidden', 403);
      const address = String(url.searchParams.get('address') || '').trim().toLowerCase();
      if (!address) return errorResponse('缺少 address 参数', 400);
      await db.prepare('UPDATE mailboxes SET password_hash = NULL WHERE address = ?').bind(address).run();
      return Response.json({ success: true });
    } catch (e) { return errorResponse('重置失败', 500); }
  }

  // 切换邮箱登录权限
  if (path === '/api/mailboxes/toggle-login' && request.method === 'POST') {
    if (isMock) return errorResponse('演示模式不可操作', 403);
    if (!isStrictAdmin(request, options)) return errorResponse('Forbidden', 403);
    try {
      const body = await request.json();
      const address = String(body.address || '').trim().toLowerCase();
      const canLogin = Boolean(body.can_login);

      if (!address) return errorResponse('缺少 address 参数', 400);

      const mbRes = await db.prepare('SELECT id FROM mailboxes WHERE address = ?').bind(address).all();
      if (!mbRes.results || mbRes.results.length === 0) {
        return errorResponse('邮箱不存在', 404);
      }

      await db.prepare('UPDATE mailboxes SET can_login = ? WHERE address = ?')
        .bind(canLogin ? 1 : 0, address).run();

      return Response.json({ success: true, can_login: canLogin });
    } catch (e) {
      return errorResponse('操作失败: ' + e.message, 500);
    }
  }

  // 修改邮箱密码
  if (path === '/api/mailboxes/change-password' && request.method === 'POST') {
    if (isMock) return errorResponse('演示模式不可操作', 403);
    if (!isStrictAdmin(request, options)) return errorResponse('Forbidden', 403);
    try {
      const body = await request.json();
      const address = String(body.address || '').trim().toLowerCase();
      const newPassword = String(body.new_password || '').trim();

      if (!address) return errorResponse('缺少 address 参数', 400);
      if (!newPassword || newPassword.length < 6) return errorResponse('密码长度至少6位', 400);

      const mbRes = await db.prepare('SELECT id FROM mailboxes WHERE address = ?').bind(address).all();
      if (!mbRes.results || mbRes.results.length === 0) {
        return errorResponse('邮箱不存在', 404);
      }

      const newPasswordHash = await sha256Hex(newPassword);

      await db.prepare('UPDATE mailboxes SET password_hash = ? WHERE address = ?')
        .bind(newPasswordHash, address).run();

      return Response.json({ success: true });
    } catch (e) {
      return errorResponse('操作失败: ' + e.message, 500);
    }
  }

  // 批量切换邮箱登录权限
  if (path === '/api/mailboxes/batch-toggle-login' && request.method === 'POST') {
    if (isMock) return errorResponse('演示模式不可操作', 403);
    if (!isStrictAdmin(request, options)) return errorResponse('Forbidden', 403);
    try {
      const body = await request.json();
      const addresses = body.addresses || [];
      const canLogin = Boolean(body.can_login);

      if (!Array.isArray(addresses) || addresses.length === 0) {
        return errorResponse('缺少 addresses 参数或地址列表为空', 400);
      }

      if (addresses.length > 100) {
        return errorResponse('单次最多处理100个邮箱', 400);
      }

      let successCount = 0;
      let failCount = 0;
      const results = [];

      const addressMap = new Map();

      for (const address of addresses) {
        const normalizedAddress = String(address || '').trim().toLowerCase();
        if (!normalizedAddress) {
          failCount++;
          results.push({ address, success: false, error: '地址为空' });
          continue;
        }
        addressMap.set(normalizedAddress, address);
      }

      let existingMailboxes = new Set();
      if (addressMap.size > 0) {
        try {
          const addressList = Array.from(addressMap.keys());
          const placeholders = addressList.map(() => '?').join(',');
          const checkResult = await db.prepare(
            `SELECT address FROM mailboxes WHERE address IN (${placeholders})`
          ).bind(...addressList).all();

          for (const row of (checkResult.results || [])) {
            existingMailboxes.add(row.address);
          }
        } catch (e) {
          console.error('批量检查邮箱失败:', e);
        }
      }

      const batchStatements = [];

      for (const [normalizedAddress, originalAddress] of addressMap.entries()) {
        if (existingMailboxes.has(normalizedAddress)) {
          batchStatements.push({
            stmt: db.prepare('UPDATE mailboxes SET can_login = ? WHERE address = ?')
              .bind(canLogin ? 1 : 0, normalizedAddress),
            address: normalizedAddress,
            type: 'update'
          });
        } else {
          batchStatements.push({
            stmt: db.prepare('INSERT INTO mailboxes (address, can_login) VALUES (?, ?)')
              .bind(normalizedAddress, canLogin ? 1 : 0),
            address: normalizedAddress,
            type: 'insert'
          });
        }
      }

      if (batchStatements.length > 0) {
        try {
          const batchResults = await db.batch(batchStatements.map(s => s.stmt));

          for (let i = 0; i < batchResults.length; i++) {
            const result = batchResults[i];
            const operation = batchStatements[i];

            if (result.success !== false) {
              successCount++;
              results.push({
                address: operation.address,
                success: true,
                [operation.type === 'insert' ? 'created' : 'updated']: true
              });
            } else {
              failCount++;
              results.push({
                address: operation.address,
                success: false,
                error: result.error || '操作失败'
              });
            }
          }
        } catch (e) {
          console.error('批量操作执行失败:', e);
          return errorResponse('批量操作失败: ' + e.message, 500);
        }
      }

      return Response.json({
        success: true,
        success_count: successCount,
        fail_count: failCount,
        total: addresses.length,
        results
      });
    } catch (e) {
      return errorResponse('操作失败: ' + e.message, 500);
    }
  }

  // ====== 邮箱设置：转发和收藏 ======
  if (path === '/api/mailbox/forward' && request.method === 'POST') {
    if (isMock) return errorResponse('演示模式不可操作', 403);
    const payload = getJwtPayload(request, options);
    request.user = payload ? {
      id: payload.userId,
      role: payload.role === 'admin' && isStrictAdmin(request, options) ? 'strictAdmin' : payload.role,
      mailboxId: payload.mailboxId
    } : null;
    return await handleSetForward(request, { TEMP_MAIL_DB: db });
  }

  if (path === '/api/mailbox/favorite' && request.method === 'POST') {
    if (isMock) return errorResponse('演示模式不可操作', 403);
    const payload = getJwtPayload(request, options);
    request.user = payload ? {
      id: payload.userId,
      role: payload.role === 'admin' && isStrictAdmin(request, options) ? 'strictAdmin' : payload.role,
      mailboxId: payload.mailboxId
    } : null;
    return await handleToggleFavorite(request, { TEMP_MAIL_DB: db });
  }

  if (path === '/api/mailboxes/batch-favorite' && request.method === 'POST') {
    if (isMock) return errorResponse('演示模式不可操作', 403);
    if (!isStrictAdmin(request, options)) return errorResponse('Forbidden', 403);
    request.user = { role: 'strictAdmin' };
    return await handleBatchFavorite(request, { TEMP_MAIL_DB: db });
  }

  if (path === '/api/mailboxes/batch-forward' && request.method === 'POST') {
    if (isMock) return errorResponse('演示模式不可操作', 403);
    if (!isStrictAdmin(request, options)) return errorResponse('Forbidden', 403);
    request.user = { role: 'strictAdmin' };
    return await handleBatchForward(request, { TEMP_MAIL_DB: db });
  }

  if (path === '/api/mailboxes/batch-favorite-by-address' && request.method === 'POST') {
    if (isMock) return errorResponse('演示模式不可操作', 403);
    if (!isStrictAdmin(request, options)) return errorResponse('Forbidden', 403);
    request.user = { role: 'strictAdmin' };
    return await handleBatchFavoriteByAddress(request, { TEMP_MAIL_DB: db });
  }

  if (path === '/api/mailboxes/batch-forward-by-address' && request.method === 'POST') {
    if (isMock) return errorResponse('演示模式不可操作', 403);
    if (!isStrictAdmin(request, options)) return errorResponse('Forbidden', 403);
    request.user = { role: 'strictAdmin' };
    return await handleBatchForwardByAddress(request, { TEMP_MAIL_DB: db });
  }

  // 邮箱密码修改（邮箱用户自己修改）
  if (path === '/api/mailbox/password' && request.method === 'PUT') {
    if (isMock) return errorResponse('演示模式不可修改密码', 403);

    try {
      const body = await request.json();
      const { currentPassword, newPassword } = body;

      if (!currentPassword || !newPassword) {
        return errorResponse('当前密码和新密码不能为空', 400);
      }

      if (newPassword.length < 6) {
        return errorResponse('新密码长度至少6位', 400);
      }

      const payload = getJwtPayload(request, options);
      const mailboxAddress = payload?.mailboxAddress;
      const mailboxId = payload?.mailboxId;

      if (!mailboxAddress || !mailboxId) {
        return errorResponse('未找到邮箱信息', 401);
      }

      const { results } = await db.prepare('SELECT password_hash FROM mailboxes WHERE id = ? AND address = ?')
        .bind(mailboxId, mailboxAddress).all();

      if (!results || results.length === 0) {
        return errorResponse('邮箱不存在', 404);
      }

      const mailbox = results[0];
      let currentPasswordValid = false;

      if (mailbox.password_hash) {
        const { verifyPassword } = await import('../utils/common.js');
        currentPasswordValid = await verifyPassword(currentPassword, mailbox.password_hash);
      } else {
        currentPasswordValid = (currentPassword === mailboxAddress);
      }

      if (!currentPasswordValid) {
        return errorResponse('当前密码错误', 400);
      }

      const newPasswordHash = await sha256Hex(newPassword);

      await db.prepare('UPDATE mailboxes SET password_hash = ? WHERE id = ?')
        .bind(newPasswordHash, mailboxId).run();

      return Response.json({ success: true, message: '密码修改成功' });

    } catch (error) {
      console.error('修改密码失败:', error);
      return errorResponse('修改密码失败', 500);
    }
  }

  return null;
}
