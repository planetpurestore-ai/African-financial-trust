import { many, manyOn, one, oneOn, withTransaction } from '../../db/pool.js';
import { writeAudit, verifyAuditChain } from '../../lib/audit.js';
import { canonicalJson, sha256Hex } from '../../lib/crypto.js';
import { notFound } from '../../lib/errors.js';
import { ulid } from '../../lib/ids.js';

export const TRUST_METHODOLOGY = '1.0.0';

const WEIGHTS = {
  identity: 20,
  invoice_integrity: 20,
  purchase_order: 15,
  delivery: 10,
  payment: 20,
  counterparty: 15,
};

const GRADES = [
  { min: 80, grade: 'A' },
  { min: 65, grade: 'B' },
  { min: 50, grade: 'C' },
  { min: 30, grade: 'D' },
  { min: 0, grade: 'E' },
];

function money(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function json(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function gradeFor(score) {
  return GRADES.find((g) => score >= g.min).grade;
}

export async function buildTrustRecord(businessId) {
  const business = await one('SELECT * FROM businesses WHERE id = ?', [businessId]);
  if (!business) throw notFound('Business not found');
  const orgId = business.owner_org_id;

  const [invoices, documents, payments, transactions, counterparties, reconciliations, identifiers, auditState] = await Promise.all([
    many('SELECT * FROM invoices WHERE business_id = ?', [businessId]),
    many('SELECT id, doc_type, status, extraction_confidence, created_at FROM documents WHERE business_id = ?', [businessId]),
    many('SELECT * FROM payment_records WHERE business_id = ?', [businessId]),
    many('SELECT * FROM transactions WHERE business_id = ?', [businessId]),
    many('SELECT * FROM counterparties WHERE business_id = ?', [businessId]),
    many('SELECT * FROM reconciliations WHERE business_id = ? ORDER BY created_at DESC LIMIT 1', [businessId]),
    many('SELECT * FROM business_identifiers WHERE business_id = ?', [businessId]),
    verifyAuditChain(orgId),
  ]);

  const lastRecon = reconciliations[0] || null;
  const matches = lastRecon
    ? await many('SELECT * FROM reconciliation_matches WHERE reconciliation_id = ?', [lastRecon.id])
    : [];

  const verifiedInvoices = invoices.filter((i) => i.verification_status === 'verified');
  const partialInvoices = invoices.filter((i) => i.verification_status === 'partially_verified');
  const inconsistentInvoices = invoices.filter((i) => i.verification_status === 'inconsistent');
  const duplicateInvoices = invoices.filter((i) => i.verification_status === 'duplicate_suspected');
  const openInvoices = invoices.filter((i) => ['issued', 'partially_paid', 'overdue'].includes(i.status) && Number(i.balance_due) > 0);
  const outstanding = money(openInvoices.reduce((s, i) => s + Number(i.balance_due), 0));
  const today = new Date();
  const overdue = openInvoices.filter((i) => i.due_date && new Date(i.due_date) < today);
  const overdueTotal = money(overdue.reduce((s, i) => s + Number(i.balance_due), 0));
  const paidTotal = money(payments.reduce((s, p) => s + Number(p.amount), 0));

  const invoiceTotal = money(invoices.reduce((s, i) => s + Number(i.total_amount), 0));
  const invoiceScores = invoices.filter((i) => i.verification_score !== null).map((i) => Number(i.verification_score));
  const avgInvoiceScore = invoiceScores.length ? invoiceScores.reduce((a, b) => a + b, 0) / invoiceScores.length : 0;

  const poMatched = invoices.filter((i) => i.po_number && i.verification_status === 'verified').length;
  const poInvoiced = invoices.filter((i) => i.po_number).length;
  const deliveryRows = await many('SELECT COUNT(*) AS c FROM delivery_evidence WHERE business_id = ?', [businessId]);
  const deliveryCount = Number(deliveryRows[0].c);

  const confirmedCounterparties = counterparties.filter((c) => c.status === 'confirmed').length;
  const conflictedCounterparties = counterparties.filter((c) => c.status === 'conflict').length;

  // Category sub-scores (0-100) and whether there is any applicable evidence.
  const identityScore =
    { verified: 100, partially_verified: 65, documents_submitted: 40, self_declared: 20, unverified: 0, rejected: 0 }[business.verification_status] ?? 0;
  const verifiedIdentifiers = identifiers.filter((i) => i.status === 'independently_verified').length;
  const identityFinal = Math.min(100, identityScore + verifiedIdentifiers * 10);

  const invoiceIntegrityScore = invoices.length
    ? Math.max(0, Math.min(100, avgInvoiceScore - duplicateInvoices.length * 15 - inconsistentInvoices.length * 10))
    : 0;

  const poScore = poInvoiced ? (poMatched / poInvoiced) * 100 : 0;
  const deliveryScore = invoices.length ? Math.min(100, (deliveryCount / Math.max(invoices.length, 1)) * 100) : 0;
  const paymentScore = invoiceTotal > 0 ? Math.min(100, (paidTotal / invoiceTotal) * 100) : payments.length ? 60 : 0;
  const counterpartyScore = counterparties.length ? (confirmedCounterparties / counterparties.length) * 100 : 0;

  const categories = [
    { key: 'identity', label: 'Identity evidence', weight: WEIGHTS.identity, score: identityFinal, applicable: business.verification_status !== 'unverified', detail: `Business verification status: ${business.verification_status}; ${verifiedIdentifiers} independently verified identifier(s)` },
    { key: 'invoice_integrity', label: 'Invoice integrity', weight: WEIGHTS.invoice_integrity, score: invoiceIntegrityScore, applicable: invoices.length > 0, detail: `${invoices.length} invoice(s); average verification score ${money(avgInvoiceScore)}; ${inconsistentInvoices.length} inconsistent; ${duplicateInvoices.length} duplicate suspected` },
    { key: 'purchase_order', label: 'Purchase order corroboration', weight: WEIGHTS.purchase_order, score: poScore, applicable: poInvoiced > 0, detail: `${poMatched} of ${poInvoiced} invoiced purchase order(s) corroborated` },
    { key: 'delivery', label: 'Delivery evidence', weight: WEIGHTS.delivery, score: deliveryScore, applicable: deliveryCount > 0, detail: `${deliveryCount} delivery record(s) for ${invoices.length} invoice(s)` },
    { key: 'payment', label: 'Payment corroboration', weight: WEIGHTS.payment, score: paymentScore, applicable: payments.length > 0 || transactions.length > 0, detail: `${payments.length} payment record(s) totalling ${paidTotal} against ${invoiceTotal} invoiced` },
    { key: 'counterparty', label: 'Counterparty confirmation', weight: WEIGHTS.counterparty, score: counterpartyScore, applicable: counterparties.length > 0, detail: `${confirmedCounterparties} of ${counterparties.length} counterparties confirmed; ${conflictedCounterparties} conflict(s)` },
  ];

  const applicable = categories.filter((c) => c.applicable);
  const weightTotal = applicable.reduce((s, c) => s + c.weight, 0);
  const weighted = weightTotal ? applicable.reduce((s, c) => s + c.score * c.weight, 0) / weightTotal : 0;
  const coverage = Number((applicable.reduce((s, c) => s + c.weight, 0) / Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toFixed(4));
  const evidenceScore = Number((weighted * (0.5 + 0.5 * coverage)).toFixed(2));
  const confidence = Number((coverage * (documents.length ? 0.9 : 0.6)).toFixed(4));

  let status;
  if (!applicable.length) status = 'insufficient_evidence';
  else if (evidenceScore >= 80 && coverage >= 0.7) status = 'verified_profile';
  else if (evidenceScore >= 50) status = 'partially_evidenced';
  else status = 'limited_evidence';

  const discrepancies = [];
  for (const invoice of inconsistentInvoices) {
    discrepancies.push({ type: 'invoice_inconsistent', severity: 'high', entity_id: invoice.id, description: `Invoice ${invoice.invoice_number} has inconsistent evidence` });
  }
  for (const invoice of duplicateInvoices) {
    discrepancies.push({ type: 'duplicate_invoice', severity: 'high', entity_id: invoice.id, description: `Invoice ${invoice.invoice_number} is suspected duplicate` });
  }
  for (const invoice of overdue) {
    discrepancies.push({ type: 'overdue_receivable', severity: 'medium', entity_id: invoice.id, description: `Invoice ${invoice.invoice_number} is overdue by ${Math.round((today - new Date(invoice.due_date)) / 86_400_000)} day(s)` });
  }
  const unmatchedTxns = matches.filter((m) => m.match_type === 'unmatched' && m.transaction_id);
  if (unmatchedTxns.length) {
    discrepancies.push({ type: 'unmatched_transactions', severity: 'medium', entity_id: lastRecon?.id, description: `${unmatchedTxns.length} transaction(s) could not be matched to an invoice` });
  }
  if (!business.registration_number) {
    discrepancies.push({ type: 'missing_registration', severity: 'medium', entity_id: business.id, description: 'No business registration number is recorded' });
  }
  if (!documents.length) {
    discrepancies.push({ type: 'no_documents', severity: 'high', entity_id: business.id, description: 'No source documents have been submitted' });
  }

  const provenance = {
    self_declared: 0,
    document_extracted: documents.length,
    counterparty_confirmed: confirmedCounterparties,
    independently_verified: verifiedIdentifiers,
  };

  const payload = {
    methodology_version: TRUST_METHODOLOGY,
    generated_at: new Date().toISOString(),
    business: {
      id: business.id,
      legal_name: business.legal_name,
      trading_name: business.trading_name,
      country_code: business.country_code,
      registration_number: business.registration_number,
      tax_id: business.tax_id,
      industry: business.industry,
      verification_status: business.verification_status,
      verification_level: business.verification_level,
      verified_at: business.verified_at,
    },
    evidence: {
      score: evidenceScore,
      grade: gradeFor(evidenceScore),
      coverage,
      confidence,
      status,
      weights: WEIGHTS,
      categories: categories.map(({ applicable: _a, ...rest }) => rest),
      note: 'This is an evidence-confidence measure, not a credit score or a prediction of payment behaviour.',
    },
    documents: {
      total: documents.length,
      by_type: documents.reduce((acc, d) => ({ ...acc, [d.doc_type]: (acc[d.doc_type] || 0) + 1 }), {}),
      needs_review: documents.filter((d) => d.status === 'needs_review').length,
      failed: documents.filter((d) => d.status === 'failed').length,
    },
    invoices: {
      total: invoices.length,
      verified: verifiedInvoices.length,
      partially_verified: partialInvoices.length,
      inconsistent: inconsistentInvoices.length,
      duplicate_suspected: duplicateInvoices.length,
      total_value: invoiceTotal,
      verified_value: money(verifiedInvoices.reduce((s, i) => s + Number(i.total_amount), 0)),
    },
    receivables: {
      open_count: openInvoices.length,
      outstanding_total: outstanding,
      overdue_count: overdue.length,
      overdue_total: overdueTotal,
      ageing: {
        current: money(openInvoices.filter((i) => !i.due_date || new Date(i.due_date) >= today).reduce((s, i) => s + Number(i.balance_due), 0)),
        days_1_30: money(overdue.filter((i) => (today - new Date(i.due_date)) / 86_400_000 <= 30).reduce((s, i) => s + Number(i.balance_due), 0)),
        days_31_60: money(overdue.filter((i) => (today - new Date(i.due_date)) / 86_400_000 > 30 && (today - new Date(i.due_date)) / 86_400_000 <= 60).reduce((s, i) => s + Number(i.balance_due), 0)),
        days_60_plus: money(overdue.filter((i) => (today - new Date(i.due_date)) / 86_400_000 > 60).reduce((s, i) => s + Number(i.balance_due), 0)),
      },
    },
    payments: {
      count: payments.length,
      total: paidTotal,
      corroborated_transactions: transactions.length,
    },
    counterparties: {
      total: counterparties.length,
      confirmed: confirmedCounterparties,
      conflict: conflictedCounterparties,
    },
    reconciliation: lastRecon
      ? {
          last_run_at: lastRecon.created_at,
          exact: matches.filter((m) => m.match_type === 'exact').length,
          probable: matches.filter((m) => m.match_type === 'probable').length,
          partial: matches.filter((m) => m.match_type === 'partial').length,
          unmatched: matches.filter((m) => m.match_type === 'unmatched').length,
          stats: json(lastRecon.stats_json),
        }
      : null,
    discrepancies,
    provenance,
    audit: { chain_valid: auditState.valid, entries: auditState.count, head_hash: auditState.head?.hash || null },
  };

  return { payload, evidenceScore, grade: gradeFor(evidenceScore), coverage, confidence, status, categories, discrepancies, orgId };
}

export async function generateTrustRecord(auth, businessId, ctx = {}) {
  const built = await buildTrustRecord(businessId);
  return withTransaction(async (conn) => {
    const [lastRows] = await conn.query('SELECT * FROM trust_records WHERE business_id = ? ORDER BY version DESC LIMIT 1 FOR UPDATE', [businessId]);
    const last = lastRows[0] || null;
    const version = last ? Number(last.version) + 1 : 1;
    const previousHash = last?.hash || null;
    const hash = sha256Hex(canonicalJson(built.payload) + (previousHash || ''));
    const id = ulid();

    await conn.query(
      `INSERT INTO trust_records (id, business_id, version, status, evidence_score, evidence_grade, coverage, confidence,
        payload, methodology_version, hash, previous_hash, generated_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        businessId,
        version,
        built.status,
        built.evidenceScore,
        built.grade,
        built.coverage,
        built.confidence,
        JSON.stringify(built.payload),
        TRUST_METHODOLOGY,
        hash,
        previousHash,
        auth.user?.id ?? null,
      ],
    );
    if (last) await conn.query('UPDATE trust_records SET superseded_by_id = ? WHERE id = ?', [id, last.id]);

    for (const category of built.categories) {
      await conn.query(
        `INSERT INTO evidence_items (id, business_id, trust_record_id, category, source_type, source_id, provenance, weight,
          confidence, status, description)
         VALUES (?, ?, ?, ?, 'computed', NULL, ?, ?, ?, ?, ?)`,
        [
          ulid(),
          businessId,
          id,
          category.key,
          category.key === 'identity' ? 'independently_verified' : 'document_extracted',
          category.weight,
          built.confidence,
          category.applicable ? (category.score >= 60 ? 'positive' : 'neutral') : 'missing',
          category.detail,
        ],
      );
    }
    await conn.query(
      `INSERT INTO verification_events (id, business_id, entity_type, entity_id, event_type, outcome, rules_json, explanation, actor_type, actor_id)
       VALUES (?, ?, 'trust_record', ?, 'trust_record_generated', ?, ?, ?, ?, ?)`,
      [ulid(), businessId, id, built.status, JSON.stringify({ categories: built.categories, weights: WEIGHTS }), `Trust Record v${version} generated with evidence score ${built.evidenceScore}`, auth.type, auth.user?.id ?? null],
    );
    await writeAudit(conn, {
      orgId: auth.org.id,
      actorType: auth.type,
      actorId: auth.user?.id ?? auth.apiKeyId,
      action: 'trust_record.generated',
      entityType: 'trust_record',
      entityId: id,
      metadata: { business_id: businessId, version, score: built.evidenceScore, grade: built.grade },
      ip: ctx.ip,
    });
    return getTrustRecord(id, conn);
  });
}

function parseRecord(row) {
  if (!row) return null;
  return { ...row, payload: json(row.payload) };
}

export async function getTrustRecord(id, conn = null) {
  const read = conn ? (sql, params) => oneOn(conn, sql, params) : (sql, params) => one(sql, params);
  const readMany = conn ? (sql, params) => manyOn(conn, sql, params) : (sql, params) => many(sql, params);
  const row = await read('SELECT * FROM trust_records WHERE id = ?', [id]);
  if (!row) return null;
  const [evidence, previous] = await Promise.all([
    readMany('SELECT * FROM evidence_items WHERE trust_record_id = ?', [id]),
    row.previous_hash ? read('SELECT id, version, hash FROM trust_records WHERE business_id = ? AND hash = ?', [row.business_id, row.previous_hash]) : null,
  ]);
  return { ...parseRecord(row), evidence, previous_version: previous || null };
}

export async function latestTrustRecord(businessId) {
  const row = await one('SELECT * FROM trust_records WHERE business_id = ? ORDER BY version DESC LIMIT 1', [businessId]);
  if (!row) return null;
  return getTrustRecord(row.id);
}

export async function listTrustRecords(businessId) {
  return many(
    'SELECT id, version, status, evidence_score, evidence_grade, coverage, confidence, hash, previous_hash, generated_at, superseded_by_id FROM trust_records WHERE business_id = ? ORDER BY version DESC',
    [businessId],
  );
}

export async function verifyTrustRecordHash(id) {
  const row = await one('SELECT * FROM trust_records WHERE id = ?', [id]);
  if (!row) throw notFound('Trust Record not found');
  const recomputed = sha256Hex(canonicalJson(json(row.payload)) + (row.previous_hash || ''));
  return { id, valid: recomputed === row.hash, stored_hash: row.hash, recomputed_hash: recomputed };
}
