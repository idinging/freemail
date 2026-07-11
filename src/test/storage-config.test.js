import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);

test('default Wrangler config does not require an R2 bucket', async () => {
  const config = await readFile(new URL('wrangler.toml', root), 'utf8');
  const activeLines = config
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));

  assert.equal(activeLines.includes('[[r2_buckets]]'), false);
  assert.equal(activeLines.includes('[[kv_namespaces]]'), false);
  assert.match(config, /binding\s*=\s*"MAIL_EML_KV"/);
  assert.match(config, /binding\s*=\s*"MAIL_EML"/);
});

test('deployment workflow only configures explicitly requested storage', async () => {
  const workflow = await readFile(new URL('.github/workflows/deploy-cloudflare.yml', root), 'utf8');

  assert.doesNotMatch(workflow, /R2_BUCKET_NAME:[^\n]*\|\|\s*'mail-eml'/);
  assert.match(workflow, /KV_NAMESPACE_ID:/);
  assert.match(workflow, /binding = "MAIL_EML_KV"/);
  assert.match(workflow, /if:\s*env\.R2_BUCKET_NAME\s*!=\s*''/);
});

test('deployment only includes explicitly configured sending provider keys', async () => {
  const [config, workflow] = await Promise.all([
    readFile(new URL('wrangler.toml', root), 'utf8'),
    readFile(new URL('.github/workflows/deploy-cloudflare.yml', root), 'utf8')
  ]);
  const activeLines = config
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));

  for (const key of ['RESEND_API_KEY', 'SENDFLARE_API_KEY', 'CYBERPERSONS_API_KEY']) {
    assert.ok(activeLines.includes(`${key}=""`), `${key} must default to an empty value`);

    const comment = `# ${key}: 如果未设置则从配置中删除`;
    const blockStart = workflow.indexOf(comment);
    assert.notEqual(blockStart, -1, `${key} deployment block is missing`);
    const blockEnd = workflow.indexOf('\n\n', blockStart);
    const block = workflow.slice(blockStart, blockEnd === -1 ? undefined : blockEnd);

    assert.ok(
      block.includes(key + '="${{ secrets.' + key + ' || vars.' + key + ' }}"'),
      `${key} must be read from GitHub Secrets or Variables`
    );
    assert.ok(block.includes(`if [ -n "$${key}" ]; then`), `${key} must only be injected when set`);
    assert.ok(block.includes(`s|^${key}=.*|${key}=`), `${key} must replace its template value`);
    assert.ok(block.includes(`'/^${key}=/d'`), `${key} must be removed when unset`);
  }
});

test('deployment documentation lists all optional sending keys and the correct D1 name', async () => {
  const [readme, readmeEn, actionDocs] = await Promise.all([
    readFile(new URL('README.md', root), 'utf8'),
    readFile(new URL('README_en.md', root), 'utf8'),
    readFile(new URL('docs/action-deployment.md', root), 'utf8')
  ]);

  assert.doesNotMatch(readme, /maill_free_db/);
  assert.doesNotMatch(readmeEn, /maill_free_db/);
  for (const key of ['RESEND_API_KEY', 'SENDFLARE_API_KEY', 'CYBERPERSONS_API_KEY']) {
    assert.match(actionDocs, new RegExp('`' + key + '`\\s*\\|'));
  }
  assert.match(actionDocs, /未配置的发件 API Key.*wrangler\.toml.*删除/);
});
