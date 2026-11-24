import { many, one, withTransaction } from '../../db/pool.js';
import { writeAudit } from '../../lib/audit.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { ulid } from '../../lib/ids.js';

export const DEFAULT_RULES = {
  amountAbsolute: 1,
  amountPercent: 0.5,
  dateWindowDays: 10,
  exactThreshold: 0.9,
  probableThreshold: 0.7,
  partialThreshold: 0.45,
  minPartialPercent: 10,
};

function money(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function daysBetween(a, b) {
  return Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86_400_000);
}

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function scorePair(invoice, transaction, rules) {
  const components = [];
  let score = 0;
  const total = money(invoice.total_amount);
  const balance = money(invoice.balance_due || total);
  const amount = money(transaction.amount);
  const absoluteTolerance = Math.max(Number(rules.amountAbsolute || 0), (total * Number(rules.amountPercent || 0)) / 100);

  if (Math.abs(amount - total) <= absoluteTolerance) {
    score += 0.45;
    components.push({ factor: 'amount', outcome: 'exact', detail: `Amount ${amount} equals invoice total ${total} within tolerance ${money(absoluteTolerance)}`, points: 0.45 });
  } else if (Math.abs(amount - balance) <= absoluteTolerance) {
    score += 0.42;
    components.push({ factor: 'amount', outcome: 'balance', detail: `Amount ${amount} settles the outstanding balance ${balance}`, points: 0.42 });
  } else if (amount < total && amount >= (total * Number(rules.minPartialPercent || 10)) / 100) {
    score += 0.18;
    components.push({ factor: 'amount', outcome: 'partial', detail: `Amount ${amount} is a partial payment of ${total}`, points: 0.18 });
  } else {
    components.push({ factor: 'amount', outcome: 'mismatch', detail: `Amount ${amount} does not align with ${total}`, points: 0 });
  }

  const reference = normalize(transaction.reference);
  const invoiceNumber = normalize(invoice.invoice_number);
  if (reference && invoiceNumber && (reference.includes(invoiceNumber) || invoiceNumber.includes(reference))) {
    score += 0.3;
    components.push({ factor: 'reference', outcome: 'match', detail: `Reference "${transaction.reference}" contains invoice number ${invoice.invoice_number}`, points: 0.3 });
  } else if (transaction.reference) {
    components.push({ factor: 'reference', outcome: 'none', detail: `Reference "${transaction.reference}" does not cite the invoice number`, points: 0 });
  }

  const dayGap = daysBetween(transaction.value_date, invoice.issue_date);
  const window = Number(rules.dateWindowDays || 10);
  if (dayGap <= window) {
    const points = 0.15 * (1 - dayGap / (window + 1));
    score += points;
    components.push({ factor: 'date', outcome: 'within_window', detail: `Transaction is ${dayGap.toFixed(0)} day(s) from the invoice date (window ${window})`, points: Number(points.toFixed(3)) });
  } else {
    components.push({ factor: 'date', outcome: 'outside_window', detail: `Transaction is ${dayGap.toFixed(0)} day(s) from the invoice date (window ${window})`, points: 0 });
  }

  if (transaction.counterparty_name && invoice.counterparty_name) {
    const a = normalize(transaction.counterparty_name);
    const b = normalize(invoice.counterparty_name);
    if (a && b && (a.includes(b) || b.includes(a))) {
      score += 0.1;
      components.push({ factor: 'counterparty', outcome: 'match', detail: `Counterparty "${transaction.counterparty_name}" matches the invoice counterparty`, points: 0.1 });
    }
  }

  if (transaction.currency_code !== invoice.currency_code) {
    score -= 0.1;
    components.push({ factor: 'currency', outcome: 'mismatch', detail: `Currency ${transaction.currency_code} differs from invoice currency ${invoice.currency_code}`, points: -0.1 });
  } else {
    components.push({ factor: 'currency', outcome: 'match', detail: 'Currencies agree', points: 0 });
  }

  score = Math.max(0, Math.min(1, score));
  let matchType = 'unmatched';
  if (score >= Number(rules.exactThreshold || 0.9)) matchType = 'exact';
  else if (score >= Number(rules.probableThreshold || 0.7)) matchType = 'probable';
  else if (score >= Number(rules.partialThreshold || 0.45)) matchType = 'partial';

  return {
    score: Number(score.toFixed(4)),
    matchType,
    components,
    amountApplied: matchType === 'unmatched' ? 0 : Math.min(amount, balance),
    explanation: components.filter((c) => c.points !== 0).map((c) => c.detail).join('; ') || 'No scoring factors matched',
  };
}

