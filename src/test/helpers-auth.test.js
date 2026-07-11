import assert from 'node:assert/strict';
import test from 'node:test';

import { getJwtPayload, isStrictAdmin } from '../api/helpers.js';

function unsignedAdminRequest() {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    role: 'admin',
    username: 'admin'
  })}.invalid-signature`;
  return new Request('https://example.test/api/mailboxes', {
    headers: { Cookie: `iding-session=${token}` }
  });
}

test('an explicit failed auth result never falls back to an unsigned cookie payload', () => {
  const request = unsignedAdminRequest();

  for (const authPayload of [false, null, undefined]) {
    const options = { authPayload, adminName: 'admin' };
    assert.equal(getJwtPayload(request, options), null);
    assert.equal(isStrictAdmin(request, options), false);
  }
});

