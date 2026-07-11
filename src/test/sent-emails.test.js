import assert from 'node:assert/strict';
import test from 'node:test';

import { recordSentEmail } from '../db/sentEmails.js';

test('sent records normalize display-name sender addresses for mailbox cleanup', async () => {
  let boundParams = [];
  const db = {
    prepare() {
      return {
        bind(...params) {
          boundParams = params;
          return { async run() { return { meta: { changes: 1 } }; } };
        }
      };
    }
  };

  await recordSentEmail(db, {
    resendId: 'sent-1',
    fromName: 'Demo',
    from: 'Demo Sender <User@Example.com>',
    to: 'recipient@example.net',
    subject: 'Subject',
    html: '<p>Body</p>',
    text: 'Body'
  });

  assert.equal(boundParams[2], 'user@example.com');
});
