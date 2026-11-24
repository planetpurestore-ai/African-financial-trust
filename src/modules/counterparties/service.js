import { z } from 'zod';
import { execute, many, one, withTransaction } from '../../db/pool.js';
import { writeAudit } from '../../lib/audit.js';
import { hashToken, randomToken } from '../../lib/crypto.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { ulid } from '../../lib/ids.js';
import { countryCode } from '../../lib/validate.js';

export const createCounterpartySchema = z.object({
  businessId: z.string().length(26),
  name: z.string().trim().min(2).max(255),
  countryCode: countryCode.optional().nullable(),
  registrationNumber: z.string().trim().max(120).optional().nullable(),
  taxId: z.string().trim().max(120).optional().nullable(),
  email: z.string().email().max(255).optional().nullable(),
  relationship: z.enum(['customer', 'supplier', 'both']),
});

export async function createCounterparty(auth, input) {
  const id = ulid();
  await execute(
    `INSERT INTO counterparties (id, business_id, name, country_code, registration_number, tax_id, email, relationship, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unconfirmed')`,
    [id, input.businessId, input.name, input.countryCode ?? null, input.registrationNumber ?? null, input.taxId ?? null, input.email ?? null, input.relationship],
  );
  return one('SELECT * FROM counterparties WHERE id = ?', [id]);
}

export async function listCounterparties(businessId) {
  return many(
    `SELECT c.*,
            (SELECT COUNT(*) FROM invoices i WHERE i.counterparty_id = c.id) AS invoice_count,
            (SELECT COALESCE(SUM(i.total_amount),0) FROM invoices i WHERE i.counterparty_id = c.id) AS invoice_value
       FROM counterparties c WHERE c.business_id = ? ORDER BY c.name`,
    [businessId],
  );
}

export async function getCounterparty(id) {
  const cp = await one('SELECT * FROM counterparties WHERE id = ?', [id]);
  if (!cp) throw notFound('Counterparty not found');
  const invoices = await many(
    'SELECT id, invoice_number, issue_date, currency_code, total_amount, balance_due, verification_status FROM invoices WHERE counterparty_id = ? ORDER BY issue_date DESC LIMIT 50',
    [id],
  );
  return { ...cp, invoices };
}

export async function requestConfirmation(auth, counterpartyId, { invoiceId, baseUrl }, ctx = {}) {
  return withTransaction(async (conn) => {
    const [rows] = await conn.query('SELECT * FROM counterparties WHERE id = ? FOR UPDATE', [counterpartyId]);
    const cp = rows[0];
    if (!cp) throw notFound('Counterparty not found');
    const [invoiceRows] = await conn.query('SELECT * FROM invoices WHERE id = ? AND counterparty_id = ?', [invoiceId, counterpartyId]);
    const invoice = invoiceRows[0];
    if (!invoice) throw badRequest('Invoice does not belong to this counterparty');

    const token = randomToken(32);
    const expires = new Date(Date.now() + 14 * 86_400_000);
    await conn.query(
      `UPDATE counterparties SET status = 'confirmation_sent', confirmation_token_hash = ?, confirmation_sent_at = NOW(3),
        confirmation_expires_at = ? WHERE id = ?`,
      [hashToken(token), expires, counterpartyId],
    );
    await conn.query(
      `INSERT INTO verification_events (id, business_id, entity_type, entity_id, event_type, outcome, explanation, actor_type, actor_id)
       VALUES (?, ?, 'counterparty', ?, 'confirmation_requested', 'pending', ?, ?, ?)`,
      [ulid(), cp.business_id, counterpartyId, `Confirmation requested for invoice ${invoice.invoice_number}`, auth.type, auth.user?.id ?? null],
    );
    await writeAudit(conn, {
      orgId: auth.org.id,
      actorType: auth.type,
      actorId: auth.user?.id ?? auth.apiKeyId,
      action: 'counterparty.confirmation_requested',
      entityType: 'counterparty',
      entityId: counterpartyId,
      metadata: { invoice_id: invoiceId, expires_at: expires.toISOString() },
      ip: ctx.ip,
    });
    return {
      token,
      expiresAt: expires.toISOString(),
      confirmationUrl: `${baseUrl}/confirm/${token}`,
      delivery: 'manual',
      note: 'No transactional email provider is configured. Send this single-use link to the counterparty through your normal channel; it expires in 14 days and exposes only the invoice summary below.',
      invoice: { invoice_number: invoice.invoice_number, issue_date: invoice.issue_date, total_amount: invoice.total_amount, currency_code: invoice.currency_code },
    };
  });
}

