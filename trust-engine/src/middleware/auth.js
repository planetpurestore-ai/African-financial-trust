import { config } from '../config.js';
import { one, q } from '../db/pool.js';
import { hashToken, safeEqual } from '../lib/crypto.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { parseCookies } from '../lib/cookies.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const ROLE_RANK = {
  system_admin: 100,
  institution_admin: 80,
  institution_analyst: 60,
  business_admin: 50,
  business_user: 40,
  auditor: 30,
};

export function rank(role) {
  return ROLE_RANK[role] ?? 0;
}

function bearer(req) {
  const header = req.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (match) return match[1].trim();
  const apiKey = req.get('x-api-key');
  return apiKey ? apiKey.trim() : null;
}

async function fromApiKey(token) {
  if (!token.startsWith('aft_')) return null;
  const parts = token.split('_');
  if (parts.length < 3) return null;
  const prefix = parts[1];
  const row = await one(
    `SELECT k.*, o.name AS org_name, o.org_type, o.status AS org_status
       FROM api_keys k JOIN organisations o ON o.id = k.org_id
      WHERE k.prefix = ? LIMIT 1`,
    [prefix],
  );
  if (!row || row.status !== 'active') return null;
  if (row.expires_at && new Date(row.expires_at) < new Date()) return null;
  if (row.org_status !== 'active') return null;
  if (!safeEqual(hashToken(token), row.key_hash)) return null;
  await q('UPDATE api_keys SET last_used_at = NOW(3) WHERE id = ?', [row.id]);
  return {
    type: 'api_key',
    apiKeyId: row.id,
    org: { id: row.org_id, name: row.org_name, orgType: row.org_type },
    role: row.role,
    scopes: row.scopes || [],
    user: null,
  };
}

async function fromSession(req) {
  const cookies = parseCookies(req.get('cookie') || '');
  const token = cookies[config.sessionCookie];
  if (!token) return null;
  const row = await one(
    `SELECT s.id AS session_id, s.expires_at, u.id AS user_id, u.email, u.full_name, u.role, u.status,
            o.id AS org_id, o.name AS org_name, o.org_type, o.status AS org_status
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN organisations o ON o.id = u.org_id
      WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > NOW(3)
      LIMIT 1`,
    [hashToken(token)],
  );
  if (!row || row.status !== 'active' || row.org_status !== 'active') return null;
  return {
    type: 'session',
    sessionId: row.session_id,
    org: { id: row.org_id, name: row.org_name, orgType: row.org_type },
    role: row.role,
    scopes: ['*'],
    user: { id: row.user_id, email: row.email, fullName: row.full_name, role: row.role },
  };
}

export async function authenticate(req, _res, next) {
  try {
    const token = bearer(req);
    let auth = token ? await fromApiKey(token) : null;
    if (!auth) auth = await fromSession(req);
    if (auth) {
      req.auth = auth;
      if (auth.type === 'session' && !SAFE_METHODS.has(req.method)) {
        const cookies = parseCookies(req.get('cookie') || '');
        const header = req.get('x-aft-csrf') || '';
        if (!cookies[config.csrfCookie] || !safeEqual(cookies[config.csrfCookie], header)) {
          throw forbidden('Missing or invalid CSRF token');
        }
        const origin = req.get('origin');
        if (origin && config.publicOrigin && origin !== config.publicOrigin) {
          const host = req.get('host');
          if (!host || !origin.endsWith(`://${host}`)) throw forbidden('Cross-origin request rejected');
        }
      }
    }
    next();
  } catch (error) {
    next(error);
  }
}

export function requireAuth(req, _res, next) {
  if (!req.auth) return next(unauthorized());
  return next();
}

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.auth) return next(unauthorized());
    const role = req.auth.role;
    if (roles.includes(role)) return next();
    if (role === 'system_admin') return next();
    return next(forbidden(`Role ${role} cannot perform this action`));
  };
}

export function requireMinRole(minimum) {
  return (req, _res, next) => {
    if (!req.auth) return next(unauthorized());
    if (rank(req.auth.role) >= rank(minimum)) return next();
    return next(forbidden());
  };
}

export function requireScope(scope) {
  return (req, _res, next) => {
    if (!req.auth) return next(unauthorized());
    if (req.auth.type === 'session') return next();
    if (req.auth.scopes?.includes('*') || req.auth.scopes?.includes(scope)) return next();
    return next(forbidden(`API key lacks scope ${scope}`));
  };
}

export function requireWriteRole(req, _res, next) {
  if (!req.auth) return next(unauthorized());
  if (req.auth.role === 'auditor') return next(forbidden('Auditor accounts are read-only'));
  return next();
}
