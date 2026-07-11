import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyProtectedPage } from '../routes/static.js';

test('mailbox overview is not classified as a mailbox-only page', () => {
  assert.equal(classifyProtectedPage('/html/mailboxes.html'), 'mailboxes');
  assert.equal(classifyProtectedPage('/mailboxes.html'), 'mailboxes');
});

test('single mailbox and admin pages retain their own classifications', () => {
  assert.equal(classifyProtectedPage('/html/mailbox.html'), 'mailbox');
  assert.equal(classifyProtectedPage('/mailbox.html'), 'mailbox');
  assert.equal(classifyProtectedPage('/html/admin.html'), 'admin');
});
