const RULES = [
  {
    type: 'credit_note',
    patterns: [/\bcredit\s*note\b/i, /\bcredit\s*memo\b/i, /\bcn[-\/]\d+/i],
    weight: 5,
  },
  {
    type: 'purchase_order',
    patterns: [/\bpurchase\s*order\b/i, /\bp\.?\s?o\.?\s*(?:no|number|#)/i, /\border\s*date\b/i, /\bpo[-\/]\d+/i],
    weight: 4,
  },
  {
    type: 'invoice',
    patterns: [
      /\btax\s*invoice\b/i,
      /\binvoice\s*(?:no|number|#|date)/i,
      /\binvoice\b/i,
      /\bamount\s*due\b/i,
      /\bbill\s*to\b/i,
      /\bremit\s*to\b/i,
    ],
    weight: 3,
  },
  {
    type: 'delivery_note',
    patterns: [/\bdelivery\s*note\b/i, /\bgoods\s*received\b/i, /\bdelivered\s*by\b/i, /\bconsignment\s*note\b/i],
    weight: 4,
  },
  {
    type: 'bank_statement',
    patterns: [
      /\baccount\s*(?:no|number)\b/i,
      /\bopening\s*balance\b/i,
      /\bclosing\s*balance\b/i,
      /\bstatement\s*(?:of\s*account|period)\b/i,
      /\bdebit\b[\s\S]{0,80}\bcredit\b/i,
    ],
    weight: 2,
  },
  {
    type: 'payment_confirmation',
    patterns: [
      /\bpayment\s*confirmation\b/i,
      /\bpayment\s*received\b/i,
      /\btransaction\s*(?:id|reference|code)\b/i,
      /\bconfirmation\s*(?:of|code)\b/i,
    ],
    weight: 4,
  },
  {
    type: 'supplier_statement',
    patterns: [/\bsupplier\s*statement\b/i, /\bstatement\s*of\s*account\b/i, /\baged\s*(?:payable|receivable)\b/i],
    weight: 4,
  },
  {
    type: 'contract',
    patterns: [/\bagreement\b/i, /\bcontract\b/i, /\bterms\s*and\s*conditions\b/i, /\bparty\s*(?:a|of\s*the\s*first)\b/i],
    weight: 2,
  },
  {
    type: 'receipt',
    patterns: [/\breceipt\b/i, /\bpaid\s*(?:in\s*full|cash|by)\b/i, /\bthank\s*you\s*for\s*your\s*payment\b/i],
    weight: 3,
  },
  {
    type: 'accounting_export',
    patterns: [/\bgeneral\s*ledger\b/i, /\bjournal\s*entries?\b/i, /\btrial\s*balance\b/i, /\bchart\s*of\s*accounts\b/i],
    weight: 4,
  },
];

/**
 * Deterministic classifier. Confidence reflects how strongly the text matches
 * one document type relative to all others, not a model probability.
 */
export function classifyDocument(text, { filename = '', sheetNames = [] } = {}) {
  const haystack = `${filename}\n${sheetNames.join(' ')}\n${String(text).slice(0, 60_000)}`;
  const scores = RULES.map((rule) => {
    let hits = 0;
    for (const pattern of rule.patterns) {
      const matches = haystack.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`));
      if (matches) hits += Math.min(matches.length, 3);
    }
    return { type: rule.type, score: hits * rule.weight };
  }).sort((a, b) => b.score - a.score);

  const top = scores[0];
  const total = scores.reduce((sum, s) => sum + s.score, 0);
  if (!top || top.score === 0) return { type: 'other', confidence: 0.2, alternatives: [] };
  const confidence = Math.min(0.98, 0.45 + (top.score / Math.max(total, 1)) * 0.5);
  return {
    type: top.type,
    confidence: Number(confidence.toFixed(4)),
    alternatives: scores.filter((s) => s.score > 0).slice(1, 4),
  };
}
