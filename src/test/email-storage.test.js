import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmailStorage } from '../email/storage.js';

function bytes(value) {
  return new TextEncoder().encode(value);
}

test('new messages use KV before R2 when both are bound', async () => {
  const calls = [];
  const kv = {
    async put(key, value) { calls.push(['kv', key, new Uint8Array(value)]); }
  };
  const r2 = {
    async put(key) { calls.push(['r2', key]); }
  };

  const storage = createEmailStorage({ kv, r2 });
  const result = await storage.put('mail/test.eml', bytes('hello'));

  assert.deepEqual(result, { key: 'mail/test.eml', storageType: 'kv' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'kv');
  assert.equal(new TextDecoder().decode(calls[0][2]), 'hello');
});

test('new messages fall back to R2 when KV is not bound', async () => {
  const calls = [];
  const r2 = {
    async put(key, value, options) { calls.push({ key, value, options }); }
  };

  const storage = createEmailStorage({ r2 });
  const result = await storage.put('mail/test.eml', bytes('hello'));

  assert.deepEqual(result, { key: 'mail/test.eml', storageType: 'r2' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.httpMetadata.contentType, 'message/rfc822');
});

test('R2-only storage reads an original EML object', async () => {
  const r2 = {
    async get() {
      return { async arrayBuffer() { return bytes('from-r2').buffer; } };
    }
  };

  const storage = createEmailStorage({ r2 });
  const value = await storage.get('mail/test.eml', 'r2');

  assert.equal(new TextDecoder().decode(value), 'from-r2');
});

test('no binding stores no object and creates no false download key', async () => {
  const storage = createEmailStorage();

  assert.equal(await storage.put('mail/test.eml', bytes('hello')), null);
  assert.equal(await storage.get('mail/test.eml', 'kv'), null);
  assert.equal(await storage.delete('mail/test.eml', 'r2'), false);
});

test('reads legacy R2 records first and falls back to KV', async () => {
  const calls = [];
  const kv = {
    async get(key, options) {
      calls.push(['kv', key, options]);
      return bytes('from-kv').buffer;
    }
  };
  const r2 = {
    async get(key) {
      calls.push(['r2', key]);
      return null;
    }
  };

  const storage = createEmailStorage({ kv, r2 });
  const value = await storage.get('legacy.eml', 'mail-eml');

  assert.equal(new TextDecoder().decode(value), 'from-kv');
  assert.deepEqual(calls.map(call => call[0]), ['r2', 'kv']);
});

test('delete removes a key from every bound backend', async () => {
  const calls = [];
  const kv = { async delete(key) { calls.push(['kv', key]); } };
  const r2 = { async delete(key) { calls.push(['r2', key]); } };

  const storage = createEmailStorage({ kv, r2 });
  assert.equal(await storage.delete('mail/test.eml', 'kv'), true);
  assert.deepEqual(calls, [['kv', 'mail/test.eml'], ['r2', 'mail/test.eml']]);
});

test('delete reports failure when the recorded backend cannot delete the object', async () => {
  const kv = { async delete() { throw new Error('KV unavailable'); } };
  const r2 = { async delete() {} };
  const storage = createEmailStorage({ kv, r2 });

  assert.equal(await storage.delete('mail/test.eml', 'kv'), false);
});

test('delete reports failure when the recorded backend is not bound', async () => {
  const r2Deleted = [];
  const storage = createEmailStorage({
    r2: { async delete(key) { r2Deleted.push(key); } }
  });

  assert.equal(await storage.delete('mail/test.eml', 'kv'), false);
  assert.deepEqual(r2Deleted, ['mail/test.eml']);
});
