/**
 * End-to-end API tests against a real MySQL/MariaDB database.
 *
 * The suite deliberately exercises the actual Express application, real SQL,
 * real file ingestion and the real verification engine. No service is mocked.
 * Run with: npm test
 */

import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import PDFDocument from 'pdfkit';

const here = path.dirname(fileURLToPath(import.meta.url));
const storage = await fs.mkdtemp(path.join(os.tmpdir(), 'aft-test-'));

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'mysql://aft:aft_dev_password@127.0.0.1:3306/aft_test';
process.env.STORAGE_DIR = storage;
process.env.JOB_WORKER_ENABLED = 'false';
process.env.LOG_LEVEL = 'error';

const { createApp } = await import('../src/server.js');
const { q, one, closePool } = await import('../src/db/pool.js');
const { runMigrations } = await import('../src/db/migrate.js');
const { ulid } = await import('../src/lib/ids.js');
const { hashPassword, sha256Hex } = await import('../src/lib/crypto.js');

const app = createApp();
const PASSWORD = 'TestPass!2026#Strong';

const ids = {};
let agentAdmin;
let agentBizA;
let agentBizB;
let agentInst;
let agentAuditor;
let csrf = {};
let businessA;
let businessB;
let documentA;
let documentABuffer;
let invoiceA;

function cookieValue(response, name) {
  const cookies = response.headers['set-cookie'] || [];
  for (const cookie of cookies) {
    const [pair] = cookie.split(';');
    const [key, value] = pair.split('=');
    if (key === name) return decodeURIComponent(value);
  }
  return null;
}

async function login(email) {
  const agent = request.agent(app);
  const response = await agent.post('/api/v1/auth/login').send({ email, password: PASSWORD });
  assert.equal(response.status, 200, `login failed for ${email}: ${response.text}`);
  const token = cookieValue(response, 'aft_csrf');
  assert.ok(token, 'CSRF cookie missing');
  return { agent, token };
}

function post(agent, token, url, body = {}) {
  return agent.post(url).set('x-aft-csrf', token).send(body);
}

function patch(agent, token, url, body = {}) {
  return agent.patch(url).set('x-aft-csrf', token).send(body);
}

function makeInvoicePdf({ number = 'TST-001', total = 1_180_000, supplier = 'Test Supplier Ltd' } = {}) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.fontSize(18).text('INVOICE', { align: 'right' });
    doc.moveDown();
    doc.fontSize(10);
    doc.text(`Supplier: ${supplier}`);
    doc.text('Supplier Address: KG 1, Kigali, Rwanda');
    doc.text('Customer: Test Buyer Ltd');
    doc.text(`Invoice Number: ${number}`);
    doc.text('Issue Date: 01/11/2026');
    doc.text('Due Date: 30/11/2026');
    doc.text('Currency: RWF');
    doc.text('Subtotal: 1,000,000');
    doc.text('Tax: 180,000');
    doc.text(`Total: ${total.toLocaleString('en-US')}`);
    doc.text('Description: Test goods');
    doc.end();
  });
}

async function createOrg(name, type, country = 'RW') {
  const id = ulid();
  await q('INSERT INTO organisations (id, name, org_type, country_code) VALUES (?, ?, ?, ?)', [id, name, type, country]);
  return id;
}

async function createUser(orgId, email, name, role) {
  const id = ulid();
  await q(
    'INSERT INTO users (id, org_id, email, password_hash, full_name, role) VALUES (?, ?, ?, ?, ?, ?)',
    [id, orgId, email, hashPassword(PASSWORD), name, role],
  );
  return id;
}

