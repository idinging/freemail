import assert from 'node:assert/strict';
import test from 'node:test';

import { handleMailboxAdminApi } from '../api/mailboxAdmin.js';

function createDeleteDb(address) {
  const batchStatements = [];
  return {
    batchStatements,
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      return {
        bind(...params) {
          return {
            sql: normalized,
            params,
            async all() {
              if (normalized.startsWith('SELECT id FROM mailboxes WHERE address')) {
                return { results: params[0] === address ? [{ id: 7 }] : [] };
              }
              if (normalized.startsWith('SELECT id, r2_bucket, r2_object_key FROM messages')) {
                return { results: [{ id: 81, r2_bucket: 'kv', r2_object_key: 'mail/delete.eml' }] };
              }
              if (normalized.startsWith('SELECT user_id FROM user_mailboxes')) return { results: [] };
              throw new Error(`Unexpected all(): ${normalized}`);
            },
            async run() {
              if (normalized.startsWith('DELETE FROM messages')) return { meta: { changes: 2 } };
              if (normalized.startsWith('DELETE FROM mailboxes')) return { meta: { changes: 1 } };
              throw new Error(`Unexpected run(): ${normalized}`);
            }
          };
        }
      };
    },
    async batch(statements) {
      batchStatements.push(...statements);
      return statements.map(statement => {
        if (statement.sql.startsWith('DELETE FROM messages')) return { meta: { changes: 2 } };
        if (statement.sql.startsWith('DELETE FROM sent_emails')) return { meta: { changes: 3 } };
        if (statement.sql.startsWith('DELETE FROM mailboxes')) return { meta: { changes: 1 } };
        throw new Error(`Unexpected statement: ${statement.sql}`);
      });
    },
    async exec() { return { success: true }; }
  };
}

test('deleting a mailbox removes inbox, outbox, KV objects, and mailbox record', async () => {
  const address = `delete-${Date.now()}@example.com`;
  const db = createDeleteDb(address);
  const deletedKeys = [];
  const request = new Request(`https://example.test/api/mailboxes?address=${encodeURIComponent(address)}`, {
    method: 'DELETE'
  });

  const response = await handleMailboxAdminApi(
    request,
    db,
    new URL(request.url),
    '/api/mailboxes',
    {
      mockOnly: false,
      authPayload: { role: 'admin', username: 'admin' },
      adminName: 'admin',
      kv: { async delete(key) { deletedKeys.push(key); } },
      r2: null
    }
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.inboxDeletedCount, 2);
  assert.equal(body.sentDeletedCount, 3);
  assert.equal(body.deleted, true);
  assert.ok(db.batchStatements.some(statement => statement.sql.startsWith('DELETE FROM sent_emails')));
  assert.deepEqual(deletedKeys, ['mail/delete.eml']);
});

function createBatchDeleteDb(addresses) {
  const ids = new Map(addresses.map((address, index) => [address, index + 20]));
  const batchStatements = [];
  let operationCount = 0;
  return {
    batchStatements,
    get operationCount() { return operationCount; },
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      return {
        bind(...params) {
          return {
            sql: normalized,
            params,
            async all() {
              operationCount++;
              if (normalized.startsWith('SELECT id, address FROM mailboxes WHERE address IN')) {
                return {
                  results: params.filter(address => ids.has(address)).map(address => ({ id: ids.get(address), address }))
                };
              }
              if (normalized.startsWith('SELECT id, mailbox_id, r2_bucket, r2_object_key FROM messages')) {
                return {
                  results: params.map(id => ({ id: id + 1000, mailbox_id: id, r2_bucket: 'kv', r2_object_key: `mail/${id}.eml` }))
                };
              }
              if (normalized.startsWith('SELECT user_id FROM user_mailboxes')) return { results: [] };
              if (normalized.includes('AS address, COUNT(*) AS count FROM sent_emails')) {
                return { results: params.map(address => ({ address, count: 2 })) };
              }
              throw new Error(`Unexpected all(): ${normalized}`);
            }
          };
        }
      };
    },
    async batch(statements) {
      operationCount++;
      batchStatements.push(...statements);
      return statements.map(statement => ({
        meta: { changes: statement.sql.startsWith('DELETE FROM mailboxes') ? 1 : 2 }
      }));
    }
  };
}

test('batch delete deduplicates addresses and purges every mailbox', async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const addresses = [`one-${suffix}@example.com`, `two-${suffix}@example.com`];
  const db = createBatchDeleteDb(addresses);
  const deletedKeys = [];
  const request = new Request('https://example.test/api/mailboxes/batch-delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ addresses: [addresses[0], addresses[1], addresses[0]] })
  });

  const response = await handleMailboxAdminApi(
    request,
    db,
    new URL(request.url),
    '/api/mailboxes/batch-delete',
    {
      mockOnly: false,
      authPayload: { role: 'admin', username: 'admin' },
      adminName: 'admin',
      kv: { async delete(key) { deletedKeys.push(key); } },
      r2: null
    }
  );

  assert.ok(response);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.total, 2);
  assert.equal(body.success_count, 2);
  assert.equal(body.fail_count, 0);
  assert.equal(db.batchStatements.filter(statement => statement.sql.startsWith('DELETE FROM sent_emails')).length, 1);
  const messageDelete = db.batchStatements.find(statement => statement.sql.startsWith('DELETE FROM messages'));
  assert.match(messageDelete.sql, /id <= \?/);
  assert.deepEqual(deletedKeys.sort(), ['mail/20.eml', 'mail/21.eml']);
});

test('batch delete keeps 100 mailboxes within a small D1 operation budget', async () => {
  const suffix = `${Date.now()}${Math.random().toString(36).slice(2)}`;
  const addresses = Array.from({ length: 100 }, (_, index) => `box${index}${suffix}@example.com`);
  const db = createBatchDeleteDb(addresses);
  const request = new Request('https://example.test/api/mailboxes/batch-delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ addresses })
  });

  const response = await handleMailboxAdminApi(
    request,
    db,
    new URL(request.url),
    '/api/mailboxes/batch-delete',
    {
      mockOnly: false,
      authPayload: { role: 'admin', username: 'admin' },
      adminName: 'admin',
      kv: { async delete() {} },
      r2: null
    }
  );

  assert.equal(response.status, 200);
  assert.equal((await response.json()).success_count, 100);
  assert.ok(db.operationCount < 20, `used ${db.operationCount} D1 operations`);
});
