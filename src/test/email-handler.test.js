import assert from 'node:assert/strict';
import test from 'node:test';

import { handleEmailEvent } from '../email/handler.js';

function createIncomingDb(name, { failMessageInsert = false } = {}) {
  const mailboxes = new Map();
  const messages = [];
  let nextId = 1;

  return {
    name,
    mailboxes,
    messages,
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      return {
        async all() {
          if (normalized === 'SELECT 1') return { results: [{ 1: 1 }] };
          throw new Error(`Unexpected direct all(): ${normalized}`);
        },
        bind(...params) {
          return {
            async first() {
              if (normalized.startsWith('SELECT forward_to FROM mailboxes')) return null;
              throw new Error(`Unexpected first(): ${normalized}`);
            },
            async all() {
              if (normalized === 'SELECT 1') return { results: [{ 1: 1 }] };
              if (normalized.startsWith('SELECT id FROM mailboxes WHERE address')) {
                const id = mailboxes.get(params[0]);
                return { results: id ? [{ id }] : [] };
              }
              throw new Error(`Unexpected all(): ${normalized}`);
            },
            async run() {
              if (normalized.startsWith('INSERT') && normalized.includes('INTO mailboxes')) {
                if (!mailboxes.has(params[0])) mailboxes.set(params[0], nextId++);
                return { meta: { changes: 1 } };
              }
              if (normalized.startsWith('UPDATE mailboxes SET last_accessed_at')) return { meta: { changes: 1 } };
              if (normalized.startsWith('INSERT INTO messages')) {
                if (failMessageInsert) throw new Error('D1 insert failed');
                messages.push(params);
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

test('an incoming message creates an unknown mailbox and stores its EML in KV', async () => {
  const raw = [
    'From: sender@example.net',
    'To: demo1@example.com',
    'Subject: First delivery',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'hello demo1'
  ].join('\r\n');
  const db = createIncomingDb(`incoming-${Date.now()}-${Math.random()}`);
  const stored = [];
  const kv = {
    async put(key, value) { stored.push([key, new Uint8Array(value)]); }
  };
  globalThis.__DB_INITED__ = new Set([db.name]);

  const message = {
    headers: new Headers({
      from: 'sender@example.net',
      to: 'demo1@example.com',
      subject: 'First delivery'
    }),
    to: 'demo1@example.com',
    raw
  };

  await handleEmailEvent(message, { TEMP_MAIL_DB: db, MAIL_EML_KV: kv }, { waitUntil() {} });

  assert.ok(db.mailboxes.has('demo1@example.com'));
  assert.equal(stored.length, 1);
  assert.equal(db.messages.length, 1);
  assert.equal(db.messages[0][6], 'kv');
  assert.equal(db.messages[0][7], stored[0][0]);
});

test('incoming metadata is retained without creating a false object key when storage is unbound', async () => {
  const address = `metadata${Date.now()}@example.com`;
  const raw = [
    'From: sender@example.net',
    `To: ${address}`,
    'Subject: Metadata only',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'metadata body'
  ].join('\r\n');
  const db = createIncomingDb(`metadata-${Date.now()}-${Math.random()}`);
  globalThis.__DB_INITED__ = new Set([db.name]);

  await handleEmailEvent({
    headers: new Headers({ from: 'sender@example.net', to: address, subject: 'Metadata only' }),
    to: address,
    raw
  }, { TEMP_MAIL_DB: db }, { waitUntil() {} });

  assert.ok(db.mailboxes.has(address));
  assert.equal(db.messages.length, 1);
  assert.equal(db.messages[0][6], '');
  assert.equal(db.messages[0][7], '');
});

test('incoming storage object is rolled back when D1 message insertion fails', async () => {
  const address = `rollback${Date.now()}@example.com`;
  const raw = `From: sender@example.net\r\nTo: ${address}\r\nSubject: Rollback\r\n\r\nbody`;
  const db = createIncomingDb(`rollback-${Date.now()}-${Math.random()}`, { failMessageInsert: true });
  const stored = [];
  const deleted = [];
  const kv = {
    async put(key) { stored.push(key); },
    async delete(key) { deleted.push(key); }
  };
  globalThis.__DB_INITED__ = new Set([db.name]);

  await handleEmailEvent({
    headers: new Headers({ from: 'sender@example.net', to: address, subject: 'Rollback' }),
    to: address,
    raw
  }, { TEMP_MAIL_DB: db, MAIL_EML_KV: kv }, { waitUntil() {} });

  assert.equal(stored.length, 1);
  assert.deepEqual(deleted, stored);
  assert.equal(db.messages.length, 0);
});
