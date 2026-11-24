const CURRENCY_CODES = [
  'RWF', 'KES', 'NGN', 'GHS', 'TZS', 'UGX', 'ZAR', 'XOF', 'XAF', 'EGP', 'MAD', 'DZD', 'ETB', 'ZMW', 'MWK',
  'MZN', 'BWP', 'NAD', 'MUR', 'SCR', 'CDF', 'GMD', 'SLL', 'LRD', 'USD', 'EUR', 'GBP', 'AED', 'CNY', 'INR',
];

const SYMBOLS = { '€': 'EUR', '£': 'GBP', '$': 'USD', '₦': 'NGN', '₵': 'GHS', 'R': 'ZAR', 'KSh': 'KES', 'FRw': 'RWF' };

export function detectCurrency(text) {
  const upper = String(text).toUpperCase();
  const counts = new Map();
  for (const code of CURRENCY_CODES) {
    const re = new RegExp(`\\b${code}\\b`, 'g');
    const n = (upper.match(re) || []).length;
    if (n) counts.set(code, n);
  }
  for (const [symbol, code] of Object.entries(SYMBOLS)) {
    if (upper.includes(symbol)) counts.set(code, (counts.get(code) || 0) + 1);
  }
  if (!counts.size) return { code: null, confidence: 0 };
  const [code, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return { code, confidence: Math.min(0.95, 0.5 + n * 0.1) };
}

/** Parse "1,234.56", "1.234,56", "RWF 1 234,56", "(500.00)". */
export function parseAmount(raw) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).replace(/[^\d.,()\-]/g, '').trim();
  if (!s) return null;
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  }
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) {
    // European format: dots are thousands, comma is decimal
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    s = s.replace(/,/g, '');
  }
  const value = Number.parseFloat(s);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** Supports YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, DD MMM YYYY, MMM DD, YYYY. */
export function parseDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    // Prefer DD/MM unless the first component cannot be a day.
    const day = a > 12 && b <= 12 ? a : b > 12 && a <= 12 ? b : a;
    const month = day === a ? b : a;
    return iso(+m[3], month, day);
  }
  m = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})$/.exec(s);
  if (m) return iso(+m[3], MONTHS[m[2].slice(0, 4).toLowerCase()] || MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]);
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
  if (m) return iso(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]);
  return null;
}

function iso(year, month, day) {
  if (!year || !month || !day) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d.toISOString().slice(0, 10);
}

function capture(text, patterns, { group = 1 } = {}) {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      const value = match[group]?.trim();
      if (value) return { value, snippet: match[0].slice(0, 200).trim(), pattern: pattern.source };
    }
  }
  return null;
}

export function extractInvoiceFields(text) {
  const fields = [];
  const add = (name, result, confidence, normalize = (v) => v) => {
    if (!result) return;
    fields.push({
      fieldName: name,
      value: result.value,
      normalizedValue: normalize(result.value),
      confidence,
      snippet: result.snippet,
    });
  };

  add(
    'invoice_number',
    capture(text, [
      /(?:invoice|inv|tax invoice)\s*(?:no\.?|number|#|:)\s*[:#]?\s*([A-Z0-9][A-Z0-9\-\/_.]{2,30})/i,
      /\b(INV[-\/][A-Z0-9\-\/]{2,25})\b/i,
    ]),
    0.9,
  );
  add(
    'issue_date',
    capture(text, [
      /(?:invoice|issue|billing)\s*date\s*[:\-]?\s*([0-9]{1,4}[-\/\.][0-9]{1,2}[-\/\.][0-9]{1,4})/i,
      /date\s*(?:of\s*issue)?\s*[:\-]?\s*([0-9]{1,2}\s+[A-Za-z]{3,9}\s+[0-9]{4})/i,
    ]),
    0.85,
    parseDate,
  );
  add(
    'due_date',
    capture(text, [
      /(?:due|payment)\s*date\s*[:\-]?\s*([0-9]{1,4}[-\/\.][0-9]{1,2}[-\/\.][0-9]{1,4})/i,
      /due\s*(?:on|by)?\s*[:\-]?\s*([0-9]{1,2}\s+[A-Za-z]{3,9}\s+[0-9]{4})/i,
    ]),
    0.8,
    parseDate,
  );
  add(
    'po_number',
    capture(text, [/(?:p\.?o\.?|purchase order)\s*(?:no\.?|number|#|:)?\s*[:#]?\s*([A-Z0-9][A-Z0-9\-\/_.]{2,30})/i]),
    0.8,
  );
  add(
    'total_amount',
    capture(text, [
      /(?:grand\s*total|total\s*(?:amount|due|payable)?|amount\s*due|invoice\s*total)\s*[:\-]?\s*(?:[A-Z]{3})?\s*([\d.,\s]{1,20})/i,
    ]),
    0.75,
    parseAmount,
  );
  add(
    'tax_amount',
    capture(text, [/(?:vat|tax|gst|tva)\s*(?:amount)?\s*(?:\(?[\d.]+%\)?)?\s*[:\-]?\s*(?:[A-Z]{3})?\s*([\d.,\s]{1,20})/i]),
    0.7,
    parseAmount,
  );
  add(
    'subtotal',
    capture(text, [/(?:sub\s*total|net\s*amount|taxable\s*amount)\s*[:\-]?\s*(?:[A-Z]{3})?\s*([\d.,\s]{1,20})/i]),
    0.7,
    parseAmount,
  );
  add(
    'supplier_name',
    capture(text, [
      /(?:from|supplier|seller|vendor|issued\s*by)\s*[:\-]\s*([A-Za-z0-9&.,'()\- ]{3,80})/i,
      /(?:^|\n)\s*([A-Z][A-Z0-9&.,'()\- ]{3,60}(?:LTD|LIMITED|PLC|LLC|SARL|SAS|SA|BV|GMBH)\.?)/i,
    ]),
    0.6,
  );
  add(
    'buyer_name',
    capture(text, [/(?:bill\s*to|billed\s*to|customer|buyer|client|to)\s*[:\-]\s*([A-Za-z0-9&.,'()\- ]{3,80})/i]),
    0.6,
  );

  const currency = detectCurrency(text);
  if (currency.code) {
    fields.push({
      fieldName: 'currency',
      value: currency.code,
      normalizedValue: currency.code,
      confidence: currency.confidence,
      snippet: null,
    });
  }
  return fields;
}

export function extractGenericFields(text) {
  const fields = [];
  const date = capture(text, [/(?:date)\s*[:\-]?\s*([0-9]{1,4}[-\/\.][0-9]{1,2}[-\/\.][0-9]{1,4})/i]);
  if (date) fields.push({ fieldName: 'date', value: date.value, normalizedValue: parseDate(date.value), confidence: 0.6, snippet: date.snippet });
  const ref = capture(text, [/(?:reference|ref)\s*(?:no\.?|number|#|:)?\s*[:#]?\s*([A-Z0-9][A-Z0-9\-\/_.]{2,30})/i]);
  if (ref) fields.push({ fieldName: 'reference', value: ref.value, normalizedValue: ref.value, confidence: 0.7, snippet: ref.snippet });
  const total = capture(text, [/(?:total|amount)\s*[:\-]?\s*(?:[A-Z]{3})?\s*([\d.,\s]{1,20})/i]);
  if (total) fields.push({ fieldName: 'total_amount', value: total.value, normalizedValue: parseAmount(total.value), confidence: 0.6, snippet: total.snippet });
  const currency = detectCurrency(text);
  if (currency.code) fields.push({ fieldName: 'currency', value: currency.code, normalizedValue: currency.code, confidence: currency.confidence, snippet: null });
  return fields;
}
