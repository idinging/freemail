/**
 * 邮箱管理 API 模块
 * @module api/mailboxes
 */

import { getJwtPayload, isStrictAdmin, errorResponse } from './helpers.js';
import { buildMockMailboxes, MOCK_DOMAINS } from './mock.js';
import { extractEmail, generateRandomId } from '../utils/common.js';
import { getCachedUserQuota, getCachedSystemStat } from '../utils/cache.js';
import {
  getOrCreateMailboxId,
  toggleMailboxPin,
  getTotalMailboxCount,
  assignMailboxToUser
} from '../db/index.js';
import { handleMailboxAdminApi } from './mailboxAdmin.js';

/**
 * 处理邮箱管理相关 API
 * @param {Request} request - HTTP 请求
 * @param {object} db - 数据库连接
 * @param {Array<string>} mailDomains - 邮件域名列表
 * @param {URL} url - 请求 URL
 * @param {string} path - 请求路径
 * @param {object} options - 选项
 * @returns {Promise<Response|null>} 响应或 null（未匹配）
 */
export async function handleMailboxesApi(request, db, mailDomains, url, path, options) {
  const isMock = !!options.mockOnly;

  // 返回域名列表给前端
  if (path === '/api/domains' && request.method === 'GET') {
    if (isMock) return Response.json(MOCK_DOMAINS);
    const domains = Array.isArray(mailDomains) ? mailDomains : [(mailDomains || 'temp.example.com')];
    return Response.json(domains);
  }

  // 随机生成邮箱
  if (path === '/api/generate') {
    const lengthParam = Number(url.searchParams.get('length') || 0);
    const randomId = generateRandomId(lengthParam || undefined);
    const domains = isMock ? MOCK_DOMAINS : (Array.isArray(mailDomains) ? mailDomains : [(mailDomains || 'temp.example.com')]);
    const domainIdx = Math.max(0, Math.min(domains.length - 1, Number(url.searchParams.get('domainIndex') || 0)));
    const chosenDomain = domains[domainIdx] || domains[0];
    const email = `${randomId}@${chosenDomain}`;
    
    if (!isMock) {
      try {
        const payload = getJwtPayload(request, options);
        if (payload?.userId) {
          await assignMailboxToUser(db, { userId: payload.userId, address: email });
          return Response.json({ email, expires: Date.now() + 3600000 });
        }
        await getOrCreateMailboxId(db, email);
        return Response.json({ email, expires: Date.now() + 3600000 });
      } catch (e) {
        return errorResponse(String(e?.message || '创建失败'), 400);
      }
    }
    return Response.json({ email, expires: Date.now() + 3600000 });
  }

  // 自定义创建邮箱
  if (path === '/api/create' && request.method === 'POST') {
    if (isMock) {
      try {
        const body = await request.json();
        const local = String(body.local || '').trim().toLowerCase();
        const valid = /^[a-z0-9._-]{1,64}$/i.test(local);
        if (!valid) return errorResponse('非法用户名', 400);
        const domains = MOCK_DOMAINS;
        const domainIdx = Math.max(0, Math.min(domains.length - 1, Number(body.domainIndex || 0)));
        const chosenDomain = domains[domainIdx] || domains[0];
        const email = `${local}@${chosenDomain}`;
        return Response.json({ email, expires: Date.now() + 3600000 });
      } catch (_) { return errorResponse('Bad Request', 400); }
    }
    
    try {
      const body = await request.json();
      const local = String(body.local || '').trim().toLowerCase();
      const valid = /^[a-z0-9._-]{1,64}$/i.test(local);
      if (!valid) return errorResponse('非法用户名', 400);
      const domains = Array.isArray(mailDomains) ? mailDomains : [(mailDomains || 'temp.example.com')];
      const domainIdx = Math.max(0, Math.min(domains.length - 1, Number(body.domainIndex || 0)));
      const chosenDomain = domains[domainIdx] || domains[0];
      const email = `${local}@${chosenDomain}`;
      
      try {
        const payload = getJwtPayload(request, options);
        const userId = payload?.userId;
        if (userId) {
          await assignMailboxToUser(db, { userId, address: email });
        } else {
          await getOrCreateMailboxId(db, email);
        }
        return Response.json({ email, expires: Date.now() + 3600000 });
      } catch (e) {
        return errorResponse(String(e?.message || '创建失败'), 400);
      }
    } catch (_) { return errorResponse('Bad Request', 400); }
  }

  // 获取邮箱详细信息（转发、收藏等）
  if (path === '/api/mailbox/info' && request.method === 'GET') {
    const address = url.searchParams.get('address');
    if (!address) return errorResponse('缺少邮箱地址', 400);
    
    if (isMock) {
      return Response.json({
        id: 1,
        address,
        is_favorite: false,
        forward_to: null,
        can_login: false
      });
    }
    
    try {
      const { results } = await db.prepare(
        'SELECT id, address, is_favorite, forward_to, can_login FROM mailboxes WHERE address = ? LIMIT 1'
      ).bind(address.toLowerCase()).all();
      
      if (!results || results.length === 0) {
        return Response.json({
          id: null,
          address,
          is_favorite: false,
          forward_to: null,
          can_login: false
        });
      }
      
      const row = results[0];
      return Response.json({
        id: row.id,
        address: row.address,
        is_favorite: !!row.is_favorite,
        forward_to: row.forward_to || null,
        can_login: !!row.can_login
      });
    } catch (e) {
      return errorResponse('查询失败', 500);
    }
  }

  // 用户配额和邮箱统计
  if (path === '/api/user/quota' && request.method === 'GET') {
    const payload = getJwtPayload(request, options);
    const uid = Number(payload?.userId || 0);
    const role = payload?.role || '';
    
    if (isMock) {
      return Response.json({ limit: 999, used: 2, remaining: 997 });
    }
    
    if (isStrictAdmin(request, options) || role === 'admin') {
      const totalMailboxes = await getCachedSystemStat(db, 'total_mailboxes', async () => {
        return await getTotalMailboxCount(db);
      });
      return Response.json({
        limit: -1,
        used: totalMailboxes,
        remaining: -1,
        note: '管理员无邮箱数量限制'
      });
    }
    
    if (!uid) return Response.json({ limit: 10, used: 0, remaining: 10 });
    
    const quota = await getCachedUserQuota(db, uid);
    return Response.json(quota);
  }

  // 获取用户的邮箱列表
  if (path === '/api/mailboxes' && request.method === 'GET') {
    if (isMock) {
      const searchParam = url.searchParams.get('q');
      const domainParam = url.searchParams.get('domain');
      const favoriteParam = url.searchParams.get('favorite');
      const forwardParam = url.searchParams.get('forward');
      let results = buildMockMailboxes(MOCK_DOMAINS);
      // 搜索过滤
      if (searchParam && searchParam.trim()) {
        const q = searchParam.trim().toLowerCase();
        results = results.filter(m => m.address.toLowerCase().includes(q));
      }
      if (domainParam) {
        results = results.filter(m => m.address.endsWith('@' + domainParam));
      }
      if (favoriteParam === 'true' || favoriteParam === '1') {
        results = results.filter(m => m.is_favorite);
      } else if (favoriteParam === 'false' || favoriteParam === '0') {
        results = results.filter(m => !m.is_favorite);
      }
      if (forwardParam === 'true' || forwardParam === '1') {
        results = results.filter(m => m.forward_to);
      } else if (forwardParam === 'false' || forwardParam === '0') {
        results = results.filter(m => !m.forward_to);
      }
      // 分页
      const pageParam = url.searchParams.get('page');
      const sizeParam = url.searchParams.get('size');
      const page = Math.max(1, Number(pageParam || 1));
      const size = Math.max(1, Math.min(500, Number(sizeParam || 20)));
      const total = results.length;
      const start = (page - 1) * size;
      const pageResult = results.slice(start, start + size);
      return Response.json({ list: pageResult, total });
    }

    const payload = getJwtPayload(request, options);
    const mailboxOnly = !!options.mailboxOnly;

    if (mailboxOnly && payload?.mailboxAddress) {
      try {
        const { results } = await db.prepare(`
          SELECT id, address, created_at, 0 AS is_pinned,
                 CASE WHEN (password_hash IS NULL OR password_hash = '') THEN 1 ELSE 0 END AS password_is_default,
                 COALESCE(can_login, 0) AS can_login,
                 forward_to, COALESCE(is_favorite, 0) AS is_favorite
          FROM mailboxes
          WHERE address = ?
          LIMIT 1
        `).bind(payload.mailboxAddress).all();
        return Response.json({ list: results || [], total: results?.length || 0 });
      } catch (e) {
        return Response.json({ list: [], total: 0 });
      }
    }

    try {
      const strictAdmin = isStrictAdmin(request, options);
      let uid = Number(payload?.userId || 0);
      
      if (!uid && strictAdmin) {
        const { results } = await db.prepare('SELECT id FROM users WHERE username = ?')
          .bind(String(options?.adminName || 'admin').toLowerCase()).all();
        if (results && results.length) {
          uid = Number(results[0].id);
        } else {
          const uname = String(options?.adminName || 'admin').toLowerCase();
          await db.prepare("INSERT INTO users (username, role, can_send, mailbox_limit) VALUES (?, 'admin', 1, 9999)").bind(uname).run();
          const again = await db.prepare('SELECT id FROM users WHERE username = ?').bind(uname).all();
          uid = Number(again?.results?.[0]?.id || 0);
        }
      }

      if (!uid && !strictAdmin) return Response.json({ list: [], total: 0 });

      // 支持两种分页参数：page/size 或 limit/offset
      let limit, offset;
      const pageParam = url.searchParams.get('page');
      const sizeParam = url.searchParams.get('size');
      
      if (pageParam !== null || sizeParam !== null) {
        // 使用 page/size 分页
        const page = Math.max(1, Number(pageParam || 1));
        const size = Math.max(1, Math.min(500, Number(sizeParam || 20)));
        limit = size;
        offset = (page - 1) * size;
      } else {
        // 使用 limit/offset 分页
        limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') || 100)));
        offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
      }

      const bindParams = [];
      const whereConditions = [];
      
      // 严格管理员可以看到所有邮箱，普通用户只能看到自己关联的邮箱
      const useUserFilter = !strictAdmin && uid;
      if (useUserFilter) {
        whereConditions.push('um.user_id = ?');
        bindParams.push(uid);
      }
      
      const searchParam = url.searchParams.get('q');
      const domainParam = url.searchParams.get('domain');
      const loginParam = url.searchParams.get('login');
      const favoriteParam = url.searchParams.get('favorite');
      const forwardParam = url.searchParams.get('forward');
      
      // 搜索过滤（模糊匹配邮箱地址）
      if (searchParam && searchParam.trim()) {
        whereConditions.push('m.address LIKE ?');
        bindParams.push(`%${searchParam.trim().toLowerCase()}%`);
      }
      
      if (domainParam) {
        whereConditions.push('m.domain = ?');
        bindParams.push(domainParam);
      }
      
      // 登录权限筛选（支持 true/1/allowed 和 false/0/denied）
      if (loginParam === 'true' || loginParam === '1' || loginParam === 'allowed') {
        whereConditions.push('m.can_login = 1');
      } else if (loginParam === 'false' || loginParam === '0' || loginParam === 'denied') {
        whereConditions.push('(m.can_login = 0 OR m.can_login IS NULL)');
      }
      
      // 收藏筛选（支持 true/1/favorite 和 false/0/not-favorite）
      if (favoriteParam === 'true' || favoriteParam === '1' || favoriteParam === 'favorite') {
        whereConditions.push('m.is_favorite = 1');
      } else if (favoriteParam === 'false' || favoriteParam === '0' || favoriteParam === 'not-favorite') {
        whereConditions.push('(m.is_favorite = 0 OR m.is_favorite IS NULL)');
      }
      
      // 转发筛选（支持 true/1/has-forward 和 false/0/no-forward）
      if (forwardParam === 'true' || forwardParam === '1' || forwardParam === 'has-forward') {
        whereConditions.push("(m.forward_to IS NOT NULL AND m.forward_to != '')");
      } else if (forwardParam === 'false' || forwardParam === '0' || forwardParam === 'no-forward') {
        whereConditions.push("(m.forward_to IS NULL OR m.forward_to = '')");
      }
      
      const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';
      bindParams.push(limit, offset);
      
      // 构建计数查询的参数（不包含 limit 和 offset）
      const countBindParams = bindParams.slice(0, -2);
      
      // 严格管理员使用 LEFT JOIN 显示所有邮箱，同时保留自己的置顶状态
      // 普通用户使用 INNER JOIN 只显示自己关联的邮箱
      if (strictAdmin && uid) {
        // 严格管理员：显示所有邮箱，使用 LEFT JOIN 获取自己的置顶状态
        const adminBindParams = [uid, ...bindParams];
        const adminCountBindParams = [uid, ...countBindParams];
        
        // 获取总数
        const countResult = await db.prepare(`
          SELECT COUNT(*) as total
          FROM mailboxes m
          LEFT JOIN user_mailboxes um ON m.id = um.mailbox_id AND um.user_id = ?
          ${whereClause}
        `).bind(...adminCountBindParams).first();
        const total = countResult?.total || 0;
        
        const { results } = await db.prepare(`
          SELECT m.id, m.address, m.created_at, COALESCE(um.is_pinned, 0) AS is_pinned,
                 CASE WHEN (m.password_hash IS NULL OR m.password_hash = '') THEN 1 ELSE 0 END AS password_is_default,
                 COALESCE(m.can_login, 0) AS can_login,
                 m.forward_to, COALESCE(m.is_favorite, 0) AS is_favorite
          FROM mailboxes m
          LEFT JOIN user_mailboxes um ON m.id = um.mailbox_id AND um.user_id = ?
          ${whereClause}
          ORDER BY COALESCE(um.is_pinned, 0) DESC, m.created_at DESC
          LIMIT ? OFFSET ?
        `).bind(...adminBindParams).all();
        return Response.json({ list: results || [], total });
      } else if (strictAdmin) {
        // 严格管理员但没有 uid（不应该发生，但作为兜底）
        // 获取总数
        const countResult = await db.prepare(`
          SELECT COUNT(*) as total
          FROM mailboxes m
          ${whereClause}
        `).bind(...countBindParams).first();
        const total = countResult?.total || 0;
        
        const { results } = await db.prepare(`
          SELECT m.id, m.address, m.created_at, 0 AS is_pinned,
                 CASE WHEN (m.password_hash IS NULL OR m.password_hash = '') THEN 1 ELSE 0 END AS password_is_default,
                 COALESCE(m.can_login, 0) AS can_login,
                 m.forward_to, COALESCE(m.is_favorite, 0) AS is_favorite
          FROM mailboxes m
          ${whereClause}
          ORDER BY m.created_at DESC
          LIMIT ? OFFSET ?
        `).bind(...bindParams).all();
        return Response.json({ list: results || [], total });
      } else {
        // 普通用户：只显示自己关联的邮箱
        // 获取总数
        const countResult = await db.prepare(`
          SELECT COUNT(*) as total
          FROM user_mailboxes um
          JOIN mailboxes m ON m.id = um.mailbox_id
          ${whereClause}
        `).bind(...countBindParams).first();
        const total = countResult?.total || 0;
        
        const { results } = await db.prepare(`
          SELECT m.id, m.address, m.created_at, um.is_pinned,
                 CASE WHEN (m.password_hash IS NULL OR m.password_hash = '') THEN 1 ELSE 0 END AS password_is_default,
                 COALESCE(m.can_login, 0) AS can_login,
                 m.forward_to, COALESCE(m.is_favorite, 0) AS is_favorite
          FROM user_mailboxes um
          JOIN mailboxes m ON m.id = um.mailbox_id
          ${whereClause}
          ORDER BY um.is_pinned DESC, m.created_at DESC
          LIMIT ? OFFSET ?
        `).bind(...bindParams).all();
        return Response.json({ list: results || [], total });
      }
    } catch (_) {
      return Response.json({ list: [], total: 0 });
    }
  }

  // 切换邮箱置顶状态
  if (path === '/api/mailboxes/pin' && request.method === 'POST') {
    if (isMock) return errorResponse('演示模式不可操作', 403);
    const address = url.searchParams.get('address');
    if (!address) return errorResponse('缺少 address 参数', 400);
    const payload = getJwtPayload(request, options);
    let uid = Number(payload?.userId || 0);
    
    if (!uid && isStrictAdmin(request, options)) {
      try {
        const { results } = await db.prepare('SELECT id FROM users WHERE username = ?')
          .bind(String(options?.adminName || 'admin').toLowerCase()).all();
        if (results && results.length) {
          uid = Number(results[0].id);
        } else {
          const uname = String(options?.adminName || 'admin').toLowerCase();
          await db.prepare("INSERT INTO users (username, role, can_send, mailbox_limit) VALUES (?, 'admin', 1, 9999)").bind(uname).run();
          const again = await db.prepare('SELECT id FROM users WHERE username = ?').bind(uname).all();
          uid = Number(again?.results?.[0]?.id || 0);
        }
      } catch (_) { uid = 0; }
    }
    if (!uid) return errorResponse('未登录', 401);
    try {
      const result = await toggleMailboxPin(db, address, uid);
      return Response.json({ success: true, ...result });
    } catch (e) {
      return errorResponse('操作失败: ' + e.message, 500);
    }
  }

  // 委托给管理员 API 处理剩余操作
  const adminResult = await handleMailboxAdminApi(request, db, url, path, options);
  if (adminResult) return adminResult;

  return null;
}
