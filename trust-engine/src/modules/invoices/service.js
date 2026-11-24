import { z } from 'zod';
import { many, manyOn, one, oneOn, q, withTransaction } from '../../db/pool.js';
import { writeAudit } from '../../lib/audit.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { ulid } from '../../lib/ids.js';
import { currency, isoDate } from '../../lib/validate.js';
import { verifyInvoice } from './rules.js';

const lineSchema = z.object({
  description: z.string().trim().max(500).optional().nullable(),
  quantity: z.coerce.number().min(0).max(1_000_000).optional().nullable(),
  unitPrice: z.coerce.number().min(-1_000_000_000).max(1_000_000_000).optional().nullable(),
  lineTotal: z.coerce.number().min(-1_000_000_000).max(1_000_000_000),
  taxRate: z.coerce.number().min(0).max(100).optional().nullable(),
});

export const createInvoiceSchema = z.object({
  businessId: z.string().length(26),
  counterpartyId: z.string().length(26).optional().nullable(),
  invoiceNumber: z.string().trim().min(1).max(120),
  issueDate: isoDate,
  dueDate: isoDate.optional().nullable(),
  currency: currency,
  subtotal: z.coerce.number().min(-1_000_000_000_000).max(1_000_000_000_000).optional(),
  taxAmount: z.coerce.number().min(0).max(1_000_000_000_000).optional(),
  totalAmount: z.coerce.number().min(0.01).max(1_000_000_000_000),
  poNumber: z.string().trim().max(120).optional().nullable(),
  description: z.string().trim().max(500).optional().nullable(),
  documentId: z.string().length(26).optional().nullable(),
  lines: z.array(lineSchema).max(500).optional(),
});

function money(n) {
  return Math.round(Number(n || 0) * 10000) / 10000;
}

