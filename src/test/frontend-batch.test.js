import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

test('batch mailbox generation posts once and refreshes the mailbox list once', async () => {
  globalThis.localStorage = memoryStorage();
  globalThis.sessionStorage = memoryStorage();
  globalThis.window = {};
  const emailText = { textContent: '' };
  globalThis.document = {
    getElementById(id) { return id === 'email-text' ? emailText : null; },
    querySelectorAll() { return []; }
  };

  const { generateBatchMailboxes } = await import('../..//public/js/modules/app/mailbox-actions.js');
  const { stopAutoRefresh } = await import('../..//public/js/modules/app/auto-refresh.js');
  const requests = [];
  const toasts = [];
  let refreshCount = 0;
  let listRefreshCount = 0;
  const elements = {
    genBatch: { dataset: {}, innerHTML: '批量生成', disabled: false },
    batchCount: { value: '3' },
    email: { classList: { add() {} } },
    emailActions: { style: {} },
    listCard: { style: {} }
  };
  const api = async (path, options = {}) => {
    requests.push([path, options]);
    if (path === '/api/generate/batch') {
      return Response.json({
        emails: ['one@example.com', 'two@example.com', 'three@example.com'],
        success_count: 3,
        fail_count: 0
      });
    }
    if (path.startsWith('/api/mailbox/info')) {
      return Response.json({ id: 3, address: 'three@example.com' });
    }
    throw new Error(`Unexpected request: ${path}`);
  };

  try {
    await generateBatchMailboxes(
      elements,
      { value: '8' },
      { value: '0' },
      api,
      (message, type) => toasts.push([message, type]),
      async () => { refreshCount++; },
      async () => { listRefreshCount++; },
      () => {},
      () => {}
    );
  } finally {
    stopAutoRefresh();
  }

  const generateRequests = requests.filter(([path]) => path === '/api/generate/batch');
  assert.equal(generateRequests.length, 1);
  assert.deepEqual(JSON.parse(generateRequests[0][1].body), { count: 3, length: 8, domainIndex: 0 });
  assert.equal(window.currentMailbox, 'three@example.com');
  assert.equal(emailText.textContent, 'three@example.com');
  assert.equal(refreshCount, 1);
  assert.equal(listRefreshCount, 1);
  assert.deepEqual(toasts, [['已生成 3 个邮箱', 'success']]);
});

test('batch address parser validates and deduplicates mailbox addresses', async () => {
  const { parseMailboxAddresses } = await import('../..//public/js/modules/mailboxes/api.js');

  assert.deepEqual(
    parseMailboxAddresses('One@example.com, two@example.com\none@example.com; invalid@'),
    ['one@example.com', 'two@example.com']
  );
});

test('guest mode supports batch mailbox generation', async () => {
  globalThis.location = { origin: 'https://example.test' };
  const { mockApi, MOCK_STATE } = await import('../../public/js/modules/app/mock-api.js');
  MOCK_STATE.mailboxes = [];

  const response = await mockApi('/api/generate/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ count: 3, length: 8, domainIndex: 0 })
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success_count, 3);
  assert.equal(body.emails.length, 3);
  assert.equal(MOCK_STATE.mailboxes.length, 3);
});

test('batch count input uses the application form styling', async () => {
  const css = await readFile(new URL('../../public/css/app-mailbox.css', import.meta.url), 'utf8');
  const block = css.match(/\.batch-count-input\s*\{([^}]*)\}/s)?.[1] || '';

  assert.match(block, /border\s*:/);
  assert.match(block, /border-radius\s*:/);
  assert.match(block, /background\s*:/);
  assert.match(css, /\.batch-count-input:focus\s*\{/);
});

test('clear mailbox reports a non-2xx API error without refreshing', async () => {
  const { clearAllEmails } = await import('../../public/js/modules/app/mailbox-actions.js');
  const { setCurrentMailbox } = await import('../../public/js/modules/app/mailbox-state.js');
  setCurrentMailbox('clear@example.com');
  const toasts = [];
  let refreshed = false;

  await clearAllEmails(
    async () => Response.json({ error: '清空服务暂不可用' }, { status: 503 }),
    (message, type) => toasts.push([message, type]),
    async () => true,
    async () => { refreshed = true; }
  );

  assert.equal(refreshed, false);
  assert.deepEqual(toasts, [['清空服务暂不可用', 'error']]);
});

test('deleting the current mailbox preserves the custom-address DOM', async () => {
  const { deleteMailboxAddress } = await import('../../public/js/modules/app/mailbox-actions.js');
  const { setCurrentMailbox } = await import('../../public/js/modules/app/mailbox-state.js');
  setCurrentMailbox('delete-ui@example.com');
  const emailText = { textContent: 'delete-ui@example.com' };
  let containerTextWasReplaced = false;
  globalThis.document.getElementById = id => id === 'email-text' ? emailText : null;
  const elements = {
    email: {
      set textContent(_) { containerTextWasReplaced = true; },
      classList: { remove() {} }
    },
    emailActions: { style: {} },
    listCard: { style: { display: 'block' } },
    list: { innerHTML: 'mail rows' }
  };

  await deleteMailboxAddress(
    { stopPropagation() {} },
    'delete-ui@example.com',
    elements,
    async () => Response.json({ success: true }),
    () => {},
    async () => true,
    async () => {}
  );

  assert.equal(containerTextWasReplaced, false);
  assert.match(emailText.textContent, /点击/);
  assert.equal(elements.listCard.style.display, 'none');
});
