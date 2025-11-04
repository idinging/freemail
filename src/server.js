/**
 * Freemail 主入口文件
 * 
 * 本文件作为 Cloudflare Worker 的入口点，负责：
 * 1. 处理 HTTP 请求（通过 fetch 处理器）
 * 2. 处理邮件接收（通过 email 处理器）
 * 
 * 所有具体业务逻辑已拆分到各个子模块中
 * 
 * @module server
 */

import { initDatabase, getInitializedDatabase } from './db/index.js';
import { createRouter, authMiddleware } from './routes/index.js';
import { createAssetManager } from './assets/index.js';
import { extractEmail } from './utils/common.js';
import { forwardByLocalPart, forwardByMailboxConfig } from './email/forwarder.js';
import { parseEmailBody, extractVerificationCode } from './email/parser.js';
import { getForwardTarget } from './db/mailboxes.js';

export default {
  /**
   * HTTP请求处理器
   * @param {Request} request - HTTP请求对象
   * @param {object} env - 环境变量对象
   * @param {object} ctx - 上下文对象
   * @returns {Promise<Response>} HTTP响应对象
   */
  async fetch(request, env, ctx) {
    // 获取数据库连接
    let DB;
    try {
      DB = await getInitializedDatabase(env);
    } catch (error) {
      console.error('数据库连接失败:', error.message);
      return new Response('数据库连接失败，请检查配置', { status: 500 });
    }

    // 解析邮件域名
    const MAIL_DOMAINS = (env.MAIL_DOMAIN || 'temp.example.com')
      .split(/[,\s]+/)
      .map(d => d.trim())
      .filter(Boolean);

    // 创建路由器并添加认证中间件
    const router = createRouter();
    router.use(authMiddleware);

    // 尝试使用路由器处理请求
    const routeResponse = await router.handle(request, { request, env, ctx });
    if (routeResponse) {
      return routeResponse;
    }

    // 使用资源管理器处理静态资源请求
    const assetManager = createAssetManager();
    return await assetManager.handleAssetRequest(request, env, MAIL_DOMAINS);
  },

  /**
   * 邮件接收处理器
   * @param {object} message - 邮件消息对象
   * @param {object} env - 环境变量对象
   * @param {object} ctx - 上下文对象
   * @returns {Promise<void>}
   */
  async email(message, env, ctx) {
    // 获取数据库连接
    let DB;
    try {
      DB = await getInitializedDatabase(env);
    } catch (error) {
      console.error('邮件处理时数据库连接失败:', error.message);
      return;
    }

    try {
      // 解析邮件头部
      const headers = message.headers;
      const toHeader = headers.get('to') || headers.get('To') || '';
      const fromHeader = headers.get('from') || headers.get('From') || '';
      const subject = headers.get('subject') || headers.get('Subject') || '(无主题)';

      // 解析收件人地址
      let envelopeTo = '';
      try {
        const toValue = message.to;
        if (Array.isArray(toValue) && toValue.length > 0) {
          envelopeTo = typeof toValue[0] === 'string' ? toValue[0] : (toValue[0].address || '');
        } else if (typeof toValue === 'string') {
          envelopeTo = toValue;
        }
      } catch (_) { }

      const resolvedRecipient = (envelopeTo || toHeader || '').toString();
      const resolvedRecipientAddr = extractEmail(resolvedRecipient);
      const localPart = (resolvedRecipientAddr.split('@')[0] || '').toLowerCase();

      // 处理邮件转发（优先使用邮箱配置，否则使用全局规则）
      const mailboxForwardTo = await getForwardTarget(DB, resolvedRecipientAddr);
      if (mailboxForwardTo) {
        forwardByMailboxConfig(message, mailboxForwardTo, ctx);
      } else {
        forwardByLocalPart(message, localPart, ctx, env);
      }

      // 读取原始邮件内容
      let textContent = '';
      let htmlContent = '';
      let rawBuffer = null;
      try {
        const resp = new Response(message.raw);
        rawBuffer = await resp.arrayBuffer();
        const rawText = await new Response(rawBuffer).text();
        const parsed = parseEmailBody(rawText);
        textContent = parsed.text || '';
        htmlContent = parsed.html || '';
        if (!textContent && !htmlContent) textContent = (rawText || '').slice(0, 100000);
      } catch (_) {
        textContent = '';
        htmlContent = '';
      }

      const mailbox = extractEmail(resolvedRecipient || toHeader);
      const sender = extractEmail(fromHeader);

      // 存储到 R2
      const r2 = env.MAIL_EML;
      let objectKey = '';
      try {
        const now = new Date();
        const y = now.getUTCFullYear();
        const m = String(now.getUTCMonth() + 1).padStart(2, '0');
        const d = String(now.getUTCDate()).padStart(2, '0');
        const hh = String(now.getUTCHours()).padStart(2, '0');
        const mm = String(now.getUTCMinutes()).padStart(2, '0');
        const ss = String(now.getUTCSeconds()).padStart(2, '0');
        const keyId = (globalThis.crypto?.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const safeMailbox = (mailbox || 'unknown').toLowerCase().replace(/[^a-z0-9@._-]/g, '_');
        objectKey = `${y}/${m}/${d}/${safeMailbox}/${hh}${mm}${ss}-${keyId}.eml`;
        if (r2 && rawBuffer) {
          await r2.put(objectKey, new Uint8Array(rawBuffer), { httpMetadata: { contentType: 'message/rfc822' } });
        }
      } catch (e) {
        console.error('R2 put failed:', e);
      }

      // 生成预览和验证码
      const preview = (() => {
        const plain = textContent && textContent.trim() ? textContent : (htmlContent || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        return String(plain || '').slice(0, 120);
      })();
      let verificationCode = '';
      try {
        verificationCode = extractVerificationCode({ subject, text: textContent, html: htmlContent });
      } catch (_) { }

      // 存储到数据库
      const resMb = await DB.prepare('SELECT id FROM mailboxes WHERE address = ?').bind(mailbox.toLowerCase()).all();
      let mailboxId;
      if (Array.isArray(resMb?.results) && resMb.results.length) {
        mailboxId = resMb.results[0].id;
      } else {
        const [localPartMb, domain] = (mailbox || '').toLowerCase().split('@');
        if (localPartMb && domain) {
          await DB.prepare('INSERT INTO mailboxes (address, local_part, domain, password_hash, last_accessed_at) VALUES (?, ?, ?, NULL, CURRENT_TIMESTAMP)')
            .bind((mailbox || '').toLowerCase(), localPartMb, domain).run();
          const created = await DB.prepare('SELECT id FROM mailboxes WHERE address = ?').bind((mailbox || '').toLowerCase()).all();
          mailboxId = created?.results?.[0]?.id;
        }
      }
      if (!mailboxId) throw new Error('无法解析或创建 mailbox 记录');

      // 解析收件人列表
      let toAddrs = '';
      try {
        const toValue = message.to;
        if (Array.isArray(toValue)) {
          toAddrs = toValue.map(v => (typeof v === 'string' ? v : (v?.address || ''))).filter(Boolean).join(',');
        } else if (typeof toValue === 'string') {
          toAddrs = toValue;
        } else {
          toAddrs = resolvedRecipient || toHeader || '';
        }
      } catch (_) {
        toAddrs = resolvedRecipient || toHeader || '';
      }

      // 插入消息记录
      await DB.prepare(`
        INSERT INTO messages (mailbox_id, sender, to_addrs, subject, verification_code, preview, r2_bucket, r2_object_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        mailboxId,
        sender,
        String(toAddrs || ''),
        subject || '(无主题)',
        verificationCode || null,
        preview || null,
        'mail-eml',
        objectKey || ''
      ).run();
    } catch (err) {
      console.error('Email event handling error:', err);
    }
  }
};
