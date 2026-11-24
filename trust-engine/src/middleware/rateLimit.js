import { config } from '../config.js';
import { tooMany } from '../lib/errors.js';

const buckets = new Map();

function hit(key, windowMs) {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.reset <= now) {
    bucket = { count: 0, reset: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  return { count: bucket.count, reset: bucket.reset };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) if (bucket.reset <= now) buckets.delete(key);
}, 60_000).unref();

export function rateLimit({ windowMs = config.rateLimit.windowMs, max = config.rateLimit.max, keyFn } = {}) {
  return (req, res, next) => {
    const key = keyFn ? keyFn(req) : req.auth?.apiKeyId || req.auth?.user?.id || req.ip;
    const { count, reset } = hit(`${key}`, windowMs);
    res.setHeader('x-ratelimit-limit', String(max));
    res.setHeader('x-ratelimit-remaining', String(Math.max(max - count, 0)));
    res.setHeader('x-ratelimit-reset', String(Math.ceil(reset / 1000)));
    if (count > max) return next(tooMany());
    return next();
  };
}

export function loginRateLimit(req, _res, next) {
  const key = `login:${req.ip}:${String(req.body?.email || '').toLowerCase()}`;
  const { count } = hit(key, 15 * 60_000);
  if (count > config.rateLimit.loginMax) return next(tooMany('Too many sign-in attempts; try again later'));
  return next();
}

export function resetRateLimits() {
  buckets.clear();
}
