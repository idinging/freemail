import assert from 'node:assert/strict';
import test from 'node:test';

import { getOrCreateMailboxId } from '../db/mailboxes.js';

test('mailbox creation tolerates concurrent first delivery', async () => {
  const address = `first-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  let selectCount = 0;
  let insertSql = '';
  const db = {
    prepare(sql) {
      return {
        bind() {
          return {
            async all() {
              selectCount++;
              return selectCount < 3 ? { results: [] } : { results: [{ id: 42 }] };
            },
            async run() {
              insertSql = sql;
              return { success: true };
            }
          };
        }
      };
    }
  };

  assert.equal(await getOrCreateMailboxId(db, address), 42);
  assert.match(insertSql, /INSERT OR IGNORE INTO mailboxes/i);
});
