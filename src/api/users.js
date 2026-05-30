/**
 * 用户管理 API 模块
 * @module api/users
 */

import { getJwtPayload, isStrictAdmin, hashPassword, jsonResponse, errorResponse } from './helpers.js';
import { initMockUsers, buildMockMailboxes, MOCK_DOMAINS } from './mock.js';
import {
  listUsersWithCounts,
  createUser,
  updateUser,
  deleteUser,
  assignMailboxToUser,
  unassignMailboxFromUser,
  getUserMailboxes,
  getTotalMailboxCount,
  getUserStats
} from '../db/index.js';

/**
 * 解析分页参数，统一支持 page/size 与 limit/offset 两种风格
 * 非数字输入会回退到默认值，避免产生 NaN
 * @param {URL} url - 请求 URL
 * @returns {{limit: number, offset: number}} 规范化后的 limit 与 offset
 */
function parsePagination(url) {
  const pageParam = url.searchParams.get('page');
  const sizeParam = url.searchParams.get('size');
  if (pageParam !== null || sizeParam !== null) {
    const page = Math.max(1, parseInt(pageParam, 10) || 1);
    const size = Math.max(1, Math.min(100, parseInt(sizeParam, 10) || 50));
    return { limit: size, offset: (page - 1) * size };
  }
  const limit = Math.min(Math.max(1, parseInt(url.searchParams.get('limit'), 10) || 50), 100);
  const offset = Math.max(0, parseInt(url.searchParams.get('offset'), 10) || 0);
  return { limit, offset };
}

/**
 * 处理用户管理相关 API
 * @param {Request} request - HTTP 请求
 * @param {object} db - 数据库连接
 * @param {URL} url - 请求 URL
 * @param {string} path - 请求路径
 * @param {object} options - 选项
 * @returns {Promise<Response|null>} 响应或 null（未匹配）
 */
