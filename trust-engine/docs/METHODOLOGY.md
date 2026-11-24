# Verification methodology

Methodology version **1.0.0**. It is code-defined, deterministic and versioned in the Trust Record payload. It is not a credit score, a probability of default, a lending recommendation or a statutory audit opinion.

## 1. Evidence and provenance

AFT keeps four provenance levels distinct:

| Level | Meaning | How it is established |
| --- | --- | --- |
| `self_declared` | Supplied by the business or an operator, not independently checked | Form input |
| `document_extracted` | Parsed from an uploaded file | pdftotext / OCR / CSV / XLSX extraction; field confidence and snippet retained |
| `counterparty_confirmed` | The other party recognised the invoice through a single-use link | Public confirmation endpoint |
| `independently_verified` | A human recorded a registry, tax or field check with a reference | Manual verification decision + reference |

A document being present does **not** make an invoice verified. A counterparty confirmation does **not** prove payment. A payment record does **not** prove the goods were delivered. The rules below reward independent corroboration and report gaps.

## 2. Invoice verification

Each invoice is evaluated against 12 rules. Every rule returns `pass`, `warn`, `fail` or `skip`, a weight, a human-readable detail and structured evidence.

| Rule | Weight | Category | What passes |
| --- | ---: | --- | --- |
| `required_fields` | 10 | Integrity | Invoice number, issue date, currency, positive total and counterparty are present |
| `arithmetic` | 15 | Integrity | Line totals equal subtotal; subtotal + tax equals total (0.05 tolerance) |
| `date_sanity` | 5 | Integrity | Issue date not in the future or older than seven years; due date not before issue date |
| `number_integrity` | 5 | Integrity | No other invoice with the same number, or same counterparty/amount/date |
| `issuer_match` | 10 | Identity | Document text or extracted supplier name matches the registered business (≥ 0.6 similarity) |
| `counterparty_identified` | 10 | Counterparty | Counterparty has a registration number or is confirmed |
| `po_match` | 15 | Commercial | Purchase order exists, amount/currency match and PO date is not after the invoice |
| `contract_match` | 5 | Commercial | Contract covers the invoice date |
| `delivery_evidence` | 10 | Fulfilment | Delivery note linked and dated on/after the invoice |
| `payment_corroboration` | 15 | Payment | Payment record or matching bank/mobile-money transaction exists; full payment scores higher |
| `document_support` | 5 | Document | A source document is attached |
| `tax_consistency` | 5 | Integrity | Tax is non-negative, not greater than total, and ≤ 35% of subtotal |

**Score** = weighted pass proportion of non-skipped rules (warn = half credit). **Coverage** = weight of non-skipped rules ÷ total weight of all rules. **Confidence** = coverage × extraction field confidence (default 0.8).

### Status rules

- `disputed` — invoice status is disputed.
- `duplicate_suspected` — `number_integrity` failed.
- `inconsistent` — arithmetic, date sanity, tax consistency or issuer identity failed. These are contradictions, not mere gaps.
- `verified` — score ≥ 85, at least two independent corroboration categories passed, coverage ≥ 60%.
- `partially_verified` — score ≥ 60 and at least one corroboration category passed.
- `evidence_insufficient` — everything else. Missing counterparties, POs, delivery notes or payments are gaps, not proof of inconsistency.
- `evidence_insufficient` is also used when there is no document and no corroboration.

Corroboration categories are `po_match`, `contract_match`, `delivery_evidence`, `payment_corroboration` and `counterparty_identified`.

### Limitations

- OCR errors are possible; field confidence is reported separately and low-confidence documents are flagged for review.
- A document can be forged. AFT records provenance and hashes; it does not authenticate the issuer's signature or verify the document against the issuer's systems.
- Absence of a PO, contract or delivery note is recorded as missing evidence, not as fraud.
- Verification reflects the evidence available at the time. Later evidence can change the result; historical Trust Records are immutable snapshots.

