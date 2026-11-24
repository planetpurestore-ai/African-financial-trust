import { one } from '../../db/pool.js';

const ACTIVE_GRANT = `status = 'active' AND (expires_at IS NULL OR expires_at > NOW(3))`;

function scopesOf(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function allows(scopes, required) {
  if (!required) return true;
  if (scopes.includes('*')) return true;
  const list = Array.isArray(required) ? required : [required];
  return list.some((scope) => scopes.includes(scope));
}

/**
 * Resolve access to a business and, when requiredScopes is supplied, enforce
 * both the principal's API-key scopes and the institution grant's scopes.
 * A missing scope is reported as "not found" so an institution cannot probe
 * which business IDs exist outside its grant.
 */
export async function getBusinessAccess(auth, businessId, requiredScopes = null) {
  if (!auth) return null;
  const business = await one('SELECT * FROM businesses WHERE id = ?', [businessId]);
  if (!business) return null;

  if (auth.role === 'system_admin' || auth.org.orgType === 'platform') {
    if (auth.type === 'api_key' && !allows(scopesOf(auth.scopes), requiredScopes)) return null;
    return { business, mode: 'admin', grant: null };
  }
  if (business.owner_org_id === auth.org.id) {
    if (auth.type === 'api_key' && !allows(scopesOf(auth.scopes), requiredScopes)) return null;
    return { business, mode: 'owner', grant: null };
  }
  if (auth.org.orgType === 'institution') {
    const grant = await one(
      `SELECT * FROM access_grants WHERE business_id = ? AND institution_org_id = ? AND ${ACTIVE_GRANT} LIMIT 1`,
      [businessId, auth.org.id],
    );
    if (!grant) return null;
    if (!allows(scopesOf(grant.scopes), requiredScopes)) return null;
    if (auth.type === 'api_key' && !allows(scopesOf(auth.scopes), requiredScopes)) return null;
    return { business, mode: 'granted', grant };
  }
  return null;
}

export async function requireBusinessAccess(auth, businessId, requiredScopes = null) {
  const access = await getBusinessAccess(auth, businessId, requiredScopes);
  if (!access) {
    const error = new Error('Business not found');
    error.status = 404;
    error.code = 'not_found';
    throw error;
  }
  return access;
}

/** SQL fragment + params restricting a business query to what this principal may see. */
export function businessScopeSql(auth) {
  if (auth.role === 'system_admin' || auth.org.orgType === 'platform') return { sql: '1=1', params: [] };
  if (auth.org.orgType === 'institution') {
    return {
      sql: `EXISTS (SELECT 1 FROM access_grants g WHERE g.business_id = b.id AND g.institution_org_id = ?
              AND g.status = 'active' AND (g.expires_at IS NULL OR g.expires_at > NOW(3)))`,
      params: [auth.org.id],
    };
  }
  return { sql: 'b.owner_org_id = ?', params: [auth.org.id] };
}
