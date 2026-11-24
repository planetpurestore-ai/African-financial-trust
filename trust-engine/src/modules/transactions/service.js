import { parse as parseCsv } from 'csv-parse/sync';
import { z } from 'zod';
import { many, one, q, withTransaction } from '../../db/pool.js';
import { writeAudit } from '../../lib/audit.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { ulid } from '../../lib/ids.js';
import { currency, isoDate } from '../../lib/validate.js';
import { parseAmount, parseDate } from '../extraction/fields.js';

const HEADER_HINTS = {
  date: ['date', 'value date', 'transaction date', 'posted', 'posting date', 'time'],
  amount: ['amount', 'value', 'transaction amount', 'credit', 'debit'],
  currency: ['currency', 'ccy', 'curr'],
  reference: ['reference', 'ref', 'transaction id', 'receipt no', 'invoice', 'narration'],
  description: ['description', 'narration', 'details', 'particulars', 'memo'],
  counterparty: ['counterparty', 'payer', 'payee', 'name', 'customer', 'supplier'],
  externalId: ['id', 'transaction id', 'txn id', 'receipt', 'code'],
  direction: ['direction', 'type', 'dr/cr', 'debit/credit'],
  fee: ['fee', 'charges', 'commission'],
};

function guessMapping(headers) {
  const mapping = {};
  for (const [field, hints] of Object.entries(HEADER_HINTS)) {
    const found = headers.find((h) => hints.some((hint) => String(h).toLowerCase().trim() === hint));
    if (found) mapping[field] = found;
  }
  return mapping;
}

function pick(row, mapping, field) {
  const key = mapping[field];
  if (!key) return null;
  const value = row[key];
  return value === undefined || value === '' ? null : value;
}

export const importSchema = z.object({
  businessId: z.string().length(26),
  sourceType: z.enum(['bank', 'mobile_money', 'payment_provider', 'accounting', 'manual']),
  provider: z.string().max(60).optional().nullable(),
  currency: currency.optional(),
  mapping: z.record(z.string()).optional(),
  rows: z.array(z.record(z.any())).max(5000).optional(),
});

export function parseCsvRows(buffer) {
  return parseCsv(buffer.toString('utf8'), { columns: true, skipEmptyLines: true, relaxColumnCount: true, bom: true });
}

