import assert from 'node:assert/strict';
import test from 'node:test';

import { handleEmailsApi } from '../api/emails.js';

const RAW_EMAIL = [
  'From: sender@example.net',
  'To: demo@example.com',
  'Subject: Stored message',
  'MIME-Version: 1.0',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'body from KV'
].join('\r\n');

function createApiDb({ oldMessage = false, legacyMode = false } = {}) {
  const deletedMessageIds = [];
  const calls = [];
  const row = {
    id: 1,
    mailbox_id: 7,
    sender: 'sender@example.net',
    to_addrs: 'demo@example.com',
    subject: 'Stored message',
    verification_code: null,
    preview: 'body from KV',
    r2_bucket: 'kv',
    r2_object_key: 'mail/demo.eml',
    received_at: '2026-01-01 00:00:00',
    is_read: 0
  };

  return {
    deletedMessageIds,
    calls,
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      return {
        bind(...params) {
          calls.push({ sql: normalized, params });
          return {
            async first() {
              if (normalized.startsWith('SELECT id, mailbox_id FROM messages')) return { id: 1, mailbox_id: 7 };
              if (normalized.startsWith('SELECT id, address FROM mailboxes')) return { id: 7, address: 'demo@example.com' };
              if (normalized.startsWith('SELECT r2_bucket, r2_object_key FROM messages')) {
                if (oldMessage && normalized.includes('received_at >=')) return null;
                return { r2_object_key: row.r2_object_key, r2_bucket: row.r2_bucket };
              }
              throw new Error(`Unexpected first(): ${normalized}`);
            },
            async all() {
              if (normalized.startsWith('SELECT r2_bucket, r2_object_key FROM messages')) {
                if (oldMessage && normalized.includes('received_at >=')) return { results: [] };
                return { results: [{ r2_bucket: row.r2_bucket, r2_object_key: row.r2_object_key }] };
              }
              if (normalized.includes('SELECT content, html_content FROM messages')) {
                return { results: [{ content: '', html_content: '' }] };
              }
              if (normalized.includes('FROM messages WHERE id = ?')) {
                if (legacyMode && normalized.includes('verification_code')) throw new Error('legacy schema');
                if (oldMessage && normalized.includes('received_at >=')) return { results: [] };
                return { results: [{ ...row, content: 'legacy body', html_content: '' }] };
              }
              throw new Error(`Unexpected all(): ${normalized}`);
            },
            async run() {
              if (normalized.startsWith('UPDATE messages SET is_read')) return { meta: { changes: 1 } };
              if (normalized.startsWith('DELETE FROM messages')) {
                deletedMessageIds.push(params[0]);
                return { meta: { changes: 1 } };
              }
              throw new Error(`Unexpected run(): ${normalized}`);
            }
          };
        }
      };
    }
  };
}

function adminOptions(kv) {
  return {
    mockOnly: false,
    mailboxOnly: false,
    authPayload: { role: 'admin', username: 'admin' },
    adminName: 'admin',
    kv,
    r2: null
  };
}

function createKv(deletedKeys = []) {
  return {
    async get() { return new TextEncoder().encode(RAW_EMAIL).buffer; },
    async delete(key) { deletedKeys.push(key); }
  };
}

test('email detail loads EML content from KV', async () => {
  const request = new Request('https://example.test/api/email/1');
  const response = await handleEmailsApi(
    request,
    createApiDb(),
    new URL(request.url),
    '/api/email/1',
    adminOptions(createKv())
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.content.trim(), 'body from KV');
  assert.equal(body.download, '/api/email/1/download');
});

test('email download streams the original EML from KV', async () => {
  const request = new Request('https://example.test/api/email/1/download');
  const response = await handleEmailsApi(
    request,
    createApiDb(),
    new URL(request.url),
    '/api/email/1/download',
    adminOptions(createKv())
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'message/rfc822');
  assert.equal(await response.text(), RAW_EMAIL);
});

