import assert from 'node:assert/strict';
import test from 'node:test';

import { handleMailboxesApi } from '../api/mailboxes.js';

function createGenerateDb({ quotaLimit = 10, quotaUsed = 0 } = {}) {
  const mailboxes = new Map();
  const assignedMailboxIds = new Set();
  let nextId = 1;
  let used = quotaUsed;
  let operationCount = 0;
  return {
    mailboxes,
    get used() { return used; },
    get operationCount() { return operationCount; },
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      return {
        bind(...params) {
          return {
            async all() {
              operationCount++;
              if (normalized.startsWith('SELECT mailbox_limit FROM users')) {
                return { results: [{ mailbox_limit: quotaLimit }] };
              }
              if (normalized.startsWith('SELECT COUNT(1) AS c FROM user_mailboxes')) {
                return { results: [{ c: used }] };
              }
              if (normalized.startsWith('SELECT address FROM mailboxes WHERE address IN')) {
                return { results: params.filter(address => mailboxes.has(address)).map(address => ({ address })) };
              }
              if (normalized.startsWith('SELECT m.address FROM mailboxes m JOIN user_mailboxes')) {
                return {
                  results: params.slice(1)
                    .filter(address => assignedMailboxIds.has(mailboxes.get(address)))
                    .map(address => ({ address }))
                };
              }
              if (normalized.startsWith('SELECT id FROM mailboxes WHERE address')) {
                const id = mailboxes.get(params[0]);
                return { results: id ? [{ id }] : [] };
              }
              throw new Error(`Unexpected all(): ${normalized}`);
            },
            async run() {
              operationCount++;
              if (normalized.startsWith('INSERT OR IGNORE INTO mailboxes')) {
                for (let index = 0; index < params.length; index += 3) {
                  if (!mailboxes.has(params[index])) mailboxes.set(params[index], nextId++);
                }
                return { meta: { changes: 1 } };
              }
              if (normalized.startsWith('UPDATE mailboxes SET last_accessed_at')) return { meta: { changes: 1 } };
              if (normalized.startsWith('INSERT OR IGNORE INTO user_mailboxes')) {
                let changes = 0;
                const enforceQuota = normalized.includes(' LIMIT (');
                const remaining = enforceQuota ? Math.max(0, quotaLimit - used) : Infinity;
                const addressParams = params.slice(1, enforceQuota ? -2 : -1);
                for (const address of addressParams) {
                  const mailboxId = mailboxes.get(address);
                  if (!mailboxId || assignedMailboxIds.has(mailboxId) || changes >= remaining) continue;
                  assignedMailboxIds.add(mailboxId);
                  used++;
                  changes++;
                }
                return { meta: { changes } };
              }
              if (normalized.startsWith('DELETE FROM mailboxes WHERE address IN')) {
                let changes = 0;
                for (const address of params) {
                  const mailboxId = mailboxes.get(address);
                  if (!mailboxId || assignedMailboxIds.has(mailboxId)) continue;
                  mailboxes.delete(address);
                  changes++;
                }
                return { meta: { changes } };
              }
              throw new Error(`Unexpected run(): ${normalized}`);
            }
          };
        }
      };
    }
  };
}

test('batch generation creates the requested number of unique mailboxes', async () => {
  const db = createGenerateDb();
  const request = new Request('https://example.test/api/generate/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ count: 4, length: 10, domainIndex: 0 })
  });

  const response = await handleMailboxesApi(
    request,
    db,
    ['example.com'],
    new URL(request.url),
    '/api/generate/batch',
    { mockOnly: false, authPayload: null }
  );

  assert.ok(response);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success_count, 4);
  assert.equal(body.fail_count, 0);
  assert.equal(body.emails.length, 4);
  assert.equal(new Set(body.emails).size, 4);
  assert.ok(body.emails.every(email => /^[a-z0-9]{10}@example\.com$/.test(email)));
  assert.equal(db.mailboxes.size, 4);
});

test('batch generation rejects more than 100 mailboxes', async () => {
  const request = new Request('https://example.test/api/generate/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ count: 101, length: 8, domainIndex: 0 })
  });

  const response = await handleMailboxesApi(
    request,
    createGenerateDb(),
    ['example.com'],
    new URL(request.url),
    '/api/generate/batch',
    { mockOnly: false, authPayload: null }
  );

  assert.ok(response);
  assert.equal(response.status, 400);
});

test('batch generation rejects a request larger than the remaining user quota', async () => {
  const userId = Math.floor(Date.now() + Math.random() * 10000);
  const request = new Request('https://example.test/api/generate/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ count: 2, length: 8, domainIndex: 0 })
  });

  const response = await handleMailboxesApi(
    request,
    createGenerateDb({ quotaLimit: 10, quotaUsed: 9 }),
    ['example.com'],
    new URL(request.url),
    '/api/generate/batch',
    { mockOnly: false, authPayload: { role: 'user', username: 'member', userId } }
  );

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /配额不足/);
});

test('batch generation assigns every mailbox when an ordinary user has enough quota', async () => {
  const userId = Math.floor(Date.now() + Math.random() * 10000);
  const db = createGenerateDb({ quotaLimit: 10, quotaUsed: 6 });
  const request = new Request('https://example.test/api/generate/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ count: 4, length: 8, domainIndex: 0 })
  });

  const response = await handleMailboxesApi(
    request,
    db,
    ['example.com'],
    new URL(request.url),
    '/api/generate/batch',
    { mockOnly: false, authPayload: { role: 'user', username: 'member', userId } }
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success_count, 4);
  assert.equal(body.fail_count, 0);
  assert.equal(body.emails.length, 4);
  assert.equal(db.used, 10);
  assert.equal(db.mailboxes.size, 4);
});

test('batch generation does not apply mailbox_limit to a strict administrator', async () => {
  const userId = Math.floor(Date.now() + Math.random() * 10000);
  const db = createGenerateDb({ quotaLimit: 1, quotaUsed: 1 });
  const request = new Request('https://example.test/api/generate/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ count: 3, length: 8, domainIndex: 0 })
  });

  const response = await handleMailboxesApi(
    request,
    db,
    ['example.com'],
    new URL(request.url),
    '/api/generate/batch',
    {
      mockOnly: false,
      authPayload: { role: 'admin', username: 'admin', userId },
      adminName: 'admin'
    }
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success_count, 3);
  assert.equal(body.fail_count, 0);
  assert.equal(db.mailboxes.size, 3);
});

test('batch generation keeps 100 mailboxes within a small D1 operation budget', async () => {
  const db = createGenerateDb();
  const request = new Request('https://example.test/api/generate/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ count: 100, length: 12, domainIndex: 0 })
  });

  const response = await handleMailboxesApi(
    request,
    db,
    ['example.com'],
    new URL(request.url),
    '/api/generate/batch',
    { mockOnly: false, authPayload: null }
  );

  assert.equal(response.status, 200);
  assert.equal((await response.json()).success_count, 100);
  assert.ok(db.operationCount < 20, `used ${db.operationCount} D1 operations`);
});
