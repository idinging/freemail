/**
 * 邮件事件处理器
 * @module email/handler
 */

import { getInitializedDatabase } from '../db/index.js';
import { extractEmail, normalizeEmailAlias } from '../utils/common.js';
import { forwardByLocalPart, forwardByMailboxConfig } from './forwarder.js';
import { parseEmailBody, extractVerificationCode } from './parser.js';
import { getForwardTarget, getOrCreateMailboxId } from '../db/mailboxes.js';
import { createEmailStorageFromEnv } from './storage.js';

export async function handleEmailEvent(message, env, ctx) {
  let DB;
  try {
    DB = await getInitializedDatabase(env);
  } catch (error) {
    console.error('邮件处理时数据库连接失败:', error.message);
    return;
  }

  try {
    const headers = message.headers;
    const toHeader = headers.get('to') || headers.get('To') || '';
    const fromHeader = headers.get('from') || headers.get('From') || '';
    const subject = headers.get('subject') || headers.get('Subject') || '(无主题)';

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
    const resolvedAddr = extractEmail(resolvedRecipient);
    const normalizedAddr = normalizeEmailAlias(resolvedAddr);
    const localPart = (normalizedAddr.split('@')[0] || '').toLowerCase();

    const mailboxForwardTo = await getForwardTarget(DB, normalizedAddr);
    let result;
    if (mailboxForwardTo) {
      result = forwardByMailboxConfig(message, mailboxForwardTo, ctx);
    } else {
      result = forwardByLocalPart(message, localPart, ctx, env);
    }
    if (result.hasTarget && !result.forwarded) {
      message.setReject('Forward failed');
    }

    let textContent = '';
    let htmlContent = '';
    let rawBuffer = null;
    try {
      const resp = new Response(message.raw);
      rawBuffer = await resp.arrayBuffer();
      const rawText = new TextDecoder().decode(rawBuffer);
      const parsed = await parseEmailBody(rawText);
      textContent = parsed.text || '';
      htmlContent = parsed.html || '';
      if (!textContent && !htmlContent) textContent = (rawText || '').slice(0, 100000);
    } catch (_) { }

    const mailbox = normalizedAddr || normalizeEmailAlias(extractEmail(toHeader));
    const sender = extractEmail(fromHeader);

    const storage = createEmailStorageFromEnv(env);
    let objectKey = '';
    let storageType = '';
    try {
      if (storage.available && rawBuffer) {
        const now = new Date();
        const y = now.getUTCFullYear();
        const m = String(now.getUTCMonth() + 1).padStart(2, '0');
        const d = String(now.getUTCDate()).padStart(2, '0');
        const hh = String(now.getUTCHours()).padStart(2, '0');
        const mm = String(now.getUTCMinutes()).padStart(2, '0');
        const ss = String(now.getUTCSeconds()).padStart(2, '0');
        const keyId = (globalThis.crypto?.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const safeMailbox = (mailbox || 'unknown').toLowerCase().replace(/[^a-z0-9@._-]/g, '_');
        const candidateKey = `${y}/${m}/${d}/${safeMailbox}/${hh}${mm}${ss}-${keyId}.eml`;
        const stored = await storage.put(candidateKey, new Uint8Array(rawBuffer));
        objectKey = stored?.key || '';
        storageType = stored?.storageType || '';
      }
    } catch (e) { console.error('邮件对象存储失败:', e); }

    const preview = String(
      (textContent?.trim() ? textContent : (htmlContent || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()) || ''
    ).slice(0, 120);
    let verificationCode = '';
    try { verificationCode = extractVerificationCode({ subject, text: textContent, html: htmlContent }); } catch (_) { }

    try {
      const mailboxId = await getOrCreateMailboxId(DB, mailbox);
      if (!mailboxId) throw new Error('无法解析或创建 mailbox 记录');

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
      } catch (_) { toAddrs = resolvedRecipient || toHeader || ''; }

      await DB.prepare(`
        INSERT INTO messages (mailbox_id, sender, to_addrs, subject, verification_code, preview, r2_bucket, r2_object_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(mailboxId, sender, String(toAddrs || ''), subject || '(无主题)', verificationCode || null, preview || null, storageType, objectKey).run();
    } catch (error) {
      if (objectKey && storage.available) {
        const rolledBack = await storage.delete(objectKey, storageType);
        if (!rolledBack) console.error('D1 写入失败后回滚邮件对象失败:', objectKey);
      }
      throw error;
    }
  } catch (err) {
    console.error('Email event handling error:', err);
  }
}
