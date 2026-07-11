import assert from 'node:assert/strict';
import test from 'node:test';

import { handleMailboxesApi } from '../api/mailboxes.js';

test('ordinary users cannot claim an existing unowned mailbox', async () => {
  let associationInserted = false;
  const db = {
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      return {
        bind() {
          return {
            async all() {
              if (normalized.startsWith('SELECT id FROM mailboxes WHERE address')) return { results: [{ id: 7 }] };
              if (normalized.startsWith('SELECT id FROM user_mailboxes')) return { results: [] };
              if (normalized.startsWith('SELECT mailbox_limit FROM users')) return { results: [{ mailbox_limit: 10 }] };
              if (normalized.startsWith('SELECT COUNT(1) AS c FROM user_mailboxes')) return { results: [{ c: 0 }] };
              throw new Error(`Unexpected all(): ${normalized}`);
            },
            async run() {
              if (normalized.startsWith('UPDATE mailboxes SET last_accessed_at')) return { meta: { changes: 1 } };
              if (normalized.startsWith('INSERT OR IGNORE INTO user_mailboxes')) {
                associationInserted = true;
                return { meta: { changes: 1 } };
              }
              throw new Error(`Unexpected run(): ${normalized}`);
            }
          };
        }
      };
    }
  };
  const request = new Request('https://example.test/api/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ local: 'victim', domainIndex: 0 })
  });

  const response = await handleMailboxesApi(
    request,
    db,
    ['example.com'],
    new URL(request.url),
    '/api/create',
    { mockOnly: false, authPayload: { role: 'user', userId: 42, username: 'member' } }
  );

  assert.equal(response.status, 409);
  assert.equal(associationInserted, false);
});
