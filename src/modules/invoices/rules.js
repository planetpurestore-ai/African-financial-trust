/**
 * Deterministic invoice verification.
 *
 * Every rule declares its weight, the evidence it needs and how a result is
 * explained. Nothing here calls an AI model and no rule can pass on the
 * existence of a document alone: at least two independent corroboration
 * categories are required before an invoice can be "verified".
 */

const WEIGHTS = {
  required_fields: 10,
  arithmetic: 15,
  date_sanity: 5,
  number_integrity: 5,
  issuer_match: 10,
  counterparty_identified: 10,
  po_match: 15,
  contract_match: 5,
  delivery_evidence: 10,
  payment_corroboration: 15,
  document_support: 5,
  tax_consistency: 5,
};

export const METHODOLOGY_VERSION = '1.0.0';

const CORROBORATION = ['po_match', 'contract_match', 'delivery_evidence', 'payment_corroboration', 'counterparty_identified'];

function money(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function near(a, b, { absolute = 0.01, percent = 0 } = {}) {
  const diff = Math.abs(money(a) - money(b));
  const tolerance = Math.max(absolute, (Math.abs(money(b)) * percent) / 100);
  return { matches: diff <= tolerance, diff: money(diff), tolerance: money(tolerance) };
}

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b(ltd|limited|plc|llc|sarl|sas|sa|bv|gmbh|inc|co|company)\b/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameSimilarity(a, b) {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.9;
  const tokensA = new Set(x.split(' '));
  const tokensB = new Set(y.split(' '));
  const shared = [...tokensA].filter((t) => tokensB.has(t)).length;
  return shared / Math.max(tokensA.size, tokensB.size);
}

/**
 * @param {object} input
 * @param {object} input.invoice
 * @param {object} input.business
 * @param {object|null} input.counterparty
 * @param {object|null} input.purchaseOrder
 * @param {object|null} input.contract
 * @param {object|null} input.delivery
 * @param {object[]} input.payments
 * @param {object[]} input.transactions
 * @param {object|null} input.document
 * @param {object} input.tolerance
 */
export function verifyInvoice(input) {
  const { invoice, business, counterparty, purchaseOrder, contract, delivery, payments = [], transactions = [], document } = input;
  const tolerance = input.tolerance || { amountAbsolute: 1, amountPercent: 0.5, dateWindowDays: 7 };
  const rules = [];
  const add = (id, label, category, status, detail, evidence = null) => {
    rules.push({ id, label, category, weight: WEIGHTS[id] || 0, status, detail, evidence });
  };

  // 1. Required fields
  const missing = [];
  if (!invoice.invoice_number) missing.push('invoice number');
  if (!invoice.issue_date) missing.push('issue date');
  if (!invoice.currency_code) missing.push('currency');
  if (!(Number(invoice.total_amount) > 0)) missing.push('total amount');
  if (!invoice.counterparty_id) missing.push('counterparty');
  add(
    'required_fields',
    'Mandatory invoice fields present',
    'integrity',
    missing.length ? 'fail' : 'pass',
    missing.length ? `Missing: ${missing.join(', ')}` : 'Invoice number, date, currency, total and counterparty are present',
    { missing },
  );

  // 2. Arithmetic
  const lines = invoice.lines || [];
  const lineSum = money(lines.reduce((sum, line) => sum + Number(line.line_total || 0), 0));
  const subtotal = money(invoice.subtotal);
  const tax = money(invoice.tax_amount);
  const total = money(invoice.total_amount);
  const arithmeticIssues = [];
  if (lines.length) {
    const check = near(lineSum, subtotal, { absolute: 0.05 });
    if (!check.matches) arithmeticIssues.push(`Line items total ${lineSum} does not equal subtotal ${subtotal}`);
  }
  const computed = money(subtotal + tax);
  if (Math.abs(computed - total) > 0.05 && subtotal > 0) {
    arithmeticIssues.push(`Subtotal ${subtotal} + tax ${tax} = ${computed}, not stated total ${total}`);
  }
  add(
    'arithmetic',
    'Invoice totals reconcile',
    'integrity',
    arithmeticIssues.length ? 'fail' : 'pass',
    arithmeticIssues.length ? arithmeticIssues.join('; ') : `Lines, subtotal ${subtotal}, tax ${tax} and total ${total} agree`,
    { lineSum, subtotal, tax, total },
  );

  // 3. Date sanity
  const today = new Date();
  const issue = invoice.issue_date ? new Date(`${String(invoice.issue_date).slice(0, 10)}T00:00:00Z`) : null;
  const due = invoice.due_date ? new Date(`${String(invoice.due_date).slice(0, 10)}T00:00:00Z`) : null;
  const dateIssues = [];
  if (issue) {
    if (issue.getTime() > today.getTime() + 86_400_000) dateIssues.push('Issue date is in the future');
    if (issue.getTime() < Date.UTC(today.getUTCFullYear() - 7, 0, 1)) dateIssues.push('Issue date is more than seven years old');
  }
  if (issue && due && due.getTime() < issue.getTime()) dateIssues.push('Due date precedes issue date');
  add(
    'date_sanity',
    'Invoice dates are plausible',
    'integrity',
    dateIssues.length ? 'fail' : 'pass',
    dateIssues.length ? dateIssues.join('; ') : 'Issue and due dates are consistent',
    { issue_date: invoice.issue_date, due_date: invoice.due_date },
  );

  // 4. Number integrity / duplicates
  const duplicates = input.duplicateCandidates || [];
  add(
    'number_integrity',
    'Invoice number is unique for this issuer',
    'integrity',
    duplicates.length ? 'fail' : 'pass',
    duplicates.length
      ? `${duplicates.length} other invoice(s) share this number or the same counterparty, amount and date`
      : 'No duplicate invoice number found for this issuer',
    { duplicates: duplicates.map((d) => ({ id: d.id, invoice_number: d.invoice_number, total_amount: d.total_amount })) },
  );

  // 5. Issuer identity
  let issuerScore = 0;
  if (document) {
    const text = `${document.extracted_text || ''}`;
    issuerScore = Math.max(
      nameSimilarity(business?.legal_name, text.slice(0, 5000)),
      nameSimilarity(business?.trading_name, text.slice(0, 5000)),
    );
    if (issuerScore < 0.4) {
      const extractedSupplier = (document.fields || []).find((f) => f.field_name === 'supplier_name');
      issuerScore = Math.max(issuerScore, nameSimilarity(business?.legal_name, extractedSupplier?.field_value));
    }
  }
  add(
    'issuer_match',
    'Invoice issuer matches the registered business',
    'identity',
    !document ? 'skip' : issuerScore >= 0.6 ? 'pass' : 'fail',
    !document
      ? 'No source document attached; issuer identity cannot be tested against the document'
      : issuerScore >= 0.6
        ? `Issuer name matches the registered business (${Math.round(issuerScore * 100)}% similarity)`
        : 'The issuer name on the document does not match the registered business',
    { similarity: Number(issuerScore.toFixed(2)) },
  );

  // 6. Counterparty identity
  const cpIdentified = Boolean(counterparty && (counterparty.registration_number || counterparty.status === 'confirmed'));
  add(
    'counterparty_identified',
    'Counterparty is identified and corroborated',
    'counterparty',
    !counterparty ? 'fail' : cpIdentified ? 'pass' : 'warn',
    !counterparty
      ? 'No counterparty is linked to this invoice'
      : cpIdentified
        ? `Counterparty ${counterparty.name} is ${counterparty.status === 'confirmed' ? 'confirmed' : 'identified with a registration number'}`
        : `Counterparty ${counterparty.name} is recorded but not independently confirmed`,
    { counterparty_id: counterparty?.id || null, status: counterparty?.status || null },
  );

  // 7. Purchase order
  if (invoice.po_number) {
    if (!purchaseOrder) {
      add('po_match', 'Invoice matches an authorised purchase order', 'commercial', 'fail', `Invoice cites PO ${invoice.po_number}, but no matching purchase order is on record`, { po_number: invoice.po_number });
    } else {
      const amountCheck = near(total, purchaseOrder.total_amount, {
        absolute: tolerance.amountAbsolute,
        percent: tolerance.amountPercent,
      });
      const currencyOk = purchaseOrder.currency_code === invoice.currency_code;
      const dateOk = issue && new Date(purchaseOrder.issue_date) <= issue;
      const ok = amountCheck.matches && currencyOk && dateOk;
      add(
        'po_match',
        'Invoice matches an authorised purchase order',
        'commercial',
        ok ? 'pass' : 'fail',
        ok
          ? `Matches PO ${purchaseOrder.po_number} for ${purchaseOrder.currency_code} ${purchaseOrder.total_amount}`
          : `PO ${purchaseOrder.po_number} differs (amount difference ${amountCheck.diff}, currency ${currencyOk ? 'ok' : 'mismatch'}, date ${dateOk ? 'ok' : 'after invoice'})`,
        { po_id: purchaseOrder.id, amount_diff: amountCheck.diff, currency_ok: currencyOk, date_ok: dateOk },
      );
    }
  } else {
    add('po_match', 'Invoice matches an authorised purchase order', 'commercial', 'skip', 'No purchase order reference on the invoice', null);
  }

  // 8. Contract coverage
  if (contract) {
    const covers = (!contract.start_date || new Date(contract.start_date) <= issue) && (!contract.end_date || new Date(contract.end_date) >= issue);
    add(
      'contract_match',
      'A contract covers this transaction',
      'commercial',
      covers ? 'pass' : 'warn',
      covers ? `Contract ${contract.contract_number} was active on the invoice date` : `Contract ${contract.contract_number} does not cover the invoice date`,
      { contract_id: contract.id },
    );
  } else {
    add('contract_match', 'A contract covers this transaction', 'commercial', 'skip', 'No contract on record for this counterparty', null);
  }

  // 9. Delivery evidence
  if (delivery) {
    const afterIssue = issue && new Date(delivery.delivery_date) >= issue;
    add(
      'delivery_evidence',
      'Delivery is evidenced',
      'fulfilment',
      afterIssue ? 'pass' : 'warn',
      `Delivery note ${delivery.delivery_note_number} dated ${String(delivery.delivery_date).slice(0, 10)}`,
      { delivery_id: delivery.id },
    );
  } else {
    add('delivery_evidence', 'Delivery is evidenced', 'fulfilment', 'skip', 'No delivery note linked to this invoice', null);
  }

  // 10. Payment corroboration
  const matchedPayments = payments.filter((p) => p.invoice_id === invoice.id);
  const paidTotal = money(matchedPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0));
  const bankMatches = transactions.filter((t) => {
    if (t.direction !== 'credit' && t.direction !== 'debit') return false;
    const amountCheck = near(Math.abs(Number(t.amount)), total, { absolute: tolerance.amountAbsolute, percent: tolerance.amountPercent });
    const refMatch = t.reference && invoice.invoice_number && String(t.reference).toLowerCase().includes(String(invoice.invoice_number).toLowerCase());
    return amountCheck.matches || refMatch;
  });
  const corroborated = paidTotal > 0 || bankMatches.length > 0;
  add(
    'payment_corroboration',
    'Payment is corroborated by independent records',
    'payment',
    corroborated ? (paidTotal >= total ? 'pass' : 'warn') : 'fail',
    corroborated
      ? `Recorded payments ${paidTotal} ${invoice.currency_code}${bankMatches.length ? `; ${bankMatches.length} matching bank/mobile-money transaction(s)` : ''}`
      : 'No payment record or matching transaction corroborates this invoice',
    {
      paid_total: paidTotal,
      payment_count: matchedPayments.length,
      matching_transactions: bankMatches.map((t) => t.id),
    },
  );

  // 11. Source document
  add(
    'document_support',
    'A source document supports the invoice',
    'document',
    document ? 'pass' : 'fail',
    document ? `Document ${document.original_filename} attached` : 'No source document attached',
    { document_id: document?.id || null },
  );

  // 12. Tax consistency
  const taxRate = subtotal > 0 ? (tax / subtotal) * 100 : 0;
  const taxOk = tax >= 0 && tax <= total && taxRate <= 35;
  add(
    'tax_consistency',
    'Tax amount is internally consistent',
    'integrity',
    taxOk ? 'pass' : 'fail',
    taxOk ? `Tax is ${taxRate.toFixed(2)}% of subtotal` : `Implausible tax: ${tax} on subtotal ${subtotal}`,
    { tax_rate: Number(taxRate.toFixed(2)) },
  );

  const scored = rules.filter((r) => r.status !== 'skip');
  const weightTotal = scored.reduce((sum, r) => sum + r.weight, 0);
  const weightEarned = scored.reduce((sum, r) => sum + r.weight * (r.status === 'pass' ? 1 : r.status === 'warn' ? 0.5 : 0), 0);
  const score = weightTotal ? Number(((weightEarned / weightTotal) * 100).toFixed(2)) : 0;
  const coverage = Number(((weightTotal / Object.values(WEIGHTS).reduce((a, b) => a + b, 0)) * 100).toFixed(2));
  const corroborationCount = CORROBORATION.filter((id) => rules.find((r) => r.id === id)?.status === 'pass').length;

  // "Inconsistent" means the evidence contradicts itself or the invoice. A
  // missing counterparty, PO or payment is an evidence gap, not a
  // contradiction, and must remain "evidence_insufficient".
  const integrityFailed = rules.some(
    (r) => ['arithmetic', 'date_sanity', 'tax_consistency', 'issuer_match'].includes(r.id) && r.status === 'fail',
  );
  const duplicate = rules.find((r) => r.id === 'number_integrity')?.status === 'fail';

  let status;
  if (invoice.status === 'disputed') status = 'disputed';
  else if (duplicate) status = 'duplicate_suspected';
  else if (integrityFailed) status = 'inconsistent';
  else if (score >= 85 && corroborationCount >= 2 && coverage >= 60) status = 'verified';
  else if (corroborationCount === 0 && !document) status = 'evidence_insufficient';
  else if (score >= 60 && corroborationCount >= 1) status = 'partially_verified';
  else status = 'evidence_insufficient';

  const confidence = Number(((coverage / 100) * (input.fieldConfidence ?? 0.8)).toFixed(4));

  return {
    status,
    score,
    coverage,
    confidence,
    corroborationCount,
    rules,
    methodologyVersion: METHODOLOGY_VERSION,
    weights: WEIGHTS,
    summary: buildSummary(status, score, coverage, corroborationCount, rules),
    limitations: [
      'Verification reflects the evidence available to AFT at the time of the check.',
      'A verified status confirms consistency across at least two independent evidence categories; it is not an audit opinion or a guarantee of payment.',
      'Document text extracted by OCR may contain errors; field-level confidence is reported separately.',
      'Absence of a purchase order, contract or delivery note is recorded as missing evidence, not as proof of fraud.',
    ],
  };
}

function buildSummary(status, score, coverage, corroboration, rules) {
  const failed = rules.filter((r) => r.status === 'fail').map((r) => r.label);
  const labels = {
    verified: 'Evidence is consistent and corroborated across multiple independent sources.',
    partially_verified: 'Some evidence corroborates the invoice, but at least one material check is unmet.',
    inconsistent: 'Material inconsistencies were found in the invoice or its supporting evidence.',
    duplicate_suspected: 'The invoice appears to duplicate an existing record.',
    evidence_insufficient: 'There is not enough independent evidence to verify this invoice.',
    disputed: 'The invoice is recorded as disputed.',
    pending_verification: 'Verification has not been run.',
    verification_in_progress: 'Verification is in progress.',
    rejected: 'The invoice was rejected.',
  };
  return `${labels[status] || status} Evidence score ${score}/100, coverage ${coverage}%, ${corroboration} corroborating categor${corroboration === 1 ? 'y' : 'ies'}.${failed.length ? ` Unmet checks: ${failed.join('; ')}.` : ''}`;
}
