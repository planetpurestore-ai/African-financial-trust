import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Crockford base32 ULID: 48-bit timestamp + 80 bits of randomness. */
export function ulid(now = Date.now()) {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i += 1) {
    time = ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = randomBytes(10);
  let random = '';
  for (let i = 0; i < 16; i += 1) {
    random += ALPHABET[bytes[i % 10] % 32];
  }
  return time + random;
}

export function isUlid(value) {
  return typeof value === 'string' && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}
