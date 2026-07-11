import assert from 'node:assert/strict';
import test from 'node:test';

import { purgeMailboxData } from '../db/mailboxCleanup.js';

function createDb({ storedMessages, inboxChanges = 2, sentChanges = 3, mailboxChanges = 1 }) {
  const batched = [];
  return {
    batched,
    prepare(sql) {
      return {
        bind(...params) {
          return {
            sql,
            params,
            async all() {
              if (sql.includes('r2_bucket, r2_object_key FROM messages')) return { results: storedMessages };
              if (sql.includes('SELECT user_id FROM user_mailboxes')) return { results: [] };
              throw new Error(`Unexpected all(): ${sql}`);
            }
          };
        }
      };
    },
    async batch(statements) {
      batched.push(...statements);
      return statements.map(statement => {
        if (statement.sql.includes('DELETE FROM messages')) return { meta: { changes: inboxChanges } };
        if (statement.sql.includes('DELETE FROM sent_emails')) return { meta: { changes: sentChanges } };
        if (statement.sql.includes('DELETE FROM mailboxes')) return { meta: { changes: mailboxChanges } };
        throw new Error(`Unexpected batch statement: ${statement.sql}`);
      });
    }
  };
}

test('clearing a mailbox deletes inbox, outbox, and stored EML objects', async () => {
  const db = createDb({
    storedMessages: [
      { id: 10, r2_bucket: 'kv', r2_object_key: 'a.eml' },
      { id: 11, r2_bucket: 'mail-eml', r2_object_key: 'b.eml' }
    ]
  });
  const deletedObjects = [];
  const storage = {
    available: true,
    async delete(key, storageType) { deletedObjects.push([key, storageType]); return true; }
  };

  const result = await purgeMailboxData({
    db,
    mailboxId: 7,
    address: 'Demo@Example.com',
    storage,
    deleteMailbox: false
  });

  assert.deepEqual(result, {
    inboxDeletedCount: 2,
    sentDeletedCount: 3,
    mailboxDeleted: false,
    ownerUserIds: []
  });
  assert.equal(db.batched.length, 2);
  assert.match(db.batched[0].sql, /id <= \?/);
  assert.deepEqual(db.batched[0].params, [7, 11]);
  assert.match(db.batched[1].sql, /LOWER\(TRIM\(CASE/);
  assert.match(db.batched[1].sql, /instr\(from_addr, '<'\)/);
  assert.deepEqual(db.batched[1].params, ['demo@example.com']);
  assert.deepEqual(deletedObjects, [['a.eml', 'kv'], ['b.eml', 'mail-eml']]);
});

test('deleting a mailbox also deletes the mailbox record', async () => {
  const db = createDb({ storedMessages: [], inboxChanges: 0, sentChanges: 1 });

  const result = await purgeMailboxData({
    db,
    mailboxId: 9,
    address: 'remove@example.com',
    storage: null,
    deleteMailbox: true
  });

  assert.equal(result.mailboxDeleted, true);
  assert.equal(db.batched.length, 3);
  assert.match(db.batched[2].sql, /DELETE FROM mailboxes/);
  assert.deepEqual(db.batched[2].params, [9]);
});

test('storage deletion failure preserves D1 rows for retry', async () => {
  const db = createDb({
    storedMessages: [{ id: 20, r2_bucket: 'kv', r2_object_key: 'retry.eml' }]
  });
  const storage = {
    available: true,
    async delete() { return false; }
  };

  await assert.rejects(
    purgeMailboxData({
      db,
      mailboxId: 11,
      address: 'retry@example.com',
      storage,
      deleteMailbox: true
    }),
    /邮件对象删除失败/
  );
  assert.equal(db.batched.length, 0);
});

test('missing storage binding preserves object-backed D1 rows for retry', async () => {
  const db = createDb({
    storedMessages: [{ id: 21, r2_bucket: 'r2', r2_object_key: 'still-stored.eml' }]
  });

  await assert.rejects(
    purgeMailboxData({
      db,
      mailboxId: 12,
      address: 'retry-later@example.com',
      storage: null,
      deleteMailbox: true
    }),
    /邮件对象删除失败/
  );
  assert.equal(db.batched.length, 0);
});
