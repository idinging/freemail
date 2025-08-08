import { extractEmail, generateRandomId } from './utils.js';

export async function handleApiRequest(request, db, mailDomain) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/api/generate') {
    const randomId = generateRandomId();
    const email = `${randomId}@${mailDomain}`;
    return Response.json({ email, expires: Date.now() + 3600000 });
  }

  if (path === '/api/emails') {
    const mailbox = url.searchParams.get('mailbox');
    if (!mailbox) {
      return new Response('Missing mailbox parameter', { status: 400 });
    }
    const { results } = await db.prepare(`
      SELECT id, sender, subject, received_at, is_read 
      FROM emails 
      WHERE mailbox = ? 
      ORDER BY received_at DESC 
      LIMIT 50
    `).bind(mailbox).all();
    return Response.json(results);
  }

  if (path.startsWith('/api/email/')) {
    const emailId = path.split('/')[3];
    const { results } = await db.prepare(`
      SELECT * FROM emails WHERE id = ?
    `).bind(emailId).all();
    if (results.length === 0) {
      return new Response('Email not found', { status: 404 });
    }
    await db.prepare(`
      UPDATE emails SET is_read = 1 WHERE id = ?
    `).bind(emailId).run();
    return Response.json(results[0]);
  }

  if (request.method === 'DELETE' && path.startsWith('/api/email/')) {
    const emailId = path.split('/')[3];
    await db.prepare(`DELETE FROM emails WHERE id = ?`).bind(emailId).run();
    return Response.json({ success: true });
  }

  if (request.method === 'DELETE' && path === '/api/emails') {
    const mailbox = url.searchParams.get('mailbox');
    if (!mailbox) {
      return new Response('Missing mailbox parameter', { status: 400 });
    }
    await db.prepare(`DELETE FROM emails WHERE mailbox = ?`).bind(mailbox).run();
    return Response.json({ success: true });
  }

  return new Response('API endpoint not found', { status: 404 });
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
    console.error('Email receive error:', error);
    return new Response('Error processing email', { status: 500 });
  }
}

