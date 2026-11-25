import { z } from 'zod';
import { many, one, withTransaction } from '../../db/pool.js';
import { writeAudit } from '../../lib/audit.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { ulid } from '../../lib/ids.js';
import { countryCode, email, isoDate } from '../../lib/validate.js';
import { businessScopeSql } from './access.js';

const TRACKED_FIELDS = [
  'legal_name',
  'trading_name',
  'country_code',
  'registration_number',
  'tax_id',
  'legal_form',
  'incorporation_date',
  'industry',
  'address_line1',
  'address_line2',
  'city',
  'region',
  'postal_code',
  'phone',
  'email',
  'website',
];

export const createBusinessSchema = z.object({
  legalName: z.string().trim().min(2).max(255),
  tradingName: z.string().trim().max(255).optional().nullable(),
  countryCode,
  registrationNumber: z.string().trim().max(120).optional().nullable(),
  taxId: z.string().trim().max(120).optional().nullable(),
  legalForm: z.string().trim().max(80).optional().nullable(),
  incorporationDate: isoDate.optional().nullable(),
  industry: z.string().trim().max(120).optional().nullable(),
  addressLine1: z.string().trim().max(255).optional().nullable(),
  addressLine2: z.string().trim().max(255).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  region: z.string().trim().max(120).optional().nullable(),
  postalCode: z.string().trim().max(32).optional().nullable(),
  phone: z.string().trim().max(64).optional().nullable(),
  email: email.optional().nullable(),
  website: z.string().trim().max(255).optional().nullable(),
  representatives: z
    .array(
      z.object({
        fullName: z.string().trim().min(2).max(255),
        roleTitle: z.string().trim().max(120).optional().nullable(),
        email: email.optional().nullable(),
        phone: z.string().trim().max(64).optional().nullable(),
        authorised: z.boolean().optional(),
      }),
    )
    .max(20)
    .optional(),
});

export const updateBusinessSchema = createBusinessSchema.partial().omit({ representatives: true });

export async function getCountryProfile(code) {
  return one('SELECT * FROM country_profiles WHERE country_code = ? AND active = 1', [code]);
}

export async function listCountryProfiles() {
  return many(`SELECT country_code, name, currency_code, registration_label, registration_pattern,
                      tax_label, tax_pattern, date_format, number_format, mobile_money_providers,
                      registry_source, registry_api_available, verification_notes
                 FROM country_profiles WHERE active = 1
                ORDER BY CASE WHEN country_code = 'RW' THEN 0 ELSE 1 END, name`);
}

