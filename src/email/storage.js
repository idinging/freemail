const STORAGE_KV = 'kv';
const STORAGE_R2 = 'r2';

function normalizeStorageType(storageType) {
  const value = String(storageType || '').trim().toLowerCase();
  if (value === STORAGE_KV || value.includes('kv')) return STORAGE_KV;
  if (value === STORAGE_R2 || value === 'mail-eml' || value.includes('r2')) return STORAGE_R2;
  return '';
}

function toArrayBuffer(value) {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  if (typeof value === 'string') return new TextEncoder().encode(value).buffer;
  return null;
}

async function readKv(kv, key) {
  const value = await kv.get(key, { type: 'arrayBuffer' });
  return toArrayBuffer(value);
}

async function readR2(r2, key) {
  const object = await r2.get(key);
  if (!object) return null;
  if (typeof object.arrayBuffer === 'function') return toArrayBuffer(await object.arrayBuffer());
  if (object.body) return toArrayBuffer(await new Response(object.body).arrayBuffer());
  return toArrayBuffer(object);
}

export function createEmailStorage({ kv = null, r2 = null } = {}) {
  const bindings = {
    [STORAGE_KV]: kv,
    [STORAGE_R2]: r2
  };

  function orderedTypes(storageType = '') {
    const preferred = normalizeStorageType(storageType);
    if (preferred === STORAGE_R2) return [STORAGE_R2, STORAGE_KV];
    return [STORAGE_KV, STORAGE_R2];
  }

  return {
    get available() {
      return !!(kv || r2);
    },

    async put(key, value) {
      if (!key || value == null) return null;

      for (const storageType of orderedTypes()) {
        const binding = bindings[storageType];
        if (!binding) continue;
        try {
          if (storageType === STORAGE_KV) {
            await binding.put(key, value, { metadata: { contentType: 'message/rfc822' } });
          } else {
            await binding.put(key, value, { httpMetadata: { contentType: 'message/rfc822' } });
          }
          return { key, storageType };
        } catch (error) {
          console.error(`${storageType.toUpperCase()} put failed:`, error);
        }
      }
      return null;
    },

    async get(key, storageType = '') {
      if (!key) return null;

      for (const type of orderedTypes(storageType)) {
        const binding = bindings[type];
        if (!binding) continue;
        try {
          const value = type === STORAGE_KV
            ? await readKv(binding, key)
            : await readR2(binding, key);
          if (value) return value;
        } catch (error) {
          console.error(`${type.toUpperCase()} get failed:`, error);
        }
      }
      return null;
    },

    async delete(key, storageType = '') {
      if (!key) return false;
      const preferred = normalizeStorageType(storageType);
      let deleted = false;
      let preferredDeleted = preferred && !bindings[preferred] ? false : null;

      for (const type of orderedTypes(storageType)) {
        const binding = bindings[type];
        if (!binding) continue;
        try {
          await binding.delete(key);
          deleted = true;
          if (type === preferred) preferredDeleted = true;
        } catch (error) {
          if (type === preferred) preferredDeleted = false;
          console.error(`${type.toUpperCase()} delete failed:`, error);
        }
      }
      return preferredDeleted ?? deleted;
    }
  };
}

export function createEmailStorageFromEnv(env = {}) {
  return createEmailStorage({
    kv: env.MAIL_EML_KV || env.MAIL_KV || null,
    r2: env.MAIL_EML || null
  });
}
