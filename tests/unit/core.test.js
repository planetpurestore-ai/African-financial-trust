import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalJson, sha256Hex } from '../../src/lib/crypto.js';
import { normalizeParam, toSqlDateTime } from '../../src/lib/dates.js';
import { verifyInvoice } from '../../src/modules/invoices/rules.js';

test('canonical JSON sorts keys and mirrors JSON round-trip semantics', () => {
  const input = { z: 1, a: { b: 2, a: 1 }, omitted: undefined, list: [1, undefined, 3] };
  assert.equal(canonicalJson(input), '{"a":{"a":1,"b":2},"list":[1,null,3],"z":1}');
  const roundTripped = JSON.parse(JSON.stringify(input));
  assert.equal(canonicalJson(input), canonicalJson(roundTripped));
});

test('canonical JSON is stable across database JSON normalisation', () => {
  const payload = { score: 82.94, generated_at: new Date('2026-11-24T09:00:00.000Z'), nested: { grade: 'A', empty: null } };
  const stored = JSON.parse(JSON.stringify(payload));
  assert.equal(sha256Hex(canonicalJson(payload)), sha256Hex(canonicalJson(stored)));
});

test('ISO timestamps are normalised for MySQL DATETIME columns', () => {
  assert.equal(toSqlDateTime('2026-11-24T09:00:00.000Z'), '2026-11-24 09:00:00.000');
  assert.equal(normalizeParam('2026-11-24'), '2026-11-24');
  assert.equal(normalizeParam('not-a-date'), 'not-a-date');
});

function baseInvoice(overrides = {}) {
  return {
    invoice_number: 'UNIT-1',
    issue_date: '2026-11-01',
    due_date: '2026-11-30',
    currency_code: 'RWF',
    subtotal: 1_000_000,
    tax_amount: 180_000,
    total_amount: 1_180_000,
    counterparty_id: null,
    ...overrides,
  };
}

const baseInput = {
  business: { legal_name: 'Unit Test Ltd' },
  counterparty: null,
  purchaseOrder: null,
  contract: null,
  delivery: null,
  payments: [],
  transactions: [],
  document: null,
};

test('missing corroboration is evidence_insufficient, not inconsistency', () => {
  const result = verifyInvoice({ ...baseInput, invoice: baseInvoice() });
  assert.equal(result.status, 'evidence_insufficient');
});

test('contradictory arithmetic is inconsistent', () => {
  const result = verifyInvoice({
    ...baseInput,
    invoice: baseInvoice({ total_amount: 1_500_000 }),
  });
  assert.equal(result.status, 'inconsistent');
  assert.equal(result.rules.find((rule) => rule.id === 'arithmetic').status, 'fail');
});

test('a document alone cannot verify an invoice', () => {
  const result = verifyInvoice({
    ...baseInput,
    invoice: baseInvoice(),
    document: { original_filename: 'invoice.pdf', extracted_text: 'Unit Test Ltd invoice UNIT-1', fields: [] },
  });
  assert.notEqual(result.status, 'verified');
  assert.equal(result.corroborationCount, 0);
});
