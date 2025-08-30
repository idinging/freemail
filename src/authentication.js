export const COOKIE_NAME = 'mailfree-session';

export async function createJwt(secret, extraPayload = {}) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = { exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60, ...extraPayload };
  const encoder = new TextEncoder();
  const data = base64UrlEncode(JSON.stringify(header)) + '.' + base64UrlEncode(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return data + '.' + base64UrlEncode(new Uint8Array(signature));
}

export async function verifyJwt(secret, cookieHeader) {
  if (!cookieHeader) return false;
  const cookie = cookieHeader.split(';').find(c => c.trim().startsWith(`${COOKIE_NAME}=`));
  if (!cookie) return false;
  const token = cookie.split('=')[1];
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const valid = await crypto.subtle.verify('HMAC', key, base64UrlDecode(parts[2]), encoder.encode(parts[0] + '.' + parts[1]));
    if (!valid) return false;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1])));
    if (payload.exp <= Math.floor(Date.now() / 1000)) return false;
    return payload; // 返回 payload（包含 role 等）
  } catch (_) {
    return false;
  }
}

export function buildSessionCookie(token, reqUrl = '') {
  try{
    const u = new URL(reqUrl || 'http://localhost/');
    const isHttps = (u.protocol === 'https:');
    const secureFlag = isHttps ? ' Secure;' : '';
    return `${COOKIE_NAME}=${token}; HttpOnly;${secureFlag} Path=/; SameSite=Strict; Max-Age=86400`;
  }catch(_){
    return `${COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=86400`;
  }
}

function base64UrlEncode(data) {
  const s = typeof data === 'string' ? data : String.fromCharCode(...(data instanceof Uint8Array ? data : new Uint8Array()));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+/g, '');
}

function base64UrlDecode(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

