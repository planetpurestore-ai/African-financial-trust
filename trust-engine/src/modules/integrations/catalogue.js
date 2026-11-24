/**
 * Adapter catalogue.
 *
 * `check` performs a real authenticated request against the provider's public
 * API. A provider is only marked `connected` when that request succeeds.
 * Providers that rely on file import or manual verification declare no remote
 * check and are never presented as live connections.
 */

async function request(url, options = {}, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    return { status: response.status, ok: response.ok, body: text.slice(0, 500) };
  } finally {
    clearTimeout(timer);
  }
}

function basic(user, pass) {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

export const PROVIDERS = [
  {
    provider: 'mpesa',
    name: 'M-Pesa (Safaricom Daraja)',
    category: 'mobile_money',
    countries: ['KE', 'TZ', 'GH', 'MZ', 'LS', 'CD', 'EG'],
    capabilities: ['transaction_read', 'payment_status', 'balance_read'],
    credentialKeys: [
      { key: 'consumerKey', label: 'Consumer key', required: true },
      { key: 'consumerSecret', label: 'Consumer secret', required: true },
      { key: 'shortcode', label: 'Business shortcode', required: true },
      { key: 'passkey', label: 'Lipa na M-Pesa passkey', required: false },
    ],
    configKeys: [{ key: 'baseUrl', label: 'API base URL', default: 'https://sandbox.safaricom.co.ke' }],
    docs: 'https://developer.safaricom.co.ke/',
    async check(creds, cfg) {
      const base = cfg.baseUrl || 'https://sandbox.safaricom.co.ke';
      const res = await request(`${base}/oauth/v1/generate?grant_type=client_credentials`, {
        headers: { authorization: basic(creds.consumerKey, creds.consumerSecret) },
      });
      return { ok: res.ok && res.status === 200, detail: `OAuth endpoint returned HTTP ${res.status}`, status: res.status };
    },
  },
  {
    provider: 'mtn_momo',
    name: 'MTN Mobile Money',
    category: 'mobile_money',
    countries: ['RW', 'UG', 'GH', 'CM', 'CI', 'ZM', 'NG', 'ZA'],
    capabilities: ['transaction_read', 'payment_status'],
    credentialKeys: [
      { key: 'subscriptionKey', label: 'Ocp-Apim-Subscription-Key', required: true },
      { key: 'apiUser', label: 'API user', required: true },
      { key: 'apiKey', label: 'API key', required: true },
    ],
    configKeys: [
      { key: 'baseUrl', label: 'Collection API base URL', default: 'https://sandbox.momodeveloper.mtn.com' },
      { key: 'targetEnvironment', label: 'Target environment', default: 'sandbox' },
    ],
    docs: 'https://momodeveloper.mtn.com/',
    async check(creds, cfg) {
      const base = cfg.baseUrl || 'https://sandbox.momodeveloper.mtn.com';
      const res = await request(`${base}/collection/token/`, {
        method: 'POST',
        headers: {
          authorization: basic(creds.apiUser, creds.apiKey),
          'ocp-apim-subscription-key': creds.subscriptionKey,
        },
      });
      return { ok: res.ok && res.status === 200, detail: `Collection token endpoint returned HTTP ${res.status}`, status: res.status };
    },
  },
  {
    provider: 'airtel_money',
    name: 'Airtel Money',
    category: 'mobile_money',
    countries: ['RW', 'UG', 'KE', 'TZ', 'ZM', 'MW', 'NG', 'CI', 'SN'],
    capabilities: ['transaction_read', 'payment_status'],
    credentialKeys: [
      { key: 'clientId', label: 'Client ID', required: true },
      { key: 'clientSecret', label: 'Client secret', required: true },
    ],
    configKeys: [{ key: 'baseUrl', label: 'API base URL', default: 'https://openapiuat.airtel.africa' }],
    docs: 'https://developers.airtel.africa/',
    async check(creds, cfg) {
      const base = cfg.baseUrl || 'https://openapiuat.airtel.africa';
      const res = await request(`${base}/auth/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ client_id: creds.clientId, client_secret: creds.clientSecret, grant_type: 'client_credentials' }),
      });
      return { ok: res.ok && res.status === 200, detail: `OAuth token endpoint returned HTTP ${res.status}`, status: res.status };
    },
  },
  {
    provider: 'flutterwave',
    name: 'Flutterwave',
    category: 'payment_provider',
    countries: ['NG', 'GH', 'KE', 'RW', 'ZA', 'UG', 'TZ', 'CM', 'CI'],
    capabilities: ['transaction_read', 'payment_status', 'settlement_read'],
    credentialKeys: [{ key: 'secretKey', label: 'Secret key', required: true }],
    configKeys: [{ key: 'baseUrl', label: 'API base URL', default: 'https://api.flutterwave.com/v3' }],
    docs: 'https://developer.flutterwave.com/',
    async check(creds, cfg) {
      const base = cfg.baseUrl || 'https://api.flutterwave.com/v3';
      const res = await request(`${base}/balances`, { headers: { authorization: `Bearer ${creds.secretKey}` } });
      return { ok: res.ok && res.status === 200, detail: `Balances endpoint returned HTTP ${res.status}`, status: res.status };
    },
  },
  {
    provider: 'paystack',
    name: 'Paystack',
    category: 'payment_provider',
    countries: ['NG', 'GH', 'ZA', 'KE', 'CI', 'EG'],
    capabilities: ['transaction_read', 'payment_status', 'settlement_read'],
    credentialKeys: [{ key: 'secretKey', label: 'Secret key', required: true }],
    configKeys: [{ key: 'baseUrl', label: 'API base URL', default: 'https://api.paystack.co' }],
    docs: 'https://paystack.com/docs/api/',
    async check(creds, cfg) {
      const base = cfg.baseUrl || 'https://api.paystack.co';
      const res = await request(`${base}/bank?country=ghana`, { headers: { authorization: `Bearer ${creds.secretKey}` } });
      return { ok: res.ok && res.status === 200, detail: `Bank list endpoint returned HTTP ${res.status}`, status: res.status };
    },
  },
  {
    provider: 'open_banking',
    name: 'Open banking provider (generic OAuth2)',
    category: 'open_banking',
    countries: ['ZA', 'NG', 'KE', 'GH', 'EG'],
    capabilities: ['transaction_read', 'balance_read'],
    credentialKeys: [
      { key: 'clientId', label: 'Client ID', required: true },
      { key: 'clientSecret', label: 'Client secret', required: true },
    ],
    configKeys: [
      { key: 'tokenUrl', label: 'OAuth2 token URL', required: true },
      { key: 'baseUrl', label: 'API base URL', required: true },
    ],
    docs: 'Depends on the provider; AFT implements the generic client-credentials contract.',
    async check(creds, cfg) {
      if (!cfg.tokenUrl) return { ok: false, detail: 'No token URL configured', status: null };
      const res = await request(cfg.tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: creds.clientId, client_secret: creds.clientSecret }).toString(),
      });
      return { ok: res.ok && res.status === 200, detail: `Token endpoint returned HTTP ${res.status}`, status: res.status };
    },
  },
  {
    provider: 'bank_statement',
    name: 'Bank statement import (CSV/MT940)',
    category: 'bank',
    countries: ['*'],
    capabilities: ['statement_import'],
    credentialKeys: [],
    configKeys: [{ key: 'format', label: 'Statement format', default: 'CSV' }],
    docs: 'Manual file import through POST /api/v1/transactions/import.',
    async check() {
      return { ok: true, detail: 'File-import adapter; no remote connection is required or claimed', status: null };
    },
    manual: true,
  },
  {
    provider: 'accounting_export',
    name: 'Accounting / ERP export (CSV, XLSX)',
    category: 'accounting',
    countries: ['*'],
    capabilities: ['ledger_import', 'invoice_import'],
    credentialKeys: [],
    configKeys: [{ key: 'format', label: 'Export format', default: 'CSV' }],
    docs: 'Import via the transactions and documents endpoints; no vendor API is assumed.',
    async check() {
      return { ok: true, detail: 'File-import adapter; no remote connection is required or claimed', status: null };
    },
    manual: true,
  },
  {
    provider: 'registry_manual',
    name: 'Business registry (manual verification)',
    category: 'registry',
    countries: ['RW', 'KE', 'NG', 'GH', 'TZ', 'UG', 'ZA', 'ZM', 'CI', 'SN'],
    capabilities: ['manual_verification'],
    credentialKeys: [],
    configKeys: [{ key: 'registryName', label: 'Registry name', default: 'RDB (Rwanda)' }],
    docs: 'No public registry API is integrated. Verification is recorded manually with a reference and reviewer.',
    async check() {
      return { ok: true, detail: 'Manual verification workflow; no registry API is claimed', status: null };
    },
    manual: true,
  },
  {
    provider: 'tax_manual',
    name: 'Tax authority check (manual)',
    category: 'tax',
    countries: ['RW', 'KE', 'NG', 'GH', 'TZ', 'UG', 'ZA'],
    capabilities: ['manual_verification'],
    credentialKeys: [],
    configKeys: [],
    docs: 'Manual TIN verification recorded against the business identifier.',
    async check() {
      return { ok: true, detail: 'Manual verification workflow; no tax API is claimed', status: null };
    },
    manual: true,
  },
  {
    provider: 'logistics_manual',
    name: 'Delivery evidence (manual)',
    category: 'logistics',
    countries: ['*'],
    capabilities: ['delivery_evidence'],
    credentialKeys: [],
    configKeys: [],
    docs: 'Delivery notes are uploaded and linked to invoices.',
    async check() {
      return { ok: true, detail: 'Document-based adapter; no logistics API is claimed', status: null };
    },
    manual: true,
  },
];

export function getProvider(provider) {
  return PROVIDERS.find((p) => p.provider === provider) || null;
}