export async function importTransactions(auth, input, { rows, filename } = {}) {
  const dataRows = rows || input.rows;
  if (!Array.isArray(dataRows) || !dataRows.length) throw badRequest('No transaction rows supplied');
  if (dataRows.length > 5000) throw badRequest('A single import is limited to 5000 rows');

  const headers = Object.keys(dataRows[0]);
  const mapping = { ...guessMapping(headers), ...(input.mapping || {}) };
  if (!mapping.date || !mapping.amount) throw badRequest('Could not identify date and amount columns; supply a mapping', { headers });

  return withTransaction(async (conn) => {
    const batchId = ulid();
    let imported = 0;
    let duplicates = 0;
    let failed = 0;
    const errors = [];

    await conn.query(
      `INSERT INTO import_batches (id, business_id, source_type, provider, filename, row_count, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 'running', ?)`,
      [batchId, input.businessId, input.sourceType, input.provider ?? null, filename ?? null, dataRows.length, auth.user?.id ?? null],
    );

    for (const [index, row] of dataRows.entries()) {
      try {
        const date = parseDate(String(pick(row, mapping, 'date') || ''));
        if (!date) throw new Error('Unparseable date');
        let amount = parseAmount(pick(row, mapping, 'amount'));
        if (amount === null) throw new Error('Unparseable amount');
        let direction = String(pick(row, mapping, 'direction') || '').toLowerCase();
        if (!direction) direction = amount < 0 ? 'debit' : 'credit';
        if (direction.startsWith('d') || direction.includes('debit')) direction = 'debit';
        else if (direction.startsWith('c') || direction.includes('credit')) direction = 'credit';
        else direction = amount < 0 ? 'debit' : 'credit';
        amount = Math.abs(amount);
        const curr = String(pick(row, mapping, 'currency') || input.currency || 'RWF').toUpperCase().slice(0, 3);
        const reference = pick(row, mapping, 'reference');
        const externalId = pick(row, mapping, 'externalId') || reference || `${date}-${amount}-${index}`;
        const description = pick(row, mapping, 'description');
        const counterparty = pick(row, mapping, 'counterparty');
        const fee = parseAmount(pick(row, mapping, 'fee')) || 0;

        const [result] = await conn.query(
          `INSERT INTO transactions (id, business_id, batch_id, source_type, provider, external_id, direction, amount,
            fee_amount, currency_code, value_date, reference, description, counterparty_name, raw_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE id = id`,
          [
            ulid(),
            input.businessId,
            batchId,
            input.sourceType,
            input.provider ?? null,
            String(externalId).slice(0, 160),
            direction,
            amount,
            fee,
            curr,
            date,
            reference ? String(reference).slice(0, 160) : null,
            description ? String(description).slice(0, 500) : null,
            counterparty ? String(counterparty).slice(0, 255) : null,
            JSON.stringify(row),
          ],
        );
        if (result.affectedRows === 1) imported += 1;
        else duplicates += 1;
      } catch (error) {
        failed += 1;
        if (errors.length < 20) errors.push({ row: index + 2, error: error.message });
      }
    }

    await conn.query(
      'UPDATE import_batches SET imported = ?, duplicates = ?, failed = ?, status = ? WHERE id = ?',
      [imported, duplicates, failed, failed === dataRows.length ? 'failed' : 'completed', batchId],
    );
    await writeAudit(conn, {
      orgId: auth.org.id,
      actorType: auth.type,
      actorId: auth.user?.id ?? auth.apiKeyId,
      action: 'transactions.imported',
      entityType: 'import_batch',
      entityId: batchId,
      metadata: { business_id: input.businessId, rows: dataRows.length, imported, duplicates, failed },
    });
    return { batchId, rows: dataRows.length, imported, duplicates, failed, errors, mapping };
  });
}

export async function createTransaction(auth, input) {
  const id = ulid();
  await q(
    `INSERT INTO transactions (id, business_id, source_type, provider, external_id, direction, amount, fee_amount, currency_code,
      value_date, posted_at, reference, description, counterparty_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.businessId,
      input.sourceType,
      input.provider ?? null,
      input.externalId ?? null,
      input.direction,
      input.amount,
      input.fee ?? 0,
      input.currency,
      input.valueDate,
      input.postedAt ?? null,
      input.reference ?? null,
      input.description ?? null,
      input.counterpartyName ?? null,
    ],
  );
  return one('SELECT * FROM transactions WHERE id = ?', [id]);
}

export async function listTransactions({ businessId, sourceType, from, to, limit, offset }) {
  const clauses = ['business_id = ?'];
  const params = [businessId];
  if (sourceType) {
    clauses.push('source_type = ?');
    params.push(sourceType);
  }
  if (from) {
    clauses.push('value_date >= ?');
    params.push(from);
  }
  if (to) {
    clauses.push('value_date <= ?');
    params.push(to);
  }
  const where = clauses.join(' AND ');
  const [{ total }] = await many(`SELECT COUNT(*) AS total FROM transactions WHERE ${where}`, params);
  const rows = await many(`SELECT * FROM transactions WHERE ${where} ORDER BY value_date DESC, created_at DESC LIMIT ? OFFSET ?`, [
    ...params,
    limit,
    offset,
  ]);
  return { rows, total: Number(total) };
}

export async function transactionStats(businessId) {
  const rows = await many(
    `SELECT source_type, direction, COUNT(*) AS count, COALESCE(SUM(amount),0) AS total
       FROM transactions WHERE business_id = ? GROUP BY source_type, direction`,
    [businessId],
  );
  return rows.map((r) => ({ ...r, count: Number(r.count), total: Number(r.total) }));
}

export async function getTransaction(id) {
  const txn = await one('SELECT * FROM transactions WHERE id = ?', [id]);
  if (!txn) throw notFound('Transaction not found');
  return txn;
}