export async function handleUsersApi(request, db, url, path, options) {
  const isMock = !!options.mockOnly;
  
  // 初始化演示模式用户数据
  if (isMock) {
    initMockUsers();
  }
  
  // =================== 用户管理（演示模式） ===================
  if (isMock && path === '/api/users' && request.method === 'GET') {
    const { limit, offset } = parsePagination(url);
    const sort = url.searchParams.get('sort') || 'desc';
    
    let list = (globalThis.__MOCK_USERS__ || []).map(u => {
      const boxes = globalThis.__MOCK_USER_MAILBOXES__?.get(u.id) || [];
      return { ...u, mailbox_count: boxes.length };
    });
    
    list.sort((a, b) => {
      const dateA = new Date(a.created_at);
      const dateB = new Date(b.created_at);
      return sort === 'asc' ? dateA - dateB : dateB - dateA;
    });
    
    // 与非演示模式保持一致的返回契约：全局聚合统计 + 当前页列表
    const total = list.length;
    const adminCount = list.filter(u => u.role === 'admin').length;
    const activeCount = list.filter(u => u.can_send).length;
    const totalMailboxes = list.reduce((sum, u) => sum + (u.mailbox_count || 0), 0);
    const result = list.slice(offset, offset + limit);
    return Response.json({
      list: result,
      total,
      total_mailboxes: totalMailboxes,
      admin_count: adminCount,
      active_count: activeCount
    });
  }
  
  if (isMock && path === '/api/users' && request.method === 'POST') {
    try {
      const body = await request.json();
      const username = String(body.username || '').trim().toLowerCase();
      if (!username) return errorResponse('用户名不能为空', 400);
      const exists = (globalThis.__MOCK_USERS__ || []).some(u => u.username === username);
      if (exists) return errorResponse('用户名已存在', 400);
      const role = (body.role === 'admin') ? 'admin' : 'user';
      const mailbox_limit = Math.max(0, Number(body.mailboxLimit || 10));
      const id = ++globalThis.__MOCK_USER_LAST_ID__;
      const item = { id, username, role, can_send: 0, mailbox_limit, created_at: new Date().toISOString().replace('T', ' ').slice(0, 19) };
      globalThis.__MOCK_USERS__.unshift(item);
      return Response.json(item);
    } catch (e) { return errorResponse('创建失败', 500); }
  }
  
  if (isMock && request.method === 'PATCH' && path.startsWith('/api/users/')) {
    const id = Number(path.split('/')[3]);
    const list = globalThis.__MOCK_USERS__ || [];
    const idx = list.findIndex(u => u.id === id);
    if (idx < 0) return errorResponse('未找到用户', 404);
    try {
      const body = await request.json();
      if (typeof body.mailboxLimit !== 'undefined') list[idx].mailbox_limit = Math.max(0, Number(body.mailboxLimit));
      if (typeof body.role === 'string') list[idx].role = (body.role === 'admin' ? 'admin' : 'user');
      if (typeof body.can_send !== 'undefined') list[idx].can_send = body.can_send ? 1 : 0;
      return Response.json({ success: true });
    } catch (_) { return errorResponse('更新失败', 500); }
  }
  
  if (isMock && request.method === 'DELETE' && path.startsWith('/api/users/')) {
    const id = Number(path.split('/')[3]);
    const list = globalThis.__MOCK_USERS__ || [];
    const idx = list.findIndex(u => u.id === id);
    if (idx < 0) return errorResponse('未找到用户', 404);
    list.splice(idx, 1);
    globalThis.__MOCK_USER_MAILBOXES__?.delete(id);
    return Response.json({ success: true });
  }
  
  if (isMock && path === '/api/users/assign' && request.method === 'POST') {
    try {
      const body = await request.json();
      const username = String(body.username || '').trim().toLowerCase();
      const address = String(body.address || '').trim().toLowerCase();
      const u = (globalThis.__MOCK_USERS__ || []).find(x => x.username === username);
      if (!u) return errorResponse('用户不存在', 404);
      const boxes = globalThis.__MOCK_USER_MAILBOXES__?.get(u.id) || [];
      if (boxes.length >= (u.mailbox_limit || 10)) return errorResponse('已达到邮箱上限', 400);
      const item = { address, created_at: new Date().toISOString().replace('T', ' ').slice(0, 19), is_pinned: 0 };
      boxes.unshift(item);
      globalThis.__MOCK_USER_MAILBOXES__?.set(u.id, boxes);
      return Response.json({ success: true });
    } catch (_) { return errorResponse('分配失败', 500); }
  }
  
  if (isMock && path === '/api/users/unassign' && request.method === 'POST') {
    try {
      const body = await request.json();
      const username = String(body.username || '').trim().toLowerCase();
      const address = String(body.address || '').trim().toLowerCase();
      const u = (globalThis.__MOCK_USERS__ || []).find(x => x.username === username);
      if (!u) return errorResponse('用户不存在', 404);
      const boxes = globalThis.__MOCK_USER_MAILBOXES__?.get(u.id) || [];
      const index = boxes.findIndex(box => box.address === address);
      if (index === -1) return errorResponse('该邮箱未分配给该用户', 400);
      boxes.splice(index, 1);
      globalThis.__MOCK_USER_MAILBOXES__?.set(u.id, boxes);
      return Response.json({ success: true });
    } catch (_) { return errorResponse('取消分配失败', 500); }
  }
  
  if (isMock && request.method === 'GET' && path.startsWith('/api/users/') && path.endsWith('/mailboxes')) {
    const id = Number(path.split('/')[3]);
    const all = globalThis.__MOCK_USER_MAILBOXES__?.get(id) || [];
    const n = Math.min(all.length, Math.max(3, Math.min(8, Math.floor(Math.random() * 6) + 3)));
    const list = all.slice(0, n);
    return Response.json(list);
  }
  
  // ================= 用户管理接口（仅非演示模式） =================
  if (!isMock && path === '/api/users' && request.method === 'GET') {
    if (!isStrictAdmin(request, options)) return errorResponse('Forbidden', 403);

    const { limit, offset } = parsePagination(url);
    const sort = url.searchParams.get('sort') || 'desc';
    try {
      const [stats, users, totalMailboxes] = await Promise.all([
        getUserStats(db),
        listUsersWithCounts(db, { limit, offset, sort }),
        getTotalMailboxCount(db)
      ]);
      const userStats = stats || { total: 0, admin_count: 0, active_count: 0 };
      return Response.json({
        list: users,
        total: userStats.total,
        total_mailboxes: totalMailboxes,
        admin_count: userStats.admin_count,
        active_count: userStats.active_count
      });
    } catch (e) { return errorResponse('查询失败', 500); }
  }
  
  if (!isMock && path === '/api/users' && request.method === 'POST') {
    if (!isStrictAdmin(request, options)) return errorResponse('Forbidden', 403);
    try {
      const body = await request.json();
      const username = String(body.username || '').trim();
      const role = (body.role || 'user') === 'admin' ? 'admin' : 'user';
      const mailboxLimit = Number(body.mailboxLimit || 10);
      const password = String(body.password || '').trim();
      let passwordHash = null;
      if (password) { passwordHash = await hashPassword(password); }
      const user = await createUser(db, { username, passwordHash, role, mailboxLimit });
      return Response.json(user);
    } catch (e) { return errorResponse('创建失败: ' + (e?.message || e), 500); }
  }
  
  if (!isMock && request.method === 'PATCH' && path.startsWith('/api/users/')) {
    if (!isStrictAdmin(request, options)) return errorResponse('Forbidden', 403);
    const id = Number(path.split('/')[3]);
    if (!id) return errorResponse('无效ID', 400);
    try {
      const body = await request.json();
      const fields = {};
      if (typeof body.mailboxLimit !== 'undefined') fields.mailbox_limit = Math.max(0, Number(body.mailboxLimit));
      if (typeof body.role === 'string') fields.role = (body.role === 'admin' ? 'admin' : 'user');
      if (typeof body.can_send !== 'undefined') fields.can_send = body.can_send ? 1 : 0;
      if (typeof body.password === 'string' && body.password) { fields.password_hash = await hashPassword(String(body.password)); }
      await updateUser(db, id, fields);
      return Response.json({ success: true });
    } catch (e) { return errorResponse('更新失败: ' + (e?.message || e), 500); }
  }
  
  if (!isMock && request.method === 'DELETE' && path.startsWith('/api/users/')) {
    if (!isStrictAdmin(request, options)) return errorResponse('Forbidden', 403);
    const id = Number(path.split('/')[3]);
    if (!id) return errorResponse('无效ID', 400);
    try { await deleteUser(db, id); return Response.json({ success: true }); }
    catch (e) { return errorResponse('删除失败: ' + (e?.message || e), 500); }
  }
  
  if (!isMock && path === '/api/users/assign' && request.method === 'POST') {
    if (!isStrictAdmin(request, options)) return errorResponse('Forbidden', 403);
    try {
      const body = await request.json();
      const username = String(body.username || '').trim();
      const address = String(body.address || '').trim().toLowerCase();
      if (!username || !address) return errorResponse('参数不完整', 400);
      const result = await assignMailboxToUser(db, { username, address });
      return Response.json(result);
    } catch (e) { return errorResponse('分配失败: ' + (e?.message || e), 500); }
  }
  
  if (!isMock && path === '/api/users/unassign' && request.method === 'POST') {
    if (!isStrictAdmin(request, options)) return errorResponse('Forbidden', 403);
    try {
      const body = await request.json();
      const username = String(body.username || '').trim();
      const address = String(body.address || '').trim().toLowerCase();
      if (!username || !address) return errorResponse('参数不完整', 400);
      const result = await unassignMailboxFromUser(db, { username, address });
      return Response.json(result);
    } catch (e) { return errorResponse('取消分配失败: ' + (e?.message || e), 500); }
  }
  
  if (!isMock && request.method === 'GET' && path.startsWith('/api/users/') && path.endsWith('/mailboxes')) {
    const id = Number(path.split('/')[3]);
    if (!id) return errorResponse('无效ID', 400);
    const payload = getJwtPayload(request, options);
    const self = Number(payload?.userId || 0) === id;
    if (!isStrictAdmin(request, options) && !self) return errorResponse('Forbidden', 403);
    try { const list = await getUserMailboxes(db, id); return Response.json(list || []); }
    catch (e) { return errorResponse('查询失败', 500); }
  }
  
  return null;
}