test('deleting an email removes its KV object', async () => {
  const deletedKeys = [];
  const request = new Request('https://example.test/api/email/1', { method: 'DELETE' });
  const response = await handleEmailsApi(
    request,
    createApiDb(),
    new URL(request.url),
    '/api/email/1',
    adminOptions(createKv(deletedKeys))
  );

  assert.equal(response.status, 200);
  assert.deepEqual(deletedKeys, ['mail/demo.eml']);
});

test('email deletion preserves D1 metadata when KV deletion fails', async () => {
  const db = createApiDb();
  const request = new Request('https://example.test/api/email/1', { method: 'DELETE' });
  const response = await handleEmailsApi(
    request,
    db,
    new URL(request.url),
    '/api/email/1',
    adminOptions({
      async get() { return new TextEncoder().encode(RAW_EMAIL).buffer; },
      async delete() { throw new Error('KV unavailable'); }
    })
  );

  assert.equal(response.status, 500);
  assert.deepEqual(db.deletedMessageIds, []);
});

test('email deletion preserves D1 metadata when its storage binding is missing', async () => {
  const db = createApiDb();
  const request = new Request('https://example.test/api/email/1', { method: 'DELETE' });
  const response = await handleEmailsApi(
    request,
    db,
    new URL(request.url),
    '/api/email/1',
    adminOptions(null)
  );

  assert.equal(response.status, 500);
  assert.deepEqual(db.deletedMessageIds, []);
});

test('mailbox login cannot download EML older than 24 hours', async () => {
  let kvReads = 0;
  const request = new Request('https://example.test/api/email/1/download');
  const response = await handleEmailsApi(
    request,
    createApiDb({ oldMessage: true }),
    new URL(request.url),
    '/api/email/1/download',
    {
      mockOnly: false,
      mailboxOnly: true,
      authPayload: { role: 'mailbox', mailboxId: 7, mailboxAddress: 'demo@example.com' },
      kv: { async get() { kvReads++; return new TextEncoder().encode(RAW_EMAIL).buffer; } },
      r2: null
    }
  );

  assert.equal(response.status, 404);
  assert.equal(kvReads, 0);
});

test('mailbox login uses a D1-compatible UTC cutoff for the 24 hour filter', async () => {
  const db = createApiDb();
  const request = new Request('https://example.test/api/email/1');
  const response = await handleEmailsApi(
    request,
    db,
    new URL(request.url),
    '/api/email/1',
    {
      mockOnly: false,
      mailboxOnly: true,
      authPayload: { role: 'mailbox', mailboxId: 7, mailboxAddress: 'demo@example.com' },
      kv: createKv(),
      r2: null
    }
  );

  assert.equal(response.status, 200);
  const filteredQuery = db.calls.find(call => call.sql.includes('received_at >= ?'));
  assert.ok(filteredQuery);
  assert.match(filteredQuery.params.at(-1), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test('mailbox login cannot delete a message older than 24 hours', async () => {
  const db = createApiDb({ oldMessage: true });
  const request = new Request('https://example.test/api/email/1', { method: 'DELETE' });
  const response = await handleEmailsApi(
    request,
    db,
    new URL(request.url),
    '/api/email/1',
    {
      mockOnly: false,
      mailboxOnly: true,
      authPayload: { role: 'mailbox', mailboxId: 7, mailboxAddress: 'demo@example.com' },
      kv: createKv(),
      r2: null
    }
  );

  assert.equal(response.status, 404);
  assert.deepEqual(db.deletedMessageIds, []);
});

test('legacy detail fallback keeps the mailbox-login 24 hour filter', async () => {
  const request = new Request('https://example.test/api/email/1');
  const response = await handleEmailsApi(
    request,
    createApiDb({ oldMessage: true, legacyMode: true }),
    new URL(request.url),
    '/api/email/1',
    {
      mockOnly: false,
      mailboxOnly: true,
      authPayload: { role: 'mailbox', mailboxId: 7, mailboxAddress: 'demo@example.com' },
      kv: null,
      r2: null
    }
  );

  assert.equal(response.status, 404);
});