export async function runReconciliation(auth, { businessId, rules: overrideRules = {}, from, to }, ctx = {}) {
  const settings = await one(
    `SELECT s.reconciliation_rules FROM org_settings s JOIN businesses b ON b.owner_org_id = s.org_id WHERE b.id = ?`,
    [businessId],
  );
  const stored = settings?.reconciliation_rules
    ? typeof settings.reconciliation_rules === 'string'
      ? JSON.parse(settings.reconciliation_rules)
      : settings.reconciliation_rules
    : {};
  const rules = { ...DEFAULT_RULES, ...stored, ...overrideRules };

  const invoiceClauses = ["i.business_id = ?", "i.status IN ('issued','partially_paid','overdue')", 'i.balance_due > 0'];
  const invoiceParams = [businessId];
  if (from) {
    invoiceClauses.push('i.issue_date >= ?');
    invoiceParams.push(from);
  }
  if (to) {
    invoiceClauses.push('i.issue_date <= ?');
    invoiceParams.push(to);
  }
  const invoices = await many(
    `SELECT i.*, c.name AS counterparty_name FROM invoices i LEFT JOIN counterparties c ON c.id = i.counterparty_id
      WHERE ${invoiceClauses.join(' AND ')} ORDER BY i.issue_date`,
    invoiceParams,
  );

  const txnClauses = ["business_id = ?", "source_type IN ('bank','mobile_money','payment_provider','accounting','manual')"];
  const txnParams = [businessId];
  if (from) {
    txnClauses.push('value_date >= ?');
    txnParams.push(from);
  }
  if (to) {
    txnClauses.push('value_date <= ?');
    txnParams.push(to);
  }
  const transactions = await many(`SELECT * FROM transactions WHERE ${txnClauses.join(' AND ')} ORDER BY value_date`, txnParams);

  const candidates = [];
  for (const invoice of invoices) {
    for (const transaction of transactions) {
      if (transaction.currency_code !== invoice.currency_code) continue;
      const scored = scorePair(invoice, transaction, rules);
      if (scored.matchType !== 'unmatched') candidates.push({ invoice, transaction, ...scored });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const usedTransactions = new Set();
  const invoiceRemaining = new Map(invoices.map((i) => [i.id, money(i.balance_due)]));
  const accepted = [];
  for (const candidate of candidates) {
    if (usedTransactions.has(candidate.transaction.id)) continue;
    const remaining = invoiceRemaining.get(candidate.invoice.id);
    if (!remaining || remaining <= 0) continue;
    if (candidate.amountApplied > remaining + 0.01 && candidate.matchType !== 'partial') continue;
    const applied = Math.min(candidate.amountApplied, remaining);
    invoiceRemaining.set(candidate.invoice.id, money(remaining - applied));
    usedTransactions.add(candidate.transaction.id);
    accepted.push({ ...candidate, amountApplied: money(applied) });
  }

  const matchedInvoiceIds = new Set(accepted.map((c) => c.invoice.id));
  const unmatchedInvoices = invoices.filter((i) => !matchedInvoiceIds.has(i.id));
  const unmatchedTransactions = transactions.filter((t) => !usedTransactions.has(t.id));

  return withTransaction(async (conn) => {
    const reconciliationId = ulid();
    const stats = {
      invoices: invoices.length,
      transactions: transactions.length,
      exact: accepted.filter((c) => c.matchType === 'exact').length,
      probable: accepted.filter((c) => c.matchType === 'probable').length,
      partial: accepted.filter((c) => c.matchType === 'partial').length,
      unmatched_invoices: unmatchedInvoices.length,
      unmatched_transactions: unmatchedTransactions.length,
      matched_value: money(accepted.reduce((s, c) => s + c.amountApplied, 0)),
    };
    await conn.query(
      `INSERT INTO reconciliations (id, business_id, status, rules_json, stats_json, transaction_count, invoice_count, run_by_user_id)
       VALUES (?, ?, 'completed', ?, ?, ?, ?, ?)`,
      [reconciliationId, businessId, JSON.stringify(rules), JSON.stringify(stats), transactions.length, invoices.length, auth.user?.id ?? null],
    );

    for (const candidate of accepted) {
      await conn.query(
        `INSERT INTO reconciliation_matches (id, reconciliation_id, invoice_id, transaction_id, match_type, score, amount_applied,
          currency_code, differences_json, explanation_json, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'suggested')`,
        [
          ulid(),
          reconciliationId,
          candidate.invoice.id,
          candidate.transaction.id,
          candidate.matchType,
          candidate.score,
          candidate.amountApplied,
          candidate.invoice.currency_code,
          JSON.stringify({ components: candidate.components }),
          JSON.stringify({ summary: candidate.explanation, components: candidate.components }),
        ],
      );
    }
    for (const invoice of unmatchedInvoices) {
      await conn.query(
        `INSERT INTO reconciliation_matches (id, reconciliation_id, invoice_id, transaction_id, match_type, score, amount_applied,
          currency_code, explanation_json, status)
         VALUES (?, ?, ?, NULL, 'unmatched', 0, 0, ?, ?, 'suggested')`,
        [ulid(), reconciliationId, invoice.id, invoice.currency_code, JSON.stringify({ summary: 'No transaction in the period matched this invoice' })],
      );
    }
    for (const transaction of unmatchedTransactions.slice(0, 500)) {
      await conn.query(
        `INSERT INTO reconciliation_matches (id, reconciliation_id, invoice_id, transaction_id, match_type, score, amount_applied,
          currency_code, explanation_json, status)
         VALUES (?, ?, NULL, ?, 'unmatched', 0, 0, ?, ?, 'suggested')`,
        [ulid(), reconciliationId, transaction.id, transaction.currency_code, JSON.stringify({ summary: 'No open invoice matched this transaction' })],
      );
    }
    await writeAudit(conn, {
      orgId: auth.org.id,
      actorType: auth.type,
      actorId: auth.user?.id ?? auth.apiKeyId,
      action: 'reconciliation.run',
      entityType: 'reconciliation',
      entityId: reconciliationId,
      metadata: { business_id: businessId, stats },
      ip: ctx.ip,
    });
    return { id: reconciliationId, stats, rules };
  });
}

export async function listReconciliations(businessId, limit = 20) {
  return many(
    `SELECT r.*, u.full_name AS run_by_name FROM reconciliations r LEFT JOIN users u ON u.id = r.run_by_user_id
      WHERE r.business_id = ? ORDER BY r.created_at DESC LIMIT ?`,
    [businessId, limit],
  );
}

export async function getReconciliation(id) {
  const recon = await one('SELECT * FROM reconciliations WHERE id = ?', [id]);
  if (!recon) throw notFound('Reconciliation not found');
  const matches = await many(
    `SELECT m.*, i.invoice_number, i.issue_date, i.total_amount, i.balance_due, t.reference AS transaction_reference,
            t.value_date AS transaction_date, t.amount AS transaction_amount, t.counterparty_name
       FROM reconciliation_matches m
       LEFT JOIN invoices i ON i.id = m.invoice_id
       LEFT JOIN transactions t ON t.id = m.transaction_id
      WHERE m.reconciliation_id = ? ORDER BY m.match_type, m.score DESC`,
    [id],
  );
  return { ...recon, matches: matches.map((m) => ({ ...m, explanation: parseJson(m.explanation_json) })) };
}

function parseJson(v) {
  if (!v) return null;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

export async function reviewMatch(auth, matchId, decision, ctx = {}) {
  if (!['accepted', 'rejected'].includes(decision)) throw badRequest('decision must be accepted or rejected');
  return withTransaction(async (conn) => {
    const [rows] = await conn.query(
      `SELECT m.*, r.business_id FROM reconciliation_matches m JOIN reconciliations r ON r.id = m.reconciliation_id
        WHERE m.id = ? FOR UPDATE`,
      [matchId],
    );
    const match = rows[0];
    if (!match) throw notFound('Match not found');
    if (match.status !== 'suggested') throw badRequest('This match has already been reviewed');
    if (match.match_type === 'unmatched') throw badRequest('Unmatched records cannot be accepted as a match');

    await conn.query('UPDATE reconciliation_matches SET status = ?, reviewed_by = ?, reviewed_at = NOW(3) WHERE id = ?', [
      decision,
      auth.user?.id ?? null,
      matchId,
    ]);

    if (decision === 'accepted' && match.invoice_id && match.transaction_id) {
      const [invoiceRows] = await conn.query('SELECT * FROM invoices WHERE id = ? FOR UPDATE', [match.invoice_id]);
      const invoice = invoiceRows[0];
      const paymentId = ulid();
      await conn.query(
        `INSERT INTO payment_records (id, business_id, invoice_id, transaction_id, amount, currency_code, paid_at, method, reference, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'reconciliation')`,
        [
          paymentId,
          invoice.business_id,
          invoice.id,
          match.transaction_id,
          match.amount_applied,
          match.currency_code,
          new Date(),
          'bank_transfer',
          `Reconciled match ${matchId}`,
        ],
      );
      const [paidRows] = await conn.query('SELECT COALESCE(SUM(amount),0) AS paid FROM payment_records WHERE invoice_id = ?', [invoice.id]);
      const paid = money(paidRows[0].paid);
      const balance = money(Number(invoice.total_amount) - paid);
      await conn.query('UPDATE invoices SET amount_paid = ?, balance_due = ?, status = ? WHERE id = ?', [
        paid,
        balance,
        balance <= 0.005 ? 'paid' : 'partially_paid',
        invoice.id,
      ]);
    }

    await writeAudit(conn, {
      orgId: auth.org.id,
      actorType: auth.type,
      actorId: auth.user?.id ?? auth.apiKeyId,
      action: `reconciliation.match_${decision}`,
      entityType: 'reconciliation_match',
      entityId: matchId,
      metadata: { invoice_id: match.invoice_id, transaction_id: match.transaction_id, amount: match.amount_applied },
      ip: ctx.ip,
    });
    return { id: matchId, status: decision };
  });
}
