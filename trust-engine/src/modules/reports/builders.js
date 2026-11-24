import { many, one } from '../../db/pool.js';
import { notFound } from '../../lib/errors.js';
import { verifyAuditChain } from '../../lib/audit.js';
import { latestTrustRecord } from '../trust/service.js';

const LIMITATIONS = [
  'This report is generated from records held in the AFT Trust Engine at the time shown.',
  'Verification results reflect the evidence available to AFT; they are not an audit opinion, a credit rating or a guarantee of payment.',
  'Information supplied by a business is distinguished from document-extracted, counterparty-confirmed and independently verified information.',
  'Where source documents were processed by OCR, field values may contain transcription errors; field-level confidence is recorded in the platform.',
];

function fmtDate(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString().slice(0, 10);
}

function money(value, currency = '') {
  const n = Number(value || 0);
  return `${currency ? `${currency} ` : ''}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function requireBusiness(businessId) {
  const business = await one('SELECT * FROM businesses WHERE id = ?', [businessId]);
  if (!business) throw notFound('Business not found');
  return business;
}

export async function buildReport(type, businessId, orgId) {
  const generatedAt = new Date().toISOString();
  const business = businessId ? await requireBusiness(businessId) : null;
  const base = {
    type,
    generatedAt,
    orgId,
    business,
    limitations: LIMITATIONS,
    meta: [
      { label: 'Generated', value: generatedAt.replace('T', ' ').slice(0, 19) + ' UTC' },
      { label: 'Organisation', value: orgId },
      ...(business ? [{ label: 'Business', value: business.legal_name }, { label: 'Country', value: business.country_code }] : []),
    ],
  };

  if (type === 'business_verification') {
    const [identifiers, reps, history, documents] = await Promise.all([
      many('SELECT * FROM business_identifiers WHERE business_id = ?', [businessId]),
      many('SELECT * FROM business_representatives WHERE business_id = ?', [businessId]),
      many('SELECT * FROM business_history WHERE business_id = ? ORDER BY changed_at DESC LIMIT 50', [businessId]),
      many('SELECT doc_type, status, COUNT(*) AS count FROM documents WHERE business_id = ? GROUP BY doc_type, status', [businessId]),
    ]);
    return {
      ...base,
      title: 'Business verification report',
      subtitle: `${business.legal_name} — ${business.country_code}`,
      meta: [
        ...base.meta,
        { label: 'Verification status', value: business.verification_status },
        { label: 'Verification level', value: String(business.verification_level) },
        { label: 'Method', value: business.verification_method || 'not recorded' },
      ],
      sections: [
        {
          heading: 'Identity',
          columns: ['Field', 'Value'],
          rows: [
            ['Legal name', business.legal_name],
            ['Trading name', business.trading_name || '—'],
            ['Registration number', business.registration_number || 'not recorded'],
            ['Tax ID', business.tax_id || 'not recorded'],
            ['Legal form', business.legal_form || '—'],
            ['Incorporation date', fmtDate(business.incorporation_date)],
            ['Address', [business.address_line1, business.city, business.country_code].filter(Boolean).join(', ')],
            ['Contact', [business.email, business.phone].filter(Boolean).join(' / ')],
          ],
        },
        {
          heading: 'Identifiers',
          columns: ['Type', 'Value', 'Issuer', 'Status', 'Verified'],
          rows: identifiers.map((i) => [i.identifier_type, i.value, i.issuing_authority || '—', i.status, fmtDate(i.verified_at)]),
        },
        {
          heading: 'Authorised representatives',
          columns: ['Name', 'Role', 'Email', 'Authorised', 'Verified'],
          rows: reps.map((r) => [r.full_name, r.role_title || '—', r.email || '—', r.authorised ? 'yes' : 'no', fmtDate(r.verified_at)]),
        },
        {
          heading: 'Documents submitted',
          columns: ['Document type', 'Status', 'Count'],
          rows: documents.map((d) => [d.doc_type, d.status, String(d.count)]),
        },
        {
          heading: 'Change history',
          columns: ['Field', 'Previous', 'New', 'Reason', 'Date'],
          rows: history.map((h) => [h.field_name, h.old_value || '—', h.new_value || '—', h.reason || '—', fmtDate(h.changed_at)]),
        },
      ],
    };
  }

  if (type === 'invoice_verification') {
    const invoices = await many(
      `SELECT i.*, c.name AS counterparty_name FROM invoices i LEFT JOIN counterparties c ON c.id = i.counterparty_id
        WHERE i.business_id = ? ORDER BY i.issue_date DESC LIMIT 500`,
      [businessId],
    );
    const events = await many(
      `SELECT entity_id, outcome, explanation FROM verification_events WHERE business_id = ? AND entity_type = 'invoice'
        ORDER BY created_at DESC LIMIT 500`,
      [businessId],
    );
    const eventMap = new Map(events.map((e) => [e.entity_id, e]));
    return {
      ...base,
      title: 'Invoice verification report',
      subtitle: `${invoices.length} invoice(s)`,
      meta: [
        ...base.meta,
        { label: 'Verified', value: String(invoices.filter((i) => i.verification_status === 'verified').length) },
        { label: 'Partially verified', value: String(invoices.filter((i) => i.verification_status === 'partially_verified').length) },
        { label: 'Inconsistent', value: String(invoices.filter((i) => i.verification_status === 'inconsistent').length) },
      ],
      sections: [
        {
          heading: 'Invoices',
          columns: ['Invoice', 'Counterparty', 'Issued', 'Due', 'Currency', 'Total', 'Balance', 'Status', 'Score'],
          rows: invoices.map((i) => [
            i.invoice_number,
            i.counterparty_name || '—',
            fmtDate(i.issue_date),
            fmtDate(i.due_date),
            i.currency_code,
            money(i.total_amount),
            money(i.balance_due),
            i.verification_status,
            i.verification_score === null ? '—' : String(i.verification_score),
          ]),
        },
        {
          heading: 'Verification explanations',
          columns: ['Invoice', 'Outcome', 'Explanation'],
          rows: invoices
            .filter((i) => eventMap.get(i.id))
            .map((i) => [i.invoice_number, eventMap.get(i.id).outcome, String(eventMap.get(i.id).explanation || '').slice(0, 240)]),
        },
      ],
    };
  }

  if (type === 'receivables') {
    const invoices = await many(
      `SELECT i.*, c.name AS counterparty_name FROM invoices i LEFT JOIN counterparties c ON c.id = i.counterparty_id
        WHERE i.business_id = ? AND i.balance_due > 0 AND i.status IN ('issued','partially_paid','overdue')
        ORDER BY i.due_date`,
      [businessId],
    );
    const today = new Date();
    const bucket = (i) => {
      if (!i.due_date) return 'current';
      const days = Math.floor((today - new Date(i.due_date)) / 86_400_000);
      if (days <= 0) return 'current';
      if (days <= 30) return '1-30';
      if (days <= 60) return '31-60';
      return '60+';
    };
    return {
      ...base,
      title: 'Receivables verification report',
      subtitle: `${invoices.length} open invoice(s)`,
      meta: [...base.meta, { label: 'Outstanding', value: money(invoices.reduce((s, i) => s + Number(i.balance_due), 0)) }],
      sections: [
        {
          heading: 'Open receivables',
          columns: ['Invoice', 'Counterparty', 'Due date', 'Currency', 'Total', 'Paid', 'Balance', 'Ageing', 'Verification'],
          rows: invoices.map((i) => [
            i.invoice_number,
            i.counterparty_name || '—',
            fmtDate(i.due_date),
            i.currency_code,
            money(i.total_amount),
            money(i.amount_paid),
            money(i.balance_due),
            bucket(i),
            i.verification_status,
          ]),
        },
      ],
    };
  }

  if (type === 'reconciliation') {
    const recon = await one('SELECT * FROM reconciliations WHERE business_id = ? ORDER BY created_at DESC LIMIT 1', [businessId]);
    if (!recon) throw notFound('No reconciliation has been run for this business');
    const matches = await many(
      `SELECT m.*, i.invoice_number, t.reference AS transaction_reference, t.value_date AS transaction_date, t.amount AS transaction_amount
         FROM reconciliation_matches m LEFT JOIN invoices i ON i.id = m.invoice_id LEFT JOIN transactions t ON t.id = m.transaction_id
        WHERE m.reconciliation_id = ? ORDER BY m.match_type, m.score DESC`,
      [recon.id],
    );
    return {
      ...base,
      title: 'Transaction reconciliation report',
      subtitle: `Run ${fmtDate(recon.created_at)}`,
      meta: [...base.meta, { label: 'Rules', value: JSON.stringify(recon.rules_json) }],
      sections: [
        {
          heading: 'Matches',
          columns: ['Type', 'Score', 'Invoice', 'Transaction ref', 'Transaction date', 'Amount applied', 'Status'],
          rows: matches.map((m) => [
            m.match_type,
            String(m.score),
            m.invoice_number || '—',
            m.transaction_reference || '—',
            fmtDate(m.transaction_date),
            money(m.amount_applied, m.currency_code),
            m.status,
          ]),
        },
      ],
    };
  }

  if (type === 'counterparty') {
    const rows = await many('SELECT * FROM counterparties WHERE business_id = ? ORDER BY name', [businessId]);
    return {
      ...base,
      title: 'Counterparty report',
      subtitle: `${rows.length} relationship(s)`,
      meta: [...base.meta, { label: 'Confirmed', value: String(rows.filter((r) => r.status === 'confirmed').length) }],
      sections: [
        {
          heading: 'Counterparties',
          columns: ['Name', 'Relationship', 'Country', 'Registration', 'Status', 'Confirmed', 'Invoices', 'Total value'],
          rows: rows.map((r) => [
            r.name,
            r.relationship,
            r.country_code || '—',
            r.registration_number || '—',
            r.status,
            fmtDate(r.confirmed_at),
            String(r.transaction_count),
            money(r.total_value, r.currency_code || ''),
          ]),
        },
      ],
    };
  }

  if (type === 'trust_record') {
    const record = await latestTrustRecord(businessId);
    if (!record) throw notFound('No Trust Record has been generated for this business');
    const payload = record.payload || {};
    const categories = payload.evidence?.categories || [];
    return {
      ...base,
      title: 'Trust Record summary',
      subtitle: `Version ${record.version} — grade ${record.evidence_grade}`,
      meta: [
        ...base.meta,
        { label: 'Evidence score', value: String(record.evidence_score) },
        { label: 'Coverage', value: `${Math.round(Number(record.coverage) * 100)}%` },
        { label: 'Record hash', value: record.hash },
      ],
      sections: [
        {
          heading: 'Evidence categories',
          columns: ['Category', 'Weight', 'Score', 'Detail'],
          rows: categories.map((c) => [c.label, String(c.weight), String(Math.round(c.score)), String(c.detail).slice(0, 180)]),
        },
        {
          heading: 'Receivables',
          columns: ['Measure', 'Value'],
          rows: Object.entries(payload.receivables || {}).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)]),
        },
        {
          heading: 'Discrepancies',
          columns: ['Type', 'Severity', 'Description'],
          rows: (payload.discrepancies || []).map((d) => [d.type, d.severity, d.description]),
        },
      ],
    };
  }

  if (type === 'evidence_completeness') {
    const [documents, invoices, payments, deliveries, counterparties] = await Promise.all([
      many('SELECT doc_type, status, COUNT(*) AS count FROM documents WHERE business_id = ? GROUP BY doc_type, status', [businessId]),
      many('SELECT COUNT(*) AS c FROM invoices WHERE business_id = ?', [businessId]),
      many('SELECT COUNT(*) AS c FROM payment_records WHERE business_id = ?', [businessId]),
      many('SELECT COUNT(*) AS c FROM delivery_evidence WHERE business_id = ?', [businessId]),
      many('SELECT status, COUNT(*) AS c FROM counterparties WHERE business_id = ? GROUP BY status', [businessId]),
    ]);
    return {
      ...base,
      title: 'Evidence completeness report',
      subtitle: business.legal_name,
      sections: [
        {
          heading: 'Document coverage',
          columns: ['Document type', 'Status', 'Count'],
          rows: documents.map((d) => [d.doc_type, d.status, String(d.count)]),
        },
        {
          heading: 'Evidence inventory',
          columns: ['Evidence', 'Count'],
          rows: [
            ['Invoices', String(invoices[0].c)],
            ['Payment records', String(payments[0].c)],
            ['Delivery records', String(deliveries[0].c)],
            ...counterparties.map((c) => [`Counterparties — ${c.status}`, String(c.c)]),
          ],
        },
      ],
    };
  }

  if (type === 'discrepancies') {
    const record = await latestTrustRecord(businessId);
    const discrepancies = record?.payload?.discrepancies || [];
    const inconsistent = await many(
      "SELECT invoice_number, verification_status, verification_score FROM invoices WHERE business_id = ? AND verification_status IN ('inconsistent','duplicate_suspected','disputed')",
      [businessId],
    );
    return {
      ...base,
      title: 'Discrepancy report',
      subtitle: `${discrepancies.length} open discrepancy(ies)`,
      sections: [
        {
          heading: 'Trust Record discrepancies',
          columns: ['Type', 'Severity', 'Description'],
          rows: discrepancies.map((d) => [d.type, d.severity, d.description]),
        },
        {
          heading: 'Invoices requiring attention',
          columns: ['Invoice', 'Status', 'Score'],
          rows: inconsistent.map((i) => [i.invoice_number, i.verification_status, String(i.verification_score ?? '—')]),
        },
      ],
    };
  }

  if (type === 'audit') {
    const entries = await many(
      'SELECT seq, action, entity_type, entity_id, actor_type, actor_label, created_at, hash FROM audit_logs WHERE org_id = ? ORDER BY seq DESC LIMIT 1000',
      [orgId],
    );
    const chain = await verifyAuditChain(orgId);
    return {
      ...base,
      title: 'Audit report',
      subtitle: `${entries.length} entries — chain ${chain.valid ? 'valid' : 'BROKEN'}`,
      meta: [...base.meta, { label: 'Chain status', value: chain.valid ? 'valid' : `broken at ${chain.broken_at}` }],
      sections: [
        {
          heading: 'Audit entries',
          columns: ['Seq', 'Action', 'Entity', 'Actor', 'At', 'Hash'],
          rows: entries.map((e) => [String(e.seq), e.action, `${e.entity_type}:${e.entity_id || ''}`, `${e.actor_type}${e.actor_label ? ` (${e.actor_label})` : ''}`, fmtDate(e.created_at), String(e.hash).slice(0, 16)]),
        },
      ],
    };
  }

  throw notFound(`Unknown report type: ${type}`);
}

export const REPORT_TYPES = [
  'business_verification',
  'invoice_verification',
  'receivables',
  'reconciliation',
  'counterparty',
  'trust_record',
  'evidence_completeness',
  'discrepancies',
  'audit',
];
