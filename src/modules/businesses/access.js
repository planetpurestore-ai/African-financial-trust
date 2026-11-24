import { one } from '../../db/pool.js';

const ACTIVE_GRANT = `status = 'active' AND (expires_at IS NULL OR expires_at > NOW(3))`;

export async function getBusinessAccess(auth, businessId) {
  if (!auth) return null;
  const business = await one('SELECT * FROM businesses WHERE id = ?', [businessId]);
  if (!business) return null;

  if (auth.role === 'system_admin' || auth.org.orgType === 'platform') {
    return { business, mode: 'admin', grant: null };
  }
  if (business.owner_org_id === auth.org.id) {
    return { business, mode: 'owner', grant: null };
  }
  if (auth.org.orgType === 'institution') {
    const grant = await one(
      `SELECT * FROM access_grants WHERE business_id = ? AND institution_org_id = ? AND ${ACTIVE_GRANT} LIMIT 1`,
      [businessId, auth.org.id],
    );
    if (grant) return { business, mode: 'granted', grant };
  }
  return null;
}

export async function requireBusinessAccess(auth, businessId) {
  const access = await getBusinessAccess(auth, businessId);
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