before(async () => {
  await runMigrations({ log: { info() {}, warn() {}, error: console.error } });

  // Clean every application table, preserving the schema.
  const tables = await q(
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'",
  );
  await q('SET FOREIGN_KEY_CHECKS = 0');
  for (const table of tables) {
    if (table.name === 'schema_migrations') continue;
    await q(`TRUNCATE TABLE \`${table.name}\``);
  }
  await q('SET FOREIGN_KEY_CHECKS = 1');

  await q(
    `INSERT INTO country_profiles (country_code, name, currency_code, registration_label, tax_label, mobile_money_providers, registry_source, registry_api_available, verification_notes)
     VALUES ('RW','Rwanda','RWF','RDB registration number','TIN',JSON_ARRAY('MTN MoMo','Airtel Money'),'RDB (manual)',0,'Manual registry verification only'),
            ('KE','Kenya','KES','BRN','KRA PIN',JSON_ARRAY('M-Pesa'),'eCitizen (manual)',0,'Manual registry verification only')`,
  );

  ids.platform = await createOrg('Test Platform', 'platform');
  ids.bizA = await createOrg('Alpha Foods Ltd', 'business');
  ids.bizB = await createOrg('Beta Logistics Ltd', 'business');
  ids.inst = await createOrg('Test Capital', 'institution');

  ids.admin = await createUser(ids.platform, 'admin@test.aft', 'Test Administrator', 'system_admin');
  ids.auditor = await createUser(ids.platform, 'auditor@test.aft', 'Test Auditor', 'auditor');
  ids.userA = await createUser(ids.bizA, 'finance@alpha.test', 'Alpha Finance', 'business_admin');
  ids.userB = await createUser(ids.bizB, 'finance@beta.test', 'Beta Finance', 'business_admin');
  ids.userInst = await createUser(ids.inst, 'analyst@capital.test', 'Institution Analyst', 'institution_analyst');

  agentAdmin = await login('admin@test.aft');
  agentBizA = await login('finance@alpha.test');
  agentBizB = await login('finance@beta.test');
  agentInst = await login('analyst@capital.test');
  agentAuditor = await login('auditor@test.aft');
  csrf = {
    admin: agentAdmin.token,
    bizA: agentBizA.token,
    bizB: agentBizB.token,
    inst: agentInst.token,
    auditor: agentAuditor.token,
  };
});

