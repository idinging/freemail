import { initDatabase } from './db.js';
import { handleApiRequest, handleEmailReceive } from './handlers.js';
import { renderHtml } from './ui.js';
import { extractEmail } from './utils.js';
import { parseEmailBody } from './emailParser.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const DB = env.TEMP_MAIL_DB;
    const MAIL_DOMAIN = env.MAIL_DOMAIN || 'temp.example.com';

    await initDatabase(DB);

    if (url.pathname.startsWith('/api/')) {
      return handleApiRequest(request, DB, MAIL_DOMAIN);
    }

    if (request.method === 'POST' && url.pathname === '/receive') {
      return handleEmailReceive(request, DB);
    }

    return new Response(renderHtml(MAIL_DOMAIN), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  },

  async email(message, env, ctx) {
    const DB = env.TEMP_MAIL_DB;
    await initDatabase(DB);

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
      } catch (_) {}

      const resolvedRecipient = (envelopeTo || toHeader || '').toString();
      const resolvedRecipientAddr = extractEmail(resolvedRecipient);
      const localPart = (resolvedRecipientAddr.split('@')[0] || '').toLowerCase();

      try {
        if (localPart.startsWith('xms')) {
          ctx.waitUntil(message.forward('1815912130@qq.com'));
        } else if (localPart.startsWith('lz')) {
          ctx.waitUntil(message.forward('2106255667@qq.com'));
        } else {
          ctx.waitUntil(message.forward('2141083706@qq.com'));
        }
      } catch (e) {
        console.error('Forward error:', e);
      }

      let textContent = '';
      let htmlContent = '';
      try {
        const rawText = await new Response(message.raw).text();
        const parsed = parseEmailBody(rawText);
        textContent = parsed.text || '';
        htmlContent = parsed.html || '';
      } catch (_) {
        textContent = '';
        htmlContent = '';
      }

      const mailbox = extractEmail(resolvedRecipient || toHeader);
      const sender = extractEmail(fromHeader);

      await DB.prepare(`
        INSERT INTO emails (mailbox, sender, subject, content, html_content)
        VALUES (?, ?, ?, ?, ?)
      `).bind(mailbox, sender, subject, textContent || htmlContent || '(无内容)', htmlContent || null).run();
    } catch (err) {
      console.error('Email event handling error:', err);
    }
  }
};