export async function createBusiness(auth, input, ctx = {}) {
  const profile = await getCountryProfile(input.countryCode);
  if (!profile) throw badRequest(`Country ${input.countryCode} is not supported yet`, { field: 'countryCode' });
  if (input.registrationNumber && profile.registration_pattern && !new RegExp(profile.registration_pattern).test(input.registrationNumber)) {
    throw badRequest(`${profile.registration_label} does not match the expected format`, { field: 'registrationNumber', country: input.countryCode });
  }
  if (input.taxId && profile.tax_pattern && !new RegExp(profile.tax_pattern).test(input.taxId)) {
    throw badRequest(`${profile.tax_label} does not match the expected format`, { field: 'taxId', country: input.countryCode });
  }

  return withTransaction(async (conn) => {
    const id = ulid();
    await conn.query(
      `INSERT INTO businesses
        (id, owner_org_id, legal_name, trading_name, country_code, registration_number, tax_id, legal_form,
         incorporation_date, industry, address_line1, address_line2, city, region, postal_code, phone, email, website,
         verification_status, verification_level, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'self_declared', 1, ?)`,
      [
        id,
        auth.org.id,
        input.legalName,
        input.tradingName ?? null,
        input.countryCode,
        input.registrationNumber ?? null,
        input.taxId ?? null,
        input.legalForm ?? null,
        input.incorporationDate ?? null,
        input.industry ?? null,
        input.addressLine1 ?? null,
        input.addressLine2 ?? null,
        input.city ?? null,
        input.region ?? null,
        input.postalCode ?? null,
        input.phone ?? null,
        input.email ?? null,
        input.website ?? null,
        auth.user?.id ?? null,
      ],
    );

    if (input.registrationNumber) {
      await conn.query(
        `INSERT INTO business_identifiers (id, business_id, identifier_type, value, issuing_authority, country_code, status)
         VALUES (?, ?, 'registration_number', ?, ?, ?, 'self_declared')
         ON DUPLICATE KEY UPDATE business_id = VALUES(business_id)`,
        [ulid(), id, input.registrationNumber, profile.registration_label, input.countryCode],
      );
    }
    if (input.taxId) {
      await conn.query(
        `INSERT INTO business_identifiers (id, business_id, identifier_type, value, issuing_authority, country_code, status)
         VALUES (?, ?, 'tax_id', ?, ?, ?, 'self_declared')
         ON DUPLICATE KEY UPDATE business_id = VALUES(business_id)`,
        [ulid(), id, input.taxId, profile.tax_label, input.countryCode],
      );
    }
    for (const rep of input.representatives || []) {
      await conn.query(
        `INSERT INTO business_representatives (id, business_id, full_name, role_title, email, phone, authorised)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [ulid(), id, rep.fullName, rep.roleTitle ?? null, rep.email ?? null, rep.phone ?? null, rep.authorised ? 1 : 0],
      );
    }
    await writeAudit(conn, {
      orgId: auth.org.id,
      actorType: auth.type,
      actorId: auth.user?.id ?? auth.apiKeyId,
      actorLabel: auth.user?.email ?? 'api-key',
      action: 'business.created',
      entityType: 'business',
      entityId: id,
      metadata: { legal_name: input.legalName, country_code: input.countryCode },
      ip: ctx.ip,
    });
    return getBusinessDetail(auth, id, conn);
  });
}

export async function listBusinesses(auth, query) {
  const scope = businessScopeSql(auth);
  const clauses = [scope.sql];
  const params = [...scope.params];
  if (query.search) {
    clauses.push('(b.legal_name LIKE ? OR b.trading_name LIKE ? OR b.registration_number LIKE ?)');
    const like = `%${query.search}%`;
    params.push(like, like, like);
  }
  if (query.status) {
    clauses.push('b.verification_status = ?');
    params.push(query.status);
  }
  if (query.country) {
    clauses.push('b.country_code = ?');
    params.push(query.country);
  }
  const where = clauses.join(' AND ');
  const [{ total }] = await many(`SELECT COUNT(*) AS total FROM businesses b WHERE ${where}`, params);
  const rows = await many(
    `SELECT b.*, o.name AS owner_org_name,
            (SELECT COUNT(*) FROM documents d WHERE d.business_id = b.id) AS document_count,
            (SELECT COUNT(*) FROM invoices i WHERE i.business_id = b.id) AS invoice_count,
            (SELECT COUNT(*) FROM counterparties c WHERE c.business_id = b.id) AS counterparty_count,
            (SELECT tr.evidence_score FROM trust_records tr WHERE tr.business_id = b.id ORDER BY tr.version DESC LIMIT 1) AS latest_score,
            (SELECT tr.evidence_grade FROM trust_records tr WHERE tr.business_id = b.id ORDER BY tr.version DESC LIMIT 1) AS latest_grade
       FROM businesses b JOIN organisations o ON o.id = b.owner_org_id
      WHERE ${where} ORDER BY b.created_at DESC LIMIT ? OFFSET ?`,
    [...params, query.limit, query.offset],
  );
  return { rows, total: Number(total) };
}

export async function getBusinessDetail(auth, id, conn = null) {
  const db = conn
    ? {
        query: async (sql, params) => {
          const [rows] = await conn.query(sql, params);
          return rows;
        },
      }
    : null;
  const fetchOne = async (sql, params) => {
    if (db) {
      const rows = await db.query(sql, params);
      return rows[0] ?? null;
    }
    return one(sql, params);
  };
  const fetchMany = async (sql, params) => {
    if (db) return db.query(sql, params);
    return many(sql, params);
  };

  const business = await fetchOne(
    `SELECT b.*, o.name AS owner_org_name FROM businesses b JOIN organisations o ON o.id = b.owner_org_id WHERE b.id = ?`,
    [id],
  );
  if (!business) throw notFound('Business not found');

  const [identifiers, representatives, stats] = await Promise.all([
    fetchMany('SELECT * FROM business_identifiers WHERE business_id = ? ORDER BY created_at', [id]),
    fetchMany('SELECT * FROM business_representatives WHERE business_id = ? ORDER BY created_at', [id]),
    fetchOne(
      `SELECT
        (SELECT COUNT(*) FROM documents WHERE business_id = ?) AS documents,
        (SELECT COUNT(*) FROM invoices WHERE business_id = ?) AS invoices,
        (SELECT COALESCE(SUM(balance_due),0) FROM invoices WHERE business_id = ? AND status IN ('issued','partially_paid','overdue')) AS outstanding_receivables,
        (SELECT COUNT(*) FROM counterparties WHERE business_id = ?) AS counterparties,
        (SELECT COUNT(*) FROM transactions WHERE business_id = ?) AS transactions,
        (SELECT COUNT(*) FROM reconciliation_matches m JOIN reconciliations r ON r.id = m.reconciliation_id WHERE r.business_id = ? AND m.status = 'suggested') AS pending_matches,
        (SELECT COUNT(*) FROM invoices WHERE business_id = ? AND verification_status = 'inconsistent') AS inconsistent_invoices,
        (SELECT MAX(generated_at) FROM trust_records WHERE business_id = ?) AS trust_record_generated_at,
        (SELECT evidence_score FROM trust_records WHERE business_id = ? ORDER BY version DESC LIMIT 1) AS evidence_score,
        (SELECT evidence_grade FROM trust_records WHERE business_id = ? ORDER BY version DESC LIMIT 1) AS evidence_grade,
        (SELECT version FROM trust_records WHERE business_id = ? ORDER BY version DESC LIMIT 1) AS trust_record_version`,
      [id, id, id, id, id, id, id, id, id, id, id],
    ),
  ]);

  return { ...business, identifiers, representatives, stats };
}

export async function updateBusiness(auth, id, input, ctx = {}) {
  return withTransaction(async (conn) => {
    const [rows] = await conn.query('SELECT * FROM businesses WHERE id = ? FOR UPDATE', [id]);
    const business = rows[0];
    if (!business) throw notFound('Business not found');

    const changes = [];
    for (const field of TRACKED_FIELDS) {
      const camel = field.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      if (input[camel] === undefined) continue;
      const next = input[camel] === '' ? null : input[camel];
      const prev = business[field] instanceof Date ? business[field].toISOString().slice(0, 10) : business[field];
      if (String(prev ?? '') === String(next ?? '')) continue;
      changes.push({ field, prev, next });
    }
    if (!changes.length) return getBusinessDetail(auth, id, conn);

    const sets = changes.map((c) => `${c.field} = ?`).join(', ');
    await conn.query(`UPDATE businesses SET ${sets}, verification_status = IF(verification_status = 'verified', 'partially_verified', verification_status) WHERE id = ?`, [
      ...changes.map((c) => c.next),
      id,
    ]);
    for (const change of changes) {
      await conn.query(
        'INSERT INTO business_history (id, business_id, field_name, old_value, new_value, reason, changed_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [ulid(), id, change.field, change.prev === null ? null : String(change.prev), change.next === null ? null : String(change.next), input.reason ?? null, auth.user?.id ?? null],
      );
    }
    await writeAudit(conn, {
      orgId: auth.org.id,
      actorType: auth.type,
      actorId: auth.user?.id ?? auth.apiKeyId,
      action: 'business.updated',
      entityType: 'business',
      entityId: id,
      metadata: { fields: changes.map((c) => c.field), reason: input.reason ?? null },
      ip: ctx.ip,
    });
    return getBusinessDetail(auth, id, conn);
  });
}

export async function listHistory(auth, id) {
  return many('SELECT * FROM business_history WHERE business_id = ? ORDER BY changed_at DESC LIMIT 200', [id]);
}

export async function recordVerification(auth, id, input, ctx = {}) {
  return withTransaction(async (conn) => {
    const [rows] = await conn.query('SELECT * FROM businesses WHERE id = ? FOR UPDATE', [id]);
    const business = rows[0];
    if (!business) throw notFound('Business not found');
    const status = input.outcome;
    const level = { unverified: 0, self_declared: 1, documents_submitted: 1, partially_verified: 2, verified: 3, rejected: 0 }[status];
    await conn.query(
      `UPDATE businesses SET verification_status = ?, verification_level = ?, verified_at = NOW(3),
        verified_by_user_id = ?, verification_method = ?, verification_reference = ? WHERE id = ?`,
      [status, level, auth.user?.id ?? null, input.method, input.reference ?? null, id],
    );
    await conn.query(
      'INSERT INTO business_history (id, business_id, field_name, old_value, new_value, reason, changed_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [ulid(), id, 'verification_status', business.verification_status, status, input.note ?? null, auth.user?.id ?? null],
    );
    await conn.query(
      `INSERT INTO verification_events (id, business_id, entity_type, entity_id, event_type, outcome, explanation, actor_type, actor_id)
       VALUES (?, ?, 'business', ?, 'identity_verification', ?, ?, ?, ?)`,
      [ulid(), id, id, status, input.note ?? null, auth.type, auth.user?.id ?? null],
    );
    await writeAudit(conn, {
      orgId: auth.org.id,
      actorType: auth.type,
      actorId: auth.user?.id ?? auth.apiKeyId,
      action: 'business.verification_recorded',
      entityType: 'business',
      entityId: id,
      metadata: { status, method: input.method, reference: input.reference ?? null },
      ip: ctx.ip,
    });
    return getBusinessDetail(auth, id, conn);
  });
}

export async function grantInstitutionAccess(auth, businessId, input, ctx = {}) {
  return withTransaction(async (conn) => {
    const id = ulid();
    await conn.query(
      `INSERT INTO access_grants (id, business_id, institution_org_id, scopes, status, granted_by_user_id, purpose, expires_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`,
      [id, businessId, input.institutionOrgId, JSON.stringify(input.scopes), auth.user?.id ?? null, input.purpose ?? null, input.expiresAt ?? null],
    );
    await writeAudit(conn, {
      orgId: auth.org.id,
      actorType: auth.type,
      actorId: auth.user?.id ?? auth.apiKeyId,
      action: 'access_grant.created',
      entityType: 'business',
      entityId: businessId,
      metadata: { institution_org_id: input.institutionOrgId, scopes: input.scopes },
      ip: ctx.ip,
    });
    return one('SELECT * FROM access_grants WHERE id = ?', [id]);
  });
}

export async function listAccessGrants(businessId) {
  return many(
    `SELECT g.*, o.name AS institution_name FROM access_grants g
       JOIN organisations o ON o.id = g.institution_org_id
      WHERE g.business_id = ? ORDER BY g.created_at DESC`,
    [businessId],
  );
}

export async function revokeAccessGrant(auth, grantId, ctx = {}) {
  return withTransaction(async (conn) => {
    const [rows] = await conn.query('SELECT * FROM access_grants WHERE id = ? FOR UPDATE', [grantId]);
    const grant = rows[0];
    if (!grant) throw notFound('Access grant not found');
    await conn.query("UPDATE access_grants SET status = 'revoked', revoked_at = NOW(3) WHERE id = ?", [grantId]);
    await writeAudit(conn, {
      orgId: auth.org.id,
      actorType: auth.type,
      actorId: auth.user?.id ?? auth.apiKeyId,
      action: 'access_grant.revoked',
      entityType: 'business',
      entityId: grant.business_id,
      metadata: { grant_id: grantId },
      ip: ctx.ip,
    });
    return { id: grantId, status: 'revoked' };
  });
}