after(async () => {
  await closePool();
  await fs.rm(storage, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ auth */

test('health endpoint reports a live database connection', async () => {
  const response = await request(app).get('/health');
  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.database, true);
});

test('login rejects an invalid password without disclosing which factor failed', async () => {
  const response = await request(app).post('/api/v1/auth/login').send({ email: 'admin@test.aft', password: 'wrong-password' });
  assert.equal(response.status, 401);
  assert.equal(response.body.error.message, 'Invalid email or password');
});

test('session authentication returns the current user and organisation', async () => {
  const response = await agentAdmin.agent.get('/api/v1/auth/me');
  assert.equal(response.status, 200);
  assert.equal(response.body.data.user.email, 'admin@test.aft');
  assert.equal(response.body.data.role, 'system_admin');
});

test('state-changing session requests require a matching CSRF token', async () => {
  const response = await agentAdmin.agent.post('/api/v1/businesses').send({ legalName: 'No CSRF Ltd', countryCode: 'RW' });
  assert.equal(response.status, 403);
  assert.match(response.body.error.message, /CSRF/i);
});

test('unauthenticated API calls are rejected', async () => {
  const response = await request(app).get('/api/v1/businesses');
  assert.equal(response.status, 401);
});

test('auditor accounts are read-only', async () => {
  const response = await post(agentAuditor.agent, csrf.auditor, '/api/v1/businesses', { legalName: 'Auditor Attempt Ltd', countryCode: 'RW' });
  assert.equal(response.status, 403);
  assert.match(response.body.error.message, /read-only/i);
});

/* ------------------------------------------------------------ businesses */

test('a business admin can register a business owned by their organisation', async () => {
  const response = await post(agentBizA.agent, csrf.bizA, '/api/v1/businesses', {
    legalName: 'Alpha Foods Ltd',
    countryCode: 'RW',
    registrationNumber: 'RDB-ALPHA-001',
    taxId: 'TIN-ALPHA-001',
    industry: 'Food distribution',
    city: 'Kigali',
  });
  assert.equal(response.status, 201, response.text);
  businessA = response.body.data;
  assert.equal(businessA.legal_name, 'Alpha Foods Ltd');
  assert.equal(businessA.verification_status, 'self_declared');
  assert.equal(businessA.owner_org_id, ids.bizA);
});

test('a second business record is isolated from the first tenant', async () => {
  const created = await post(agentBizB.agent, csrf.bizB, '/api/v1/businesses', {
    legalName: 'Beta Logistics Ltd',
    countryCode: 'KE',
    registrationNumber: 'BRN-BETA-002',
  });
  assert.equal(created.status, 201, created.text);
  businessB = created.body.data;

  const crossTenant = await agentBizB.agent.get(`/api/v1/businesses/${businessA.id}`);
  assert.equal(crossTenant.status, 404);

  const ownList = await agentBizB.agent.get('/api/v1/businesses');
  assert.equal(ownList.status, 200);
  assert.deepEqual(ownList.body.data.map((b) => b.id), [businessB.id]);
});

test('an institution without an access grant sees no business records', async () => {
  const response = await agentInst.agent.get('/api/v1/businesses');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data, []);
});

test('invalid business input is rejected with field-level detail', async () => {
  const response = await post(agentBizA.agent, csrf.bizA, '/api/v1/businesses', { legalName: 'X', countryCode: 'RW' });
  assert.equal(response.status, 422);
  assert.equal(response.body.error.code, 'unprocessable');
  assert.ok(Array.isArray(response.body.error.details));
});

/* ------------------------------------------------------------- documents */

test('a PDF invoice can be uploaded, hashed, stored privately and extracted', async () => {
  const pdf = await makeInvoicePdf({ number: 'ALPHA-100', supplier: 'Alpha Foods Ltd' });
  documentABuffer = pdf;
  const response = await agentBizA.agent
    .post('/api/v1/documents')
    .set('x-aft-csrf', csrf.bizA)
    .field('businessId', businessA.id)
    .attach('file', pdf, { filename: 'alpha-invoice-100.pdf', contentType: 'application/pdf' });
  assert.equal(response.status, 201, response.text);
  documentA = response.body.data;
  assert.equal(documentA.original_filename, 'alpha-invoice-100.pdf');
  assert.equal(documentA.mime_type, 'application/pdf');
  assert.match(documentA.content_hash, /^[a-f0-9]{64}$/);
  assert.equal(response.body.duplicate, false);
});

test('the same file is detected as a duplicate by content hash', async () => {
  const response = await agentBizA.agent
    .post('/api/v1/documents')
    .set('x-aft-csrf', csrf.bizA)
    .field('businessId', businessA.id)
    .attach('file', documentABuffer, { filename: 'alpha-invoice-100-copy.pdf', contentType: 'application/pdf' });
  assert.equal(response.status, 201, response.text);
  assert.equal(response.body.duplicate, true);
});

test('document extraction is deterministic and records field provenance', async () => {
  const processed = await post(agentBizA.agent, csrf.bizA, `/api/v1/documents/${documentA.id}/process-now`);
  assert.equal(processed.status, 200, processed.text);
  const detail = await agentBizA.agent.get(`/api/v1/documents/${documentA.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.status, 'extracted');
  assert.ok(detail.body.data.fields.length >= 3, 'expected extracted fields');
  for (const field of detail.body.data.fields) {
    assert.equal(field.provenance, 'document_extracted');
    assert.ok(Number(field.confidence) > 0);
  }
});

test('a cross-tenant document read is refused', async () => {
  const response = await agentBizB.agent.get(`/api/v1/documents/${documentA.id}`);
  assert.equal(response.status, 404);
});

test('the original file is served from durable storage only to an authorised tenant', async () => {
  const allowed = await agentBizA.agent.get(`/api/v1/documents/${documentA.id}/file`);
  assert.equal(allowed.status, 200, allowed.text);
  assert.match(allowed.headers['content-type'], /application\/pdf/);
  assert.equal(allowed.body.subarray(0, 4).toString(), '%PDF');

  const denied = await agentBizB.agent.get(`/api/v1/documents/${documentA.id}/file`);
  assert.equal(denied.status, 404);
});

test('unsupported upload types are rejected', async () => {
  const response = await agentBizA.agent
    .post('/api/v1/documents')
    .set('x-aft-csrf', csrf.bizA)
    .field('businessId', businessA.id)
    .attach('file', Buffer.from('MZ executable'), { filename: 'malware.exe', contentType: 'application/x-msdownload' });
  assert.equal(response.status, 400);
});

/* -------------------------------------------------------------- invoices */

test('an invoice with no corroborating evidence is not marked verified', async () => {
  const created = await post(agentBizA.agent, csrf.bizA, '/api/v1/invoices', {
    businessId: businessA.id,
    invoiceNumber: 'ALPHA-100',
    issueDate: '2026-11-01',
    dueDate: '2026-11-30',
    currency: 'RWF',
    subtotal: 1_000_000,
    taxAmount: 180_000,
    totalAmount: 1_180_000,
    documentId: documentA.id,
  });
  assert.equal(created.status, 201, created.text);
  invoiceA = created.body.data;

  const verified = await post(agentBizA.agent, csrf.bizA, `/api/v1/invoices/${invoiceA.id}/verify`);
  assert.equal(verified.status, 200, verified.text);
  assert.notEqual(verified.body.data.result.status, 'verified');
  assert.equal(verified.body.data.result.status, 'evidence_insufficient');
});

test('invoice arithmetic is checked against its line items', async () => {
  const created = await post(agentBizA.agent, csrf.bizA, '/api/v1/invoices', {
    businessId: businessA.id,
    invoiceNumber: 'ALPHA-101',
    issueDate: '2026-11-02',
    currency: 'RWF',
    subtotal: 1_000_000,
    taxAmount: 180_000,
    totalAmount: 1_500_000,
    lines: [{ description: 'Goods', quantity: 1, unitPrice: 1_000_000, lineTotal: 1_000_000, taxRate: 18 }],
  });
  assert.equal(created.status, 201, created.text);
  const verified = await post(agentBizA.agent, csrf.bizA, `/api/v1/invoices/${created.body.data.id}/verify`);
  assert.equal(verified.status, 200, verified.text);
  assert.notEqual(verified.body.data.result.status, 'verified');
  const arithmetic = verified.body.data.result.rules.find((rule) => rule.id === 'arithmetic');
  assert.ok(arithmetic);
  assert.notEqual(arithmetic.status, 'pass');
});

test('a corroborated invoice becomes verified after PO, delivery, payment and counterparty confirmation', async () => {
  const counterparty = await post(agentBizA.agent, csrf.bizA, '/api/v1/counterparties', {
    businessId: businessA.id,
    name: 'Test Buyer Ltd',
    countryCode: 'RW',
    relationship: 'customer',
    email: 'ap@buyer.test',
  });
  assert.equal(counterparty.status, 201, counterparty.text);
  const cp = counterparty.body.data;

  const invoice = await post(agentBizA.agent, csrf.bizA, '/api/v1/invoices', {
    businessId: businessA.id,
    counterpartyId: cp.id,
    invoiceNumber: 'ALPHA-102',
    issueDate: '2026-11-01',
    dueDate: '2026-12-01',
    currency: 'RWF',
    subtotal: 1_000_000,
    taxAmount: 180_000,
    totalAmount: 1_180_000,
    poNumber: 'PO-ALPHA-77',
  });
  assert.equal(invoice.status, 201, invoice.text);
  const inv = invoice.body.data;

  const po = await post(agentBizA.agent, csrf.bizA, '/api/v1/commercial/purchase-orders', {
    businessId: businessA.id,
    counterpartyId: cp.id,
    poNumber: 'PO-ALPHA-77',
    issueDate: '2026-10-28',
    currency: 'RWF',
    totalAmount: 1_180_000,
  });
  assert.equal(po.status, 201, po.text);

  const delivery = await post(agentBizA.agent, csrf.bizA, '/api/v1/commercial/delivery-evidence', {
    businessId: businessA.id,
    invoiceId: inv.id,
    deliveryNoteNumber: 'DN-ALPHA-1',
    deliveryDate: '2026-11-05',
    recipientName: 'Test Buyer Ltd',
  });
  assert.equal(delivery.status, 201, delivery.text);

  const payment = await post(agentBizA.agent, csrf.bizA, `/api/v1/invoices/${inv.id}/payments`, {
    amount: 1_180_000,
    currency: 'RWF',
    paidAt: '2026-11-10',
    method: 'bank_transfer',
    reference: 'BNK-ALPHA-102',
  });
  assert.equal(payment.status, 201, payment.text);

  const confirmation = await post(agentBizA.agent, csrf.bizA, `/api/v1/counterparties/${cp.id}/request-confirmation`, {
    invoiceId: inv.id,
    baseUrl: 'https://test.local',
  });
  assert.equal(confirmation.status, 201, confirmation.text);
  const token = confirmation.body.data.token;
  const answer = await request(app).post(`/api/v1/counterparty-confirmations/${token}`).send({
    decision: 'confirm',
    name: 'Test Buyer Ltd',
    email: 'ap@buyer.test',
  });
  assert.equal(answer.status, 200, answer.text);

  const verified = await post(agentBizA.agent, csrf.bizA, `/api/v1/invoices/${inv.id}/verify`);
  assert.equal(verified.status, 200, verified.text);
  assert.equal(verified.body.data.result.status, 'verified', JSON.stringify(verified.body.data.result.rules));
  assert.ok(verified.body.data.result.score >= 80);
});

test('duplicate invoice numbers within a business are flagged', async () => {
  const duplicate = await post(agentBizA.agent, csrf.bizA, '/api/v1/invoices', {
    businessId: businessA.id,
    invoiceNumber: 'ALPHA-102',
    issueDate: '2026-11-01',
    currency: 'RWF',
    totalAmount: 1_180_000,
  });
  assert.equal(duplicate.status, 201, duplicate.text);
  const verified = await post(agentBizA.agent, csrf.bizA, `/api/v1/invoices/${duplicate.body.data.id}/verify`);
  assert.equal(verified.status, 200, verified.text);
  assert.equal(verified.body.data.result.status, 'duplicate_suspected');
});

/* -------------------------------------------------------- reconciliation */

test('a bank statement can be imported and reconciled, and an accepted match creates a payment', async () => {
  const importResponse = await agentBizA.agent
    .post('/api/v1/transactions/import')
    .set('x-aft-csrf', csrf.bizA)
    .field('businessId', businessA.id)
    .field('sourceType', 'bank')
    .field('provider', 'Test Bank')
    .attach('file', Buffer.from('Transaction Date,Amount,Currency,Reference,Description,Counterparty\n05/11/2026,1180000.00,RWF,ALPHA-102,Incoming payment,Test Buyer Ltd\n'), {
      filename: 'statement.csv',
      contentType: 'text/csv',
    });
  assert.equal(importResponse.status, 201, importResponse.text);

  const run = await post(agentBizA.agent, csrf.bizA, '/api/v1/reconciliation/run', { businessId: businessA.id });
  assert.equal(run.status, 201, run.text);
  const recon = run.body.data;
  assert.ok(recon.stats.probable + recon.stats.exact + recon.stats.partial >= 1, JSON.stringify(recon.stats));

  const detail = await agentBizA.agent.get(`/api/v1/reconciliation/${recon.id}`);
  assert.equal(detail.status, 200);
  const match = detail.body.data.matches.find((m) => m.status === 'suggested' && m.invoice_id);
  assert.ok(match, 'expected a suggested match');

  const accepted = await post(agentBizA.agent, csrf.bizA, `/api/v1/reconciliation/matches/${match.id}/accept`);
  assert.equal(accepted.status, 200, accepted.text);

  const invoice = await agentBizA.agent.get(`/api/v1/invoices/${match.invoice_id}`);
  assert.equal(invoice.status, 200);
  assert.ok(invoice.body.data.payments.some((p) => p.source === 'reconciliation'));
});

/* ------------------------------------------------------------ trust record */

test('a trust record is versioned, hashed and chained to its predecessor', async () => {
  const first = await post(agentBizA.agent, csrf.bizA, `/api/v1/businesses/${businessA.id}/trust-record/generate`);
  assert.equal(first.status, 201, first.text);
  const record = first.body.data;
  assert.equal(record.version, 1);
  assert.match(record.hash, /^[a-f0-9]{64}$/);
  assert.equal(record.previous_hash, null);
  assert.ok(record.evidence.length >= 5);

  const verified = await agentBizA.agent.get(`/api/v1/trust-records/${record.id}/verify-hash`);
  assert.equal(verified.status, 200);
  assert.equal(verified.body.data.valid, true);

  const second = await post(agentBizA.agent, csrf.bizA, `/api/v1/businesses/${businessA.id}/trust-record/generate`);
  assert.equal(second.status, 201, second.text);
  assert.equal(second.body.data.version, 2);
  assert.equal(second.body.data.previous_hash, record.hash);
});

test('an institution can read a trust record only after an explicit access grant', async () => {
  const before = await agentInst.agent.get(`/api/v1/businesses/${businessA.id}/trust-record`);
  assert.equal(before.status, 404);

  const grant = await post(agentBizA.agent, csrf.bizA, `/api/v1/businesses/${businessA.id}/access-grants`, {
    institutionOrgId: ids.inst,
    scopes: ['trust_record.read'],
    purpose: 'Credit assessment',
  });
  assert.equal(grant.status, 201, grant.text);

  const after = await agentInst.agent.get(`/api/v1/businesses/${businessA.id}/trust-record`);
  assert.equal(after.status, 200, after.text);
  assert.equal(after.body.data.business_id, businessA.id);
});

test('an access grant is limited to its declared scopes', async () => {
  const grants = await agentBizA.agent.get(`/api/v1/businesses/${businessA.id}/access-grants`);
  assert.equal(grants.status, 200, grants.text);
  for (const grant of grants.body.data) {
    await agentBizA.agent.delete(`/api/v1/businesses/access-grants/${grant.id}`).set('x-aft-csrf', csrf.bizA);
  }

  const invoicesOnly = await post(agentBizA.agent, csrf.bizA, `/api/v1/businesses/${businessA.id}/access-grants`, {
    institutionOrgId: ids.inst,
    scopes: ['invoices.read'],
    purpose: 'Invoice review only',
  });
  assert.equal(invoicesOnly.status, 201, invoicesOnly.text);

  const invoices = await agentInst.agent.get(`/api/v1/invoices?businessId=${businessA.id}`);
  assert.equal(invoices.status, 200, invoices.text);

  const documents = await agentInst.agent.get(`/api/v1/documents?businessId=${businessA.id}`);
  assert.equal(documents.status, 404);

  const trust = await agentInst.agent.get(`/api/v1/businesses/${businessA.id}/trust-record`);
  assert.equal(trust.status, 404);
});

/* ------------------------------------------------------------ audit chain */

test('the audit chain verifies and detects tampering', async () => {
  const before = await agentAdmin.agent.get('/api/v1/audit/verify');
  assert.equal(before.status, 200);
  assert.equal(before.body.data.valid, true);

  const entry = await one('SELECT id, action FROM audit_logs WHERE org_id = ? ORDER BY seq LIMIT 1', [ids.bizA]);
  assert.ok(entry, 'expected at least one audit entry');
  await q("UPDATE audit_logs SET action = 'tampered.action' WHERE id = ?", [entry.id]);

  const after = await agentBizA.agent.get('/api/v1/audit/verify');
  assert.equal(after.status, 200);
  assert.equal(after.body.data.valid, false);

  await q('UPDATE audit_logs SET action = ? WHERE id = ?', [entry.action, entry.id]);
  const restored = await agentBizA.agent.get('/api/v1/audit/verify');
  assert.equal(restored.body.data.valid, true);
});

/* ---------------------------------------------------------------- API keys */

test('an API key authenticates without a CSRF token and can be revoked', async () => {
  const created = await post(agentBizA.agent, csrf.bizA, '/api/v1/api-keys', { name: 'Integration key', role: 'business_admin', scopes: ['business.read'] });
  assert.equal(created.status, 201, created.text);
  const key = created.body.data.key;
  assert.match(key, /^aft_/);

  const read = await request(app).get('/api/v1/businesses').set('authorization', `Bearer ${key}`);
  assert.equal(read.status, 200, read.text);
  assert.equal(read.body.data.length, 1);

  const revoke = await agentBizA.agent.delete(`/api/v1/api-keys/${created.body.data.id}`).set('x-aft-csrf', csrf.bizA);
  assert.equal(revoke.status, 200, revoke.text);

  const denied = await request(app).get('/api/v1/businesses').set('authorization', `Bearer ${key}`);
  assert.equal(denied.status, 401);
});

test('an API key cannot exceed its declared scopes', async () => {
  const created = await post(agentBizA.agent, csrf.bizA, '/api/v1/api-keys', {
    name: 'Invoice-only key',
    role: 'business_admin',
    scopes: ['invoices.read'],
  });
  assert.equal(created.status, 201, created.text);
  const key = created.body.data.key;

  const invoices = await request(app)
    .get(`/api/v1/invoices?businessId=${businessA.id}`)
    .set('authorization', `Bearer ${key}`);
  assert.equal(invoices.status, 200, invoices.text);

  const businesses = await request(app).get('/api/v1/businesses').set('authorization', `Bearer ${key}`);
  assert.equal(businesses.status, 403);

  const audit = await request(app).get('/api/v1/audit').set('authorization', `Bearer ${key}`);
  assert.equal(audit.status, 403);

  await agentBizA.agent.delete(`/api/v1/api-keys/${created.body.data.id}`).set('x-aft-csrf', csrf.bizA);
});

/* -------------------------------------------------------------- contract */

test('the OpenAPI contract is served and describes the v1 API', async () => {
  const response = await request(app).get('/api/v1/openapi.json');
  assert.equal(response.status, 200);
  assert.equal(response.body.openapi, '3.1.0');
  assert.ok(response.body.paths['/businesses']);
  assert.ok(response.body.paths['/invoices/{id}/verify']);
});

test('unknown API routes return a structured error rather than HTML', async () => {
  const response = await request(app).get('/api/v1/does-not-exist');
  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'not_found');
});

/* Keep a reference so the storage hash helper is exercised. */
test('content hashing is stable', () => {
  assert.equal(sha256Hex('aft'), sha256Hex('aft'));
  assert.notEqual(sha256Hex('aft'), sha256Hex('AFT'));
});
