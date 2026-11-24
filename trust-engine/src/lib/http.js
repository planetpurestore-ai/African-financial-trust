import { ulid } from './ids.js';

export function requestId(req, res, next) {
  req.id = req.get('x-request-id') || ulid();
  res.setHeader('x-request-id', req.id);
  next();
}

export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function pagination(req, { defaultLimit = 25, maxLimit = 100 } = {}) {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit ?? String(defaultLimit), 10) || defaultLimit, 1), maxLimit);
  const offset = Math.max(Number.parseInt(req.query.offset ?? '0', 10) || 0, 0);
  return { limit, offset, page: Math.floor(offset / limit) + 1 };
}

export function listBody(rows, total, { limit, offset }) {
  return { data: rows, meta: { total, limit, offset, returned: rows.length } };
}

export function ok(res, data, status = 200) {
  return res.status(status).json(data);
}
