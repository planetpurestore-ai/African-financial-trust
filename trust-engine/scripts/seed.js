import 'dotenv/config';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { config } from '../src/config.js';
import { many, one, q, withTransaction } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { hashPassword } from '../src/lib/crypto.js';
import { ulid } from '../src/lib/ids.js';
import { createBusiness } from '../src/modules/businesses/service.js';
import { createCounterparty, requestConfirmation, respondToConfirmation } from '../src/modules/counterparties/service.js';
import { ingestDocument, processDocument } from '../src/modules/documents/service.js';
import { createInvoice, createPurchaseOrder, createContract, createDelivery, recordPayment, verifyInvoiceRecord } from '../src/modules/invoices/service.js';
import { createTransaction, importTransactions } from '../src/modules/transactions/service.js';
import { runReconciliation } from '../src/modules/transactions/reconcile.js';
import { generateTrustRecord } from '../src/modules/trust/service.js';
import { grantInstitutionAccess, recordVerification } from '../src/modules/businesses/service.js';
import { logger } from '../src/lib/logger.js';

const PASSWORD = process.env.SEED_PASSWORD || 'AftDemo!2026#Kigali';
const docDir = path.join(config.storageDir, 'seed');

function daysAgo(n) {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

function daysAhead(n) {
  return new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
}

function authFor(org, user, role = 'business_admin') {
  return { type: 'session', org: { id: org.id, orgType: org.org_type, name: org.name }, role, user: { id: user.id, email: user.email }, apiKeyId: null };
}

async function createOrg(name, type, country = null) {
  const id = ulid();
  await q('INSERT INTO organisations (id, name, org_type, country_code) VALUES (?, ?, ?, ?)', [id, name, type, country]);
  return { id, name, org_type: type, country_code: country };
}

async function createUser(org, email, fullName, role) {
  const id = ulid();
  await q(
    `INSERT INTO users (id, org_id, email, password_hash, full_name, role, status) VALUES (?, ?, ?, ?, ?, ?, 'active')`,
    [id, org.id, email.toLowerCase(), hashPassword(PASSWORD), fullName, role],
  );
  return { id, email: email.toLowerCase(), full_name: fullName, role };
}

async function setReconciliationRules(orgId, rules) {
  await q(
    `INSERT INTO org_settings (org_id, reconciliation_rules, verification_policy) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE reconciliation_rules = VALUES(reconciliation_rules)`,
    [orgId, JSON.stringify(rules), JSON.stringify({ require_two_corroborating_categories: true })],
  );
}

async function makeInvoicePdf(filename, data) {
  await fsp.mkdir(docDir, { recursive: true });
  const filePath = path.join(docDir, filename);
  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#071b2b').text(data.supplier, { align: 'left' });
    doc.font('Helvetica').fontSize(8).fillColor('#687982').text(data.supplierAddress);
    doc.moveDown(1.5);
    doc.font('Helvetica-Bold').fontSize(20).fillColor('#c69a43').text('TAX INVOICE');
    doc.moveDown(0.4);
    doc.fillColor('#172b38').fontSize(10).font('Helvetica');
    doc.text(`Invoice No: ${data.invoiceNumber}`);
    doc.text(`Invoice Date: ${data.issueDate}`);
    doc.text(`Due Date: ${data.dueDate}`);
    doc.text(`PO Number: ${data.poNumber}`);
    doc.text(`Currency: ${data.currency}`);
    doc.moveDown(0.8);
    doc.font('Helvetica-Bold').text('Bill To:');
    doc.font('Helvetica').text(data.buyer);
    doc.moveDown(1);
    doc.font('Helvetica-Bold').text('Description');
    doc.font('Helvetica').text(data.description);
    doc.moveDown(1.5);
    doc.font('Helvetica').text(`Subtotal: ${data.currency} ${data.subtotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    doc.text(`VAT 18%: ${data.currency} ${data.tax.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    doc.font('Helvetica-Bold').fontSize(12).text(`TOTAL: ${data.currency} ${data.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    doc.moveDown(2);
    doc.font('Helvetica').fontSize(8).fillColor('#687982').text('Payment by bank transfer quoting the invoice number. Goods sold are not returnable after 14 days.');
    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
  const stat = await fsp.stat(filePath);
  return { path: filePath, originalname: filename, mimetype: 'application/pdf', size: stat.size };
}

async function attachInvoiceDocument(auth, businessId, file) {
  const { document } = await ingestDocument({ auth, businessId, file, ip: '127.0.0.1' });
  await processDocument(document.id);
  return document;
}

async function main() {
  await runMigrations({ log: logger });
  const existing = await one("SELECT id FROM organisations WHERE name = 'African Financial Trust'");
  if (existing) {
    console.log('Seed data already present. Set SEED_FORCE=true to append another dataset (not recommended).');
    if (process.env.SEED_FORCE !== 'true') return;
  }

  const countries = JSON.parse(await fsp.readFile(new URL('../db/seed/countries.json', import.meta.url), 'utf8'));
  for (const country of countries) {
    await q(
      `INSERT INTO country_profiles (country_code, name, currency_code, registration_label, registration_pattern, tax_label,
        tax_pattern, date_format, number_format, mobile_money_providers, registry_source, registry_api_available, verification_notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), currency_code = VALUES(currency_code)`,
      [
        country.country_code,
        country.name,
        country.currency_code,
        country.registration_label,
        country.registration_pattern,
        country.tax_label,
        country.tax_pattern,
        country.date_format,
        country.number_format,
        JSON.stringify(country.mobile_money_providers),
        country.registry_source,
        country.registry_api_available,
        country.verification_notes,
      ],
    );
  }
  console.log(`Countries seeded: ${countries.length}`);

  const platform = await createOrg('African Financial Trust', 'platform', 'RW');
  const admin = await createUser(platform, 'admin@africanfinancialtrust.africa', 'Amani Uwase', 'system_admin');
  const auditor = await createUser(platform, 'auditor@africanfinancialtrust.africa', 'Claire Mukamana', 'auditor');
  await setReconciliationRules(platform.id, { amountAbsolute: 1, amountPercent: 0.5, dateWindowDays: 10 });

  const bank = await createOrg('Kigali Commercial Bank', 'institution', 'RW');
  const bankAdmin = await createUser(bank, 'analyst@kigalicommercial.rw', 'Eric Nshimiyimana', 'institution_admin');
  const bankAnalyst = await createUser(bank, 'credit@kigalicommercial.rw', 'Diane Uwera', 'institution_analyst');
  await setReconciliationRules(bank.id, { amountAbsolute: 1, amountPercent: 0.5, dateWindowDays: 10 });

  const outsider = await createOrg('Nairobi Capital Partners', 'institution', 'KE');
  const outsiderAnalyst = await createUser(outsider, 'analyst@nairobicapital.ke', 'Peter Otieno', 'institution_analyst');

  const freshOrg = await createOrg('Kigali Fresh Foods Ltd', 'business', 'RW');
  const freshAdmin = await createUser(freshOrg, 'finance@kigalifresh.rw', 'Josiane Ingabire', 'business_admin');
  await setReconciliationRules(freshOrg.id, { amountAbsolute: 1, amountPercent: 0.5, dateWindowDays: 10 });

  const textileOrg = await createOrg('Nyamirambo Textiles SARL', 'business', 'RW');
  const textileAdmin = await createUser(textileOrg, 'accounts@nyamirambotextiles.rw', 'Patrick Habimana', 'business_admin');

  const logisticsOrg = await createOrg('Gasabo Logistics Ltd', 'business', 'RW');
  const logisticsAdmin = await createUser(logisticsOrg, 'finance@gasabologistics.rw', 'Alice Mukeshimana', 'business_admin');

  const agroOrg = await createOrg('Nairobi Agro Supplies Ltd', 'business', 'KE');
  const agroAdmin = await createUser(agroOrg, 'finance@nairobiagro.co.ke', 'Grace Wanjiku', 'business_admin');

  const freshAuth = authFor(freshOrg, freshAdmin);
  const textileAuth = authFor(textileOrg, textileAdmin);
  const logisticsAuth = authFor(logisticsOrg, logisticsAdmin);
  const agroAuth = authFor(agroOrg, agroAdmin);

  // --- Business 1: strong evidence -----------------------------------------
  const fresh = await createBusiness(freshAuth, {
    legalName: 'Kigali Fresh Foods Ltd',
    tradingName: 'Fresh Foods Rwanda',
    countryCode: 'RW',
    registrationNumber: '103456789',
    taxId: '102345678',
    legalForm: 'Private limited company',
    incorporationDate: '2016-04-12',
    industry: 'Food and beverage distribution',
    addressLine1: 'KG 11 Avenue, Plot 24',
    city: 'Kigali',
    region: 'Kigali City',
    email: 'finance@kigalifresh.rw',
    phone: '+250 788 123 456',
    representatives: [{ fullName: 'Josiane Ingabire', roleTitle: 'Finance Director', email: 'finance@kigalifresh.rw', authorised: true }],
  });
  const hotel = await createCounterparty(freshAuth, {
    businessId: fresh.id,
    name: 'Hotel des Mille Collines',
    countryCode: 'RW',
    registrationNumber: '102998877',
    email: 'accounts@millecollines.rw',
    relationship: 'customer',
  });
  const beverage = await createCounterparty(freshAuth, {
    businessId: fresh.id,
    name: 'Rwanda Beverage Distributors',
    countryCode: 'RW',
    registrationNumber: '101223344',
    relationship: 'supplier',
  });

  const freshInvoiceFile = await makeInvoicePdf('kigali-fresh-invoice-2026-041.pdf', {
    supplier: 'Kigali Fresh Foods Ltd',
    supplierAddress: 'KG 11 Avenue, Plot 24, Kigali, Rwanda',
    invoiceNumber: 'KFF-2026-041',
    issueDate: '02/10/2026',
    dueDate: '01/11/2026',
    poNumber: 'PO-MC-7781',
    currency: 'RWF',
    buyer: 'Hotel des Mille Collines',
    description: 'Supply of fresh produce — October 2026 (12 crates)',
    subtotal: 4_200_000,
    tax: 756_000,
    total: 4_956_000,
  });
  const freshDoc = await attachInvoiceDocument(freshAuth, fresh.id, freshInvoiceFile);

  const freshInvoice = await createInvoice(freshAuth, {
    businessId: fresh.id,
    counterpartyId: hotel.id,
    invoiceNumber: 'KFF-2026-041',
    issueDate: daysAgo(28),
    dueDate: daysAgo(-2),
    currency: 'RWF',
    subtotal: 4_200_000,
    taxAmount: 756_000,
    totalAmount: 4_956_000,
    poNumber: 'PO-MC-7781',
    documentId: freshDoc.id,
    lines: [{ description: 'Fresh produce — October 2026', quantity: 12, unitPrice: 350_000, lineTotal: 4_200_000, taxRate: 18 }],
  });
  await createPurchaseOrder(freshAuth, {
    businessId: fresh.id,
    counterpartyId: hotel.id,
    poNumber: 'PO-MC-7781',
    issueDate: daysAgo(34),
    currency: 'RWF',
    totalAmount: 4_956_000,
    notes: 'October produce order',
  });
  await createContract(freshAuth, {
    businessId: fresh.id,
    counterpartyId: hotel.id,
    contractNumber: 'CTR-MC-2026',
    title: 'Annual fresh produce supply agreement',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    currency: 'RWF',
    contractValue: 60_000_000,
  });
  await createDelivery(freshAuth, {
    businessId: fresh.id,
    invoiceId: freshInvoice.id,
    deliveryNoteNumber: 'DN-2026-118',
    deliveryDate: daysAgo(27),
    recipientName: 'Hotel des Mille Collines — Receiving',
  });
  await recordPayment(freshAuth, freshInvoice.id, {
    amount: 4_956_000,
    currency: 'RWF',
    paidAt: new Date(Date.now() - 6 * 86_400_000).toISOString(),
    method: 'bank_transfer',
    reference: 'BK-884120 KFF-2026-041',
    payerName: 'Hotel des Mille Collines',
    payeeName: 'Kigali Fresh Foods Ltd',
  });
  await createTransaction(freshAuth, {
    businessId: fresh.id,
    sourceType: 'bank',
    provider: 'Bank of Kigali',
    externalId: 'BK-884120',
    direction: 'credit',
    amount: 4_956_000,
    currency: 'RWF',
    valueDate: daysAgo(6),
    reference: 'KFF-2026-041',
    description: 'Incoming payment Hotel des Mille Collines',
    counterpartyName: 'Hotel des Mille Collines',
  });
  const freshVerification = await verifyInvoiceRecord(freshAuth, freshInvoice.id, {});

  // A second, smaller invoice that is only partially paid and now overdue.
  const freshInvoice2 = await createInvoice(freshAuth, {
    businessId: fresh.id,
    counterpartyId: hotel.id,
    invoiceNumber: 'KFF-2026-042',
    issueDate: daysAgo(52),
    dueDate: daysAgo(22),
    currency: 'RWF',
    subtotal: 1_800_000,
    taxAmount: 324_000,
    totalAmount: 2_124_000,
    poNumber: 'PO-MC-7802',
    lines: [{ description: 'Dairy supply — September 2026', quantity: 6, unitPrice: 300_000, lineTotal: 1_800_000, taxRate: 18 }],
  });
  await createPurchaseOrder(freshAuth, {
    businessId: fresh.id,
    counterpartyId: hotel.id,
    poNumber: 'PO-MC-7802',
    issueDate: daysAgo(58),
    currency: 'RWF',
    totalAmount: 2_124_000,
  });
  await recordPayment(freshAuth, freshInvoice2.id, {
    amount: 1_000_000,
    currency: 'RWF',
    paidAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
    method: 'mobile_money',
    reference: 'MOMO-778120 KFF-2026-042',
  });
  await verifyInvoiceRecord(freshAuth, freshInvoice2.id, {});

  const confirmation = await requestConfirmation(freshAuth, hotel.id, { invoiceId: freshInvoice.id, baseUrl: 'https://africanfinancialtrust.pages.dev' });
  await respondToConfirmation(confirmation.token, { decision: 'confirm', name: 'Hotel des Mille Collines', email: 'accounts@millecollines.rw', note: 'Invoice received and paid in full.' });
  await verifyInvoiceRecord(freshAuth, freshInvoice.id, {});
  await recordVerification(
    { ...authFor(platform, admin, 'system_admin') },
    fresh.id,
    { outcome: 'verified', method: 'manual_registry_check', reference: 'RDB/2026/88412', note: 'RDB certificate and TIN verified against submitted documents.' },
    {},
  );

  // --- Business 2: partial evidence ----------------------------------------
  const textile = await createBusiness(textileAuth, {
    legalName: 'Nyamirambo Textiles SARL',
    tradingName: 'Nyamirambo Textiles',
    countryCode: 'RW',
    registrationNumber: '104112233',
    taxId: '103998877',
    industry: 'Textile manufacturing',
    addressLine1: 'KN 2 Road, Nyamirambo',
    city: 'Kigali',
    email: 'accounts@nyamirambotextiles.rw',
  });
  const fashion = await createCounterparty(textileAuth, {
    businessId: textile.id,
    name: 'Kigali Fashion House',
    countryCode: 'RW',
    relationship: 'customer',
  });
  const textileFile = await makeInvoicePdf('nyamirambo-invoice-118.pdf', {
    supplier: 'Nyamirambo Textiles SARL',
    supplierAddress: 'KN 2 Road, Nyamirambo, Kigali',
    invoiceNumber: 'NT-118',
    issueDate: '15/10/2026',
    dueDate: '14/11/2026',
    poNumber: 'PO-KFH-331',
    currency: 'RWF',
    buyer: 'Kigali Fashion House',
    description: 'Woven fabric — 400 metres',
    subtotal: 3_000_000,
    tax: 540_000,
    total: 3_540_000,
  });
  const textileDoc = await attachInvoiceDocument(textileAuth, textile.id, textileFile);
  const textileInvoice = await createInvoice(textileAuth, {
    businessId: textile.id,
    counterpartyId: fashion.id,
    invoiceNumber: 'NT-118',
    issueDate: daysAgo(15),
    dueDate: daysAhead(15),
    currency: 'RWF',
    subtotal: 3_000_000,
    taxAmount: 540_000,
    totalAmount: 3_540_000,
    poNumber: 'PO-KFH-331',
    documentId: textileDoc.id,
    lines: [{ description: 'Woven fabric — 400 metres', quantity: 400, unitPrice: 7_500, lineTotal: 3_000_000, taxRate: 18 }],
  });
  await createPurchaseOrder(textileAuth, {
    businessId: textile.id,
    counterpartyId: fashion.id,
    poNumber: 'PO-KFH-331',
    issueDate: daysAgo(20),
    currency: 'RWF',
    totalAmount: 3_540_000,
  });
  await verifyInvoiceRecord(textileAuth, textileInvoice.id, {});

  await createDelivery(textileAuth, {
    businessId: textile.id,
    invoiceId: textileInvoice.id,
    deliveryNoteNumber: 'DN-NT-118',
    deliveryDate: daysAgo(12),
    recipientName: 'Kigali Fashion House — Store',
  });
  await recordPayment(textileAuth, textileInvoice.id, {
    amount: 1_500_000,
    currency: 'RWF',
    paidAt: daysAgo(9),
    method: 'bank_transfer',
    reference: 'BPR-NT-4471',
    payerName: 'Kigali Fashion House',
    payeeName: 'Nyamirambo Textiles SARL',
  });
  const textileConfirmation = await requestConfirmation(textileAuth, fashion.id, { invoiceId: textileInvoice.id, baseUrl: 'https://africanfinancialtrust.pages.dev' });
  await respondToConfirmation(textileConfirmation.token, { decision: 'confirm', name: 'Kigali Fashion House', email: 'accounts@kigalifashion.rw', note: 'Invoice NT-118 confirmed; first instalment paid, balance due on the second batch.' });
  await verifyInvoiceRecord(textileAuth, textileInvoice.id, {});

  // --- Business 3: inconsistent evidence -----------------------------------
  const logistics = await createBusiness(logisticsAuth, {
    legalName: 'Gasabo Logistics Ltd',
    countryCode: 'RW',
    registrationNumber: '105667788',
    taxId: '104556677',
    industry: 'Freight and logistics',
    city: 'Kigali',
    email: 'finance@gasabologistics.rw',
  });
  const lakeKivu = await createCounterparty(logisticsAuth, {
    businessId: logistics.id,
    name: 'Lake Kivu Traders',
    countryCode: 'RW',
    relationship: 'customer',
  });
  const brokenFile = await makeInvoicePdf('gasabo-invoice-907.pdf', {
    supplier: 'Gasabo Logistics Ltd',
    supplierAddress: 'Kigali, Rwanda',
    invoiceNumber: 'GL-907',
    issueDate: '20/10/2026',
    dueDate: '19/11/2026',
    poNumber: 'PO-LKT-556',
    currency: 'RWF',
    buyer: 'Lake Kivu Traders',
    description: 'Freight — Kigali to Rubavu, 3 trucks',
    subtotal: 4_000_000,
    tax: 720_000,
    total: 5_000_000,
  });
  const brokenDoc = await attachInvoiceDocument(logisticsAuth, logistics.id, brokenFile);
  const brokenInvoice = await createInvoice(logisticsAuth, {
    businessId: logistics.id,
    counterpartyId: lakeKivu.id,
    invoiceNumber: 'GL-907',
    issueDate: daysAgo(11),
    dueDate: daysAhead(19),
    currency: 'RWF',
    subtotal: 4_000_000,
    taxAmount: 720_000,
    totalAmount: 5_000_000,
    poNumber: 'PO-LKT-556',
    documentId: brokenDoc.id,
    lines: [{ description: 'Freight — Kigali to Rubavu, 3 trucks', quantity: 3, unitPrice: 1_333_333, lineTotal: 4_000_000, taxRate: 18 }],
  });
  await createInvoice(logisticsAuth, {
    businessId: logistics.id,
    counterpartyId: lakeKivu.id,
    invoiceNumber: 'GL-907',
    issueDate: daysAgo(11),
    dueDate: daysAhead(19),
    currency: 'RWF',
    subtotal: 4_000_000,
    taxAmount: 720_000,
    totalAmount: 5_000_000,
    poNumber: 'PO-LKT-556',
  });
  await verifyInvoiceRecord(logisticsAuth, brokenInvoice.id, {});

  // --- Business 4: cross-border, document only -----------------------------
  const agro = await createBusiness(agroAuth, {
    legalName: 'Nairobi Agro Supplies Ltd',
    countryCode: 'KE',
    registrationNumber: 'PVT-2019-88421',
    taxId: 'P051234567X',
    industry: 'Agricultural inputs',
    city: 'Nairobi',
    email: 'finance@nairobiagro.co.ke',
  });
  const mombasa = await createCounterparty(agroAuth, {
    businessId: agro.id,
    name: 'Mombasa Retail Group',
    countryCode: 'KE',
    relationship: 'customer',
  });
  const agroFile = await makeInvoicePdf('nairobi-agro-invoice-2291.pdf', {
    supplier: 'Nairobi Agro Supplies Ltd',
    supplierAddress: 'Industrial Area, Nairobi, Kenya',
    invoiceNumber: 'NAS-2291',
    issueDate: '05/10/2026',
    dueDate: '04/11/2026',
    poNumber: 'MRG-7712',
    currency: 'KES',
    buyer: 'Mombasa Retail Group',
    description: 'Fertiliser and seed supply',
    subtotal: 1_250_000,
    tax: 200_000,
    total: 1_450_000,
  });
  const agroDoc = await attachInvoiceDocument(agroAuth, agro.id, agroFile);
  const agroInvoice = await createInvoice(agroAuth, {
    businessId: agro.id,
    counterpartyId: mombasa.id,
    invoiceNumber: 'NAS-2291',
    issueDate: daysAgo(48),
    dueDate: daysAgo(18),
    currency: 'KES',
    subtotal: 1_250_000,
    taxAmount: 200_000,
    totalAmount: 1_450_000,
    poNumber: 'MRG-7712',
    documentId: agroDoc.id,
    lines: [{ description: 'Fertiliser and seed supply', quantity: 1, unitPrice: 1_250_000, lineTotal: 1_250_000, taxRate: 16 }],
  });
  await verifyInvoiceRecord(agroAuth, agroInvoice.id, {});

  await createPurchaseOrder(agroAuth, {
    businessId: agro.id,
    counterpartyId: mombasa.id,
    poNumber: 'MRG-7712',
    issueDate: daysAgo(54),
    currency: 'KES',
    totalAmount: 1_450_000,
  });
  await recordPayment(agroAuth, agroInvoice.id, {
    amount: 580_000,
    currency: 'KES',
    paidAt: daysAgo(21),
    method: 'bank_transfer',
    reference: 'EQ-NAS-2291-A',
    payerName: 'Mombasa Retail Group',
    payeeName: 'Nairobi Agro Supplies Ltd',
  });
  const agroConfirmation = await requestConfirmation(agroAuth, mombasa.id, { invoiceId: agroInvoice.id, baseUrl: 'https://africanfinancialtrust.pages.dev' });
  await respondToConfirmation(agroConfirmation.token, { decision: 'confirm', name: 'Mombasa Retail Group', email: 'ap@mombasaretail.co.ke', note: 'Invoice NAS-2291 confirmed. Part payment made; balance held pending quality inspection.' });
  await verifyInvoiceRecord(agroAuth, agroInvoice.id, {});

  // Bank feed for Nairobi Agro, with one payment that should match.
  await importTransactions(
    agroAuth,
    { businessId: agro.id, sourceType: 'bank', provider: 'Equity Bank', currency: 'KES' },
    {
      filename: 'equity-october-2026.csv',
      rows: [
        { 'Transaction Date': '28/10/2026', Amount: '580000.00', Currency: 'KES', Reference: 'NAS-2291-A', Description: 'Part payment invoice NAS-2291', Counterparty: 'Mombasa Retail Group' },
        { 'Transaction Date': '30/10/2026', Amount: '-45000.00', Currency: 'KES', Reference: 'CHG-9912', Description: 'Bank charges', Counterparty: 'Equity Bank' },
        { 'Transaction Date': '02/11/2026', Amount: '320000.00', Currency: 'KES', Reference: 'DEP-1182', Description: 'Cash deposit', Counterparty: 'Nairobi Agro Supplies' },
      ],
    },
  );
  const agroRecon = await runReconciliation(agroAuth, { businessId: agro.id }, {});

  // Reconciliation for the strong business (should match the outstanding balance).
  await createTransaction(freshAuth, {
    businessId: fresh.id,
    sourceType: 'mobile_money',
    provider: 'MTN MoMo',
    externalId: 'MOMO-778120',
    direction: 'credit',
    amount: 1_000_000,
    currency: 'RWF',
    valueDate: daysAgo(30),
    reference: 'KFF-2026-042',
    description: 'Mobile money payment',
    counterpartyName: 'Hotel des Mille Collines',
  });
  const freshRecon = await runReconciliation(freshAuth, { businessId: fresh.id }, {});

  // Access grants: the bank may see two businesses; the outsider sees none.
  await grantInstitutionAccess(freshAuth, fresh.id, {
    institutionOrgId: bank.id,
    scopes: ['trust_record.read', 'documents.read', 'invoices.read', 'reconciliation.read'],
    purpose: 'Trade finance assessment',
    expiresAt: new Date(Date.now() + 180 * 86_400_000).toISOString(),
  });
  await grantInstitutionAccess(textileAuth, textile.id, {
    institutionOrgId: bank.id,
    scopes: ['trust_record.read', 'invoices.read'],
    purpose: 'Invoice discounting review',
    expiresAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
  });

  // Trust Records
  const freshTrust = await generateTrustRecord(freshAuth, fresh.id, {});
  const textileTrust = await generateTrustRecord(textileAuth, textile.id, {});
  const logisticsTrust = await generateTrustRecord(logisticsAuth, logistics.id, {});
  const agroTrust = await generateTrustRecord(agroAuth, agro.id, {});

  const summary = {
    organisations: 7,
    businesses: 4,
    documents: 4,
    invoices: 5,
    verification: {
      fresh_primary: freshVerification.result.status,
      fresh_secondary: 'partially_verified (expected)',
      textile: 'partially_verified (expected)',
      logistics: 'inconsistent (expected)',
      agro: 'partially_verified (expected)',
    },
    reconciliations: { fresh: freshRecon.stats, agro: agroRecon.stats },
    trust_records: {
      fresh: { score: freshTrust.evidence_score, grade: freshTrust.evidence_grade },
      textile: { score: textileTrust.evidence_score, grade: textileTrust.evidence_grade },
      logistics: { score: logisticsTrust.evidence_score, grade: logisticsTrust.evidence_grade },
      agro: { score: agroTrust.evidence_score, grade: agroTrust.evidence_grade },
    },
  };
  console.log(JSON.stringify(summary, null, 2));
  console.log('\nSeed credentials (change immediately in production):');
  for (const [label, email, role] of [
    ['System administrator', admin.email, 'system_admin'],
    ['Read-only auditor', auditor.email, 'auditor'],
    ['Bank administrator', bankAdmin.email, 'institution_admin'],
    ['Bank analyst', bankAnalyst.email, 'institution_analyst'],
    ['Unauthorised institution', outsiderAnalyst.email, 'institution_analyst'],
    ['Business admin — Kigali Fresh', freshAdmin.email, 'business_admin'],
    ['Business admin — Nyamirambo Textiles', textileAdmin.email, 'business_admin'],
    ['Business admin — Gasabo Logistics', logisticsAdmin.email, 'business_admin'],
    ['Business admin — Nairobi Agro', agroAdmin.email, 'business_admin'],
  ]) {
    console.log(`  ${label.padEnd(34)} ${email.padEnd(42)} ${role}`);
  }
  console.log(`  Password (all seeded accounts): ${PASSWORD}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  });