export async function createInvoice(auth, input, ctx = {}) {
  return withTransaction(async (conn) => {
    const id = ulid();
    const subtotal = input.subtotal ?? money((input.lines || []).reduce((s, l) => s + Number(l.lineTotal || 0), 0));
    const tax = input.taxAmount ?? 0;
    const total = input.totalAmount;
    await conn.query(
      `INSERT INTO invoices (id, business_id, counterparty_id, invoice_number, issue_date, due_date, currency_code,
        subtotal, tax_amount, total_amount, amount_paid, balance_due, po_number, description, source, document_id,
        status, verification_status, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'manual', ?, 'issued', 'pending_verification', ?)`,
      [
        id,
        input.businessId,
        input.counterpartyId ?? null,
        input.invoiceNumber,
        input.issueDate,
        input.dueDate ?? null,
        input.currency,
        subtotal,
        tax,
        total,
        total,
        input.poNumber ?? null,
        input.description ?? null,
        input.documentId ?? null,
        auth.user?.id ?? null,
      ],
    );
    for (const [index, line] of (input.lines || []).entries()) {
      await conn.query(
        `INSERT INTO invoice_lines (id, invoice_id, line_no, description, quantity, unit_price, line_total, tax_rate)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [ulid(), id, index + 1, line.description ?? null, line.quantity ?? null, line.unitPrice ?? null, line.lineTotal, line.taxRate ?? null],
      );
    }
    await conn.query(
      'INSERT INTO invoice_status_history (id, invoice_id, from_status, to_status, reason, actor_id) VALUES (?, ?, NULL, ?, ?, ?)',
      [ulid(), id, 'issued', 'Invoice created', auth.user?.id ?? null],
    );
    await writeAudit(conn, {
      orgId: auth.org.id,
      actorType: auth.type,
      actorId: auth.user?.id ?? auth.apiKeyId,
      action: 'invoice.created',
      entityType: 'invoice',
      entityId: id,
      metadata: { business_id: input.businessId, invoice_number: input.invoiceNumber, total },
      ip: ctx.ip,
    });
    return getInvoice(id, conn);
  });
}

export async function listInvoices({ businessId, status, verificationStatus, limit, offset }) {
  const clauses = ['i.business_id = ?'];
  const params = [businessId];
  if (status) {
    clauses.push('i.status = ?');
    params.push(status);
  }
  if (verificationStatus) {
    clauses.push('i.verification_status = ?');
    params.push(verificationStatus);
  }
  const where = clauses.join(' AND ');
  const [{ total }] = await many(`SELECT COUNT(*) AS total FROM invoices i WHERE ${where}`, params);
  const rows = await many(
    `SELECT i.*, c.name AS counterparty_name,
            (SELECT COUNT(*) FROM documents d WHERE d.id = i.document_id) AS has_document
       FROM invoices i LEFT JOIN counterparties c ON c.id = i.counterparty_id
      WHERE ${where} ORDER BY i.issue_date DESC, i.created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return { rows, total: Number(total) };
}

export async function getInvoice(id, conn = null) {
  const read = conn ? (sql, params) => oneOn(conn, sql, params) : (sql, params) => one(sql, params);
  const readMany = conn ? (sql, params) => manyOn(conn, sql, params) : (sql, params) => many(sql, params);
  const invoice = await read(
    `SELECT i.*, c.name AS counterparty_name, b.legal_name AS business_name
       FROM invoices i JOIN businesses b ON b.id = i.business_id
       LEFT JOIN counterparties c ON c.id = i.counterparty_id WHERE i.id = ?`,
    [id],
  );
  if (!invoice) throw notFound('Invoice not found');
  const [lines, history, payments, verification] = await Promise.all([
    readMany('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY line_no', [id]),
    readMany('SELECT * FROM invoice_status_history WHERE invoice_id = ? ORDER BY created_at DESC', [id]),
    readMany('SELECT * FROM payment_records WHERE invoice_id = ? ORDER BY paid_at', [id]),
    read('SELECT * FROM verification_events WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC LIMIT 1', ['invoice', id]),
  ]);
  return {
    ...invoice,
    lines,
    history,
    payments,
    verification: verification ? { ...verification, rules: parseJson(verification.rules_json) } : null,
  };
}

function parseJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function updateInvoice(auth, id, input, ctx = {}) {
  return withTransaction(async (conn) => {
    const [rows] = await conn.query('SELECT * FROM invoices WHERE id = ? FOR UPDATE', [id]);
    const invoice = rows[0];
    if (!invoice) throw notFound('Invoice not found');
    const allowed = {
      status: input.status,
      due_date: input.dueDate,
      description: input.description,
      po_number: input.poNumber,
    };
    const sets = [];
    const params = [];
    for (const [column, value] of Object.entries(allowed)) {
      if (value === undefined) continue;
      sets.push(`${column} = ?`);
      params.push(value);
    }
    if (!sets.length) return getInvoice(id, conn);
    params.push(id);
    await conn.query(`UPDATE invoices SET ${sets.join(', ')} WHERE id = ?`, params);
    if (input.status && input.status !== invoice.status) {
      await conn.query(
        'INSERT INTO invoice_status_history (id, invoice_id, from_status, to_status, reason, actor_id) VALUES (?, ?, ?, ?, ?, ?)',
        [ulid(), id, invoice.status, input.status, input.reason ?? null, auth.user?.id ?? null],
      );
    }
    await writeAudit(conn, {
      orgId: auth.org.id,
      actorType: auth.type,
      actorId: auth.user?.id ?? auth.apiKeyId,
      action: 'invoice.updated',
      entityType: 'invoice',
      entityId: id,
      metadata: { fields: Object.keys(input) },
      ip: ctx.ip,
    });
    return getInvoice(id, conn);
  });
}

async function loadVerificationContext(invoice) {
  const business = await one('SELECT * FROM businesses WHERE id = ?', [invoice.business_id]);
  const counterparty = invoice.counterparty_id ? await one('SELECT * FROM counterparties WHERE id = ?', [invoice.counterparty_id]) : null;

  const purchaseOrder = invoice.po_number
    ? await one('SELECT * FROM purchase_orders WHERE business_id = ? AND po_number = ? ORDER BY created_at DESC LIMIT 1', [invoice.business_id, invoice.po_number])
    : null;

  const contract = invoice.counterparty_id
    ? await one(
        `SELECT * FROM contracts WHERE business_id = ? AND counterparty_id = ?
           AND (start_date IS NULL OR start_date <= ?) AND (end_date IS NULL OR end_date >= ?)
          ORDER BY start_date DESC LIMIT 1`,
        [invoice.business_id, invoice.counterparty_id, invoice.issue_date, invoice.issue_date],
      )
    : null;

  const delivery = await one('SELECT * FROM delivery_evidence WHERE invoice_id = ? ORDER BY delivery_date DESC LIMIT 1', [invoice.id]);
  const payments = await many('SELECT * FROM payment_records WHERE invoice_id = ?', [invoice.id]);

  const windowStart = new Date(new Date(invoice.issue_date).getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  const windowEnd = new Date(new Date(invoice.issue_date).getTime() + 120 * 86_400_000).toISOString().slice(0, 10);
  const transactions = await many(
    `SELECT * FROM transactions WHERE business_id = ? AND value_date BETWEEN ? AND ? ORDER BY value_date DESC LIMIT 500`,
    [invoice.business_id, windowStart, windowEnd],
  );

  let document = null;
  if (invoice.document_id) {
    const doc = await one('SELECT * FROM documents WHERE id = ?', [invoice.document_id]);
    if (doc) {
      const extraction = await one('SELECT raw_text FROM document_extractions WHERE document_id = ? ORDER BY created_at DESC LIMIT 1', [doc.id]);
      const fields = await many('SELECT field_name, field_value, confidence FROM extracted_fields WHERE document_id = ?', [doc.id]);
      document = { ...doc, extracted_text: extraction?.raw_text || '', fields };
    }
  }

  const duplicates = await many(
    `SELECT id, invoice_number, total_amount, issue_date FROM invoices
      WHERE business_id = ? AND id <> ? AND (invoice_number = ? OR (counterparty_id <=> ? AND total_amount = ? AND issue_date = ?))
      LIMIT 10`,
    [invoice.business_id, invoice.id, invoice.invoice_number, invoice.counterparty_id, invoice.total_amount, invoice.issue_date],
  );

  const toleranceRow = await one('SELECT reconciliation_rules FROM org_settings WHERE org_id = ?', [business.owner_org_id]);
  const tolerance = parseJson(toleranceRow?.reconciliation_rules) || { amountAbsolute: 1, amountPercent: 0.5, dateWindowDays: 7 };

  return { business, counterparty, purchaseOrder, contract, delivery, payments, transactions, document, duplicates, tolerance };
}

export async function verifyInvoiceRecord(auth, id, ctx = {}) {
  const invoice = await getInvoice(id);
  const context = await loadVerificationContext(invoice);
  const result = verifyInvoice({
    invoice,
    business: context.business,
    counterparty: context.counterparty,
    purchaseOrder: context.purchaseOrder,
    contract: context.contract,
    delivery: context.delivery,
    payments: context.payments,
    transactions: context.transactions,
    document: context.document,
    duplicateCandidates: context.duplicates,
    tolerance: context.tolerance,
    fieldConfidence: invoice.extraction_confidence ?? 0.8,
  });

  return withTransaction(async (conn) => {
    const eventId = ulid();
    await conn.query(
      `INSERT INTO verification_events (id, business_id, entity_type, entity_id, event_type, outcome, rules_json, explanation, actor_type, actor_id)
       VALUES (?, ?, 'invoice', ?, 'invoice_verification', ?, ?, ?, ?, ?)`,
      [
        eventId,
        invoice.business_id,
        id,
        result.status,
        JSON.stringify(result),
        result.summary,
        auth.type,
        auth.user?.id ?? auth.apiKeyId ?? null,
      ],
    );
    await conn.query(
      `UPDATE invoices SET verification_status = ?, verification_score = ?, last_verified_at = NOW(3),
        verified_at = IF(? = 'verified', NOW(3), verified_at) WHERE id = ?`,
      [result.status, result.score, result.status, id],
    );
    await writeAudit(conn, {
      orgId: auth.org.id,
      actorType: auth.type,
      actorId: auth.user?.id ?? auth.apiKeyId,
      action: 'invoice.verified',
      entityType: 'invoice',
      entityId: id,
      metadata: { status: result.status, score: result.score, coverage: result.coverage },
      ip: ctx.ip,
    });
    return { invoice: await getInvoice(id, conn), result, eventId };
  });
}

export async function recordPayment(auth, invoiceId, input, ctx = {}) {
  return withTransaction(async (conn) => {
    const [rows] = await conn.query('SELECT * FROM invoices WHERE id = ? FOR UPDATE', [invoiceId]);
    const invoice = rows[0];
    if (!invoice) throw notFound('Invoice not found');
    const id = ulid();
    await conn.query(
      `INSERT INTO payment_records (id, business_id, invoice_id, amount, currency_code, paid_at, method, reference, payer_name, payee_name, source, document_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?)`,
      [
        id,
        invoice.business_id,
        invoiceId,
        input.amount,
        input.currency,
        input.paidAt,
        input.method,
        input.reference ?? null,
        input.payerName ?? null,
        input.payeeName ?? null,
        input.documentId ?? null,
      ],
    );
    const [paidRows] = await conn.query('SELECT COALESCE(SUM(amount),0) AS paid FROM payment_records WHERE invoice_id = ?', [invoiceId]);
    const paid = Number(paidRows[0]?.paid ?? 0);
    const balance = money(Number(invoice.total_amount) - Number(paid));
    const status = balance <= 0.005 ? 'paid' : Number(paid) > 0 ? 'partially_paid' : invoice.status;
    await conn.query('UPDATE invoices SET amount_paid = ?, balance_due = ?, status = ? WHERE id = ?', [paid, balance, status, invoiceId]);
    await conn.query(
      'INSERT INTO invoice_status_history (id, invoice_id, from_status, to_status, reason, actor_id) VALUES (?, ?, ?, ?, ?, ?)',
      [ulid(), invoiceId, invoice.status, status, `Payment of ${input.amount} ${input.currency} recorded`, auth.user?.id ?? null],
    );
    await writeAudit(conn, {
      orgId: auth.org.id,
      actorType: auth.type,
      actorId: auth.user?.id ?? auth.apiKeyId,
      action: 'invoice.payment_recorded',
      entityType: 'invoice',
      entityId: invoiceId,
      metadata: { amount: input.amount, currency: input.currency, balance },
      ip: ctx.ip,
    });
    return getInvoice(invoiceId, conn);
  });
}

export const createPurchaseOrderSchema = z.object({
  businessId: z.string().length(26),
  counterpartyId: z.string().length(26).optional().nullable(),
  poNumber: z.string().trim().min(1).max(120),
  issueDate: isoDate,
  currency,
  totalAmount: z.coerce.number().min(0).max(1_000_000_000_000),
  documentId: z.string().length(26).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

export async function createPurchaseOrder(auth, input) {
  const id = ulid();
  await q(
    `INSERT INTO purchase_orders (id, business_id, counterparty_id, po_number, issue_date, currency_code, total_amount, document_id, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.businessId, input.counterpartyId ?? null, input.poNumber, input.issueDate, input.currency, input.totalAmount, input.documentId ?? null, input.notes ?? null],
  );
  return one('SELECT * FROM purchase_orders WHERE id = ?', [id]);
}

export const createContractSchema = z.object({
  businessId: z.string().length(26),
  counterpartyId: z.string().length(26).optional().nullable(),
  contractNumber: z.string().trim().min(1).max(120),
  title: z.string().max(255).optional().nullable(),
  startDate: isoDate.optional().nullable(),
  endDate: isoDate.optional().nullable(),
  currency: currency.optional().nullable(),
  contractValue: z.coerce.number().min(0).optional().nullable(),
  documentId: z.string().length(26).optional().nullable(),
});

export async function createContract(auth, input) {
  const id = ulid();
  await q(
    `INSERT INTO contracts (id, business_id, counterparty_id, contract_number, title, start_date, end_date, currency_code, contract_value, document_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.businessId,
      input.counterpartyId ?? null,
      input.contractNumber,
      input.title ?? null,
      input.startDate ?? null,
      input.endDate ?? null,
      input.currency ?? null,
      input.contractValue ?? null,
      input.documentId ?? null,
    ],
  );
  return one('SELECT * FROM contracts WHERE id = ?', [id]);
}

export const createDeliverySchema = z.object({
  businessId: z.string().length(26),
  invoiceId: z.string().length(26).optional().nullable(),
  deliveryNoteNumber: z.string().trim().min(1).max(120),
  deliveryDate: isoDate,
  recipientName: z.string().max(255).optional().nullable(),
  documentId: z.string().length(26).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

export async function createDelivery(auth, input) {
  const id = ulid();
  await q(
    `INSERT INTO delivery_evidence (id, business_id, invoice_id, delivery_note_number, delivery_date, recipient_name, document_id, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.businessId, input.invoiceId ?? null, input.deliveryNoteNumber, input.deliveryDate, input.recipientName ?? null, input.documentId ?? null, input.notes ?? null],
  );
  return one('SELECT * FROM delivery_evidence WHERE id = ?', [id]);
}

export async function listCommercialRecords(businessId, table, limit = 100) {
  const allowed = { purchase_orders: 'purchase_orders', contracts: 'contracts', delivery_evidence: 'delivery_evidence' };
  const name = allowed[table];
  if (!name) throw badRequest('Unknown record type');
  return many(`SELECT * FROM ${name} WHERE business_id = ? ORDER BY created_at DESC LIMIT ?`, [businessId, limit]);
}

export async function invoiceStats(businessId) {
  const rows = await many(
    `SELECT verification_status, COUNT(*) AS count, COALESCE(SUM(total_amount),0) AS value
       FROM invoices WHERE business_id = ? GROUP BY verification_status`,
    [businessId],
  );
  const out = {};
  for (const row of rows) out[row.verification_status] = { count: Number(row.count), value: Number(row.value) };
  return out;
}