## 3. Transaction reconciliation

Statements are imported as CSV/TSV (or JSON rows) with a mapping. Transactions are normalised to business, source type, provider, direction, amount, currency, value date, reference, description and counterparty name.

Matching compares open invoices with transactions using amount tolerance, date window and reference/text similarity. Each match is classified:

- `exact` — strong amount/date/reference agreement.
- `probable` — amount and date agree within tolerance, weaker reference.
- `partial` — some fields agree; requires human review.
- `unmatched` — no acceptable candidate.

A suggested match does not change financial records until a user accepts it. Accepting creates a `payment_records` row with source `reconciliation` and links it to the transaction. Rejecting preserves the audit trail and leaves the transaction unmatched. The matching algorithm is deterministic; it does not use an LLM.

## 4. Trust Record

A Trust Record is a point-in-time snapshot across six categories:

| Category | Weight | Sub-score source |
| --- | ---: | --- |
| Identity evidence | 20 | Business verification status (verified 100, partially 65, documents submitted 40, self-declared 20, unverified 0) plus 10 per independently verified identifier, capped at 100 |
| Invoice integrity | 20 | Average invoice verification score, minus 15 per duplicate-suspected and 10 per inconsistent invoice, floored at 0 |
| Purchase order corroboration | 15 | Verified invoices with a PO ÷ invoices citing a PO |
| Delivery evidence | 10 | Delivery records ÷ invoices, capped at 100 |
| Payment corroboration | 20 | Payments ÷ total invoiced value, capped at 100 |
| Counterparty confirmation | 15 | Confirmed counterparties ÷ counterparties |

Only categories with applicable evidence are included. The weighted score is:

```
weighted = Σ(category score × category weight) / Σ(applicable category weight)
coverage = Σ(applicable weights) / 100
evidence_score = weighted × (0.5 + 0.5 × coverage)
confidence = coverage × (0.9 if documents exist else 0.6)
```

The coverage factor deliberately penalises a profile built from a narrow evidence base. A business with one perfect invoice cannot reach an A grade without broader evidence.

**Grades:** A ≥ 80, B ≥ 65, C ≥ 50, D ≥ 30, E < 30.

**Status:** `verified_profile` when score ≥ 80 and coverage ≥ 0.7; `partially_evidenced` when score ≥ 50; otherwise `limited_evidence`; `insufficient_evidence` when no category applies.

Each record also lists discrepancies (inconsistent/duplicate invoices, overdue receivables, unmatched transactions, missing registration, no documents), provenance counts and the audit-chain state.

### Immutability and hash chain

The complete payload is canonicalised (sorted keys, JSON round-trip semantics) and hashed with SHA-256, chained to the previous record's hash. `GET /trust-records/{id}/verify-hash` recomputes from the stored JSON. Changing the payload breaks the hash. Creating a new version supersedes the prior record; historical versions remain queryable.

The hash proves integrity of the stored record relative to its own content and predecessor. It does **not** prove that the underlying evidence is true, nor that the database operator could not rewrite the whole chain. Stronger non-repudiation would require external anchoring (e.g. publishing hashes to a third party or a public ledger), which is not implemented.

## 5. Human review

- Low-confidence extraction becomes `needs_review`.
- A reviewer can correct an extracted field; the previous value, new value and actor are audited.
- Identity verification is a manual decision with a method, reference and note.
- Reconciliation matches require explicit acceptance.
- Integration connection tests record the observed HTTP result; they do not claim a data connection.

## 6. What AFT does not claim

- No AI-generated score, narrative or fraud conclusion.
- No creditworthiness, default probability or repayment prediction.
- No verification of a business registry or tax authority through an API.
- No confirmation that funds moved, goods were delivered or a document is authentic beyond the recorded evidence.
- No legal, audit, accounting or investment advice.

Reports repeat the methodology version, generation date, sources and these limitations.
