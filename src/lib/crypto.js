import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { config } from '../config.js';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function hashToken(token) {
  return sha256Hex(token);
}

export function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, salt, hash] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const derived = scryptSync(password, Buffer.from(salt, 'base64'), Buffer.from(hash, 'base64').length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
    });
    const expected = Buffer.from(hash, 'base64');
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

let cachedKey = null;
function vaultKey() {
  if (cachedKey) return cachedKey;
  if (process.env.APP_ENCRYPTION_KEY) {
    const raw = process.env.APP_ENCRYPTION_KEY;
    if (/^[0-9a-f]{64}$/i.test(raw)) cachedKey = Buffer.from(raw, 'hex');
    else {
      let decoded;
      try { decoded = Buffer.from(raw, 'base64'); } catch { decoded = null; }
      if (decoded?.length === 32) cachedKey = decoded;
      else if (Buffer.byteLength(raw, 'utf8') >= 32) cachedKey = createHash('sha256').update(raw, 'utf8').digest();
      else throw new Error('APP_ENCRYPTION_KEY must be a 32-byte value or at least 32 characters');
    }
  } else {
    const material = process.env.MANUS_JWT_SECRET || 'aft-local-development-key-material';
    cachedKey = Buffer.from(hkdfSync('sha256', material, 'aft-credential-vault', 'v1', 32));
  }
  if (cachedKey.length !== 32) throw new Error('APP_ENCRYPTION_KEY must resolve to 32 bytes');
  return cachedKey;
}

export function encryptSecret(plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', vaultKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptSecret({ ciphertext, iv, authTag }) {
  const decipher = createDecipheriv('aes-256-gcm', vaultKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

function canonicalValue(value) {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => canonicalValue(item === undefined ? null : item));
  if (typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      const item = value[key];
      // JSON.stringify omits undefined/function/symbol properties and turns
      // non-finite numbers into null. Mirroring that behaviour is essential:
      // the hash is recomputed from the JSON document stored in MySQL, so a
      // canonical form that emits `undefined` can never verify after a round
      // trip through the database.
      if (item === undefined || typeof item === 'function' || typeof item === 'symbol') continue;
      out[key] = canonicalValue(item);
    }
    return out;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  if (typeof value === 'bigint') return Number(value);
  return value;
}

/** Deterministic JSON with sorted keys, used for hashes and idempotency checks. */
export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function maskSecret(value) {
  const s = String(value || '');
  if (s.length <= 8) return '********';
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

export { config };