export async function confirmationPreview(token) {
  const row = await one(
    `SELECT c.id, c.name, c.status, c.confirmation_expires_at, b.legal_name AS issuer_name, b.country_code,
            i.invoice_number, i.issue_date, i.currency_code, i.total_amount
       FROM counterparties c
       JOIN businesses b ON b.id = c.business_id
       LEFT JOIN invoices i ON i.counterparty_id = c.id
      WHERE c.confirmation_token_hash = ? AND c.confirmation_expires_at > NOW(3)
      ORDER BY i.issue_date DESC LIMIT 1`,
    [hashToken(token)],
  );
  if (!row) throw notFound('This confirmation link is invalid or has expired');
  return row;
}

export async function respondToConfirmation(token, input, ctx = {}) {
  return withTransaction(async (conn) => {
    const [rows] = await conn.query(
      `SELECT * FROM counterparties WHERE confirmation_token_hash = ? AND confirmation_expires_at > NOW(3) FOR UPDATE`,
      [hashToken(token)],
    );
    const cp = rows[0];
    if (!cp) throw notFound('This confirmation link is invalid or has expired');
    if (cp.status === 'confirmed') throw badRequest('This relationship has already been confirmed');

    const status = input.decision === 'confirm' ? 'confirmed' : 'declined';
    const conflictNote =
      input.decision === 'confirm' && input.name && cp.name && !cp.name.toLowerCase().includes(input.name.toLowerCase().split(' ')[0])
        ? `Confirmer name "${input.name}" differs from recorded counterparty "${cp.name}"`
        : null;

    await conn.query(
      `UPDATE counterparties SET status = ?, confirmed_at = IF(? = 'confirmed', NOW(3), NULL), confirmed_by_email = ?,
        conflict_note = ?, confirmation_token_hash = NULL WHERE id = ?`,
      [conflictNote ? 'conflict' : status, status, input.email ?? null, conflictNote, cp.id],
    );
    await conn.query(
      `INSERT INTO verification_events (id, business_id, entity_type, entity_id, event_type, outcome, explanation, actor_type)
       VALUES (?, ?, 'counterparty', ?, 'confirmation_response', ?, ?, 'counterparty')`,
      [ulid(), cp.business_id, cp.id, conflictNote ? 'conflict' : status, input.note ?? conflictNote ?? `Counterparty ${input.decision}ed the relationship`],
    );
    const [businessRows] = await conn.query('SELECT owner_org_id FROM businesses WHERE id = ?', [cp.business_id]);
    await writeAudit(conn, {
      orgId: businessRows[0].owner_org_id,
      actorType: 'counterparty',
      actorId: null,
      actorLabel: input.email || input.name || 'counterparty',
      action: `counterparty.confirmation_${status}`,
      entityType: 'counterparty',
      entityId: cp.id,
      metadata: { decision: input.decision, conflict: Boolean(conflictNote) },
      ip: ctx.ip,
    });
    return { status: conflictNote ? 'conflict' : status, conflict: conflictNote };
  });
}

export async function counterpartyStats(businessId) {
  const rows = await many('SELECT status, COUNT(*) AS count FROM counterparties WHERE business_id = ? GROUP BY status', [businessId]);
  return rows.reduce((acc, r) => ({ ...acc, [r.status]: Number(r.count) }), {});
}
