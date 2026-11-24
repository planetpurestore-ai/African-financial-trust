# TODO

## 1. Foundation: database, migrations, security primitives
- [ ] MySQL schema covering organisations, users, businesses, documents, extraction, invoices, POs, contracts, delivery evidence, payments, transactions, reconciliation, trust records, evidence, verification events, audit logs, integrations, credentials, API keys, jobs, idempotency, country profiles, settings, reports.
- [ ] Idempotent migration runner with `schema_migrations` history; foreign keys and indexes applied.
- [ ] Password hashing (scrypt), JWT session cookies, API-key hashing, AES-256-GCM credential vault, hash-chained audit writer.

## 2. Authentication, RBAC and tenant isolation
- [ ] Login/logout/me; six roles; session revocation; failed-login lockout.
- [ ] Every business-scoped endpoint enforces organisation ownership or an active access grant; cross-tenant reads return 404, not another tenant's data.
- [ ] API keys with scopes, prefix lookup, revocation and last-used tracking.

## 3. Business identity (Module A)
- [ ] Register/update businesses with legal name, trading name, registration number, tax ID, country, address, representatives.
- [ ] Country profile architecture seeded for Rwanda plus nine other African markets; labels and identifier formats come from the profile, not hardcoded.
- [ ] Verification status lifecycle and full change history; self-declared vs independently verified distinction.
- [ ] Manual verification workflow with reviewer, method, reference and evidence note.

## 4. Document ingestion and extraction (Module B)
- [ ] Multipart upload with type/size validation, SHA-256 dedupe, versioning, private storage outside the web root.
- [ ] Text extraction: PDF text layer (`pdftotext`), CSV, XLSX, JSON; OCR fallback for images/scanned PDFs via `tesseract`.
- [ ] Deterministic document classification (invoice, purchase order, contract, delivery note, receipt, bank statement, payment confirmation, credit note, supplier statement, accounting export).
- [ ] Field extraction with per-field provenance: value, confidence, page, snippet, method.
- [ ] Processing status, retries, error capture, duplicate-document detection, manual review path.

## 5. Invoice verification (Module C)
- [ ] Invoice, purchase order, contract and delivery evidence records with line items and status history.
- [ ] Rules: required fields, numbering/date sanity, arithmetic, issuer identity match, duplicate detection, PO/contract/delivery comparison, payment corroboration, overdue/partial payment, disputes.
- [ ] Status set: pending, evidence_insufficient, in_progress, verified, partially_verified, inconsistent, disputed, duplicate_suspected, rejected.
- [ ] Rule-level results stored and exposed with explanations; no status without supporting evidence.

## 6. Transaction reconciliation (Module D)
- [ ] Import normalised bank, mobile-money, PSP and accounting transactions with external-id dedupe.
- [ ] Configurable tolerances (amount absolute/percent, date window, reference matching) per organisation.
- [ ] Explainable matching: exact, probable, partial, unmatched; partial payments, fees, FX differences.
- [ ] Human accept/reject of suggested matches; every decision auditable.

## 7. Trust Record and evidence evaluation (Modules E, F)
- [ ] Versioned Trust Record snapshot with identity, documents, invoices, receivables, payments, counterparties, reconciliation, discrepancies, completeness, provenance, audit.
- [ ] Transparent weighted evidence model with documented weights, coverage, confidence and limitations; separate from creditworthiness.
- [ ] Immutable prior versions; regeneration creates a new version with hash linkage.

## 8. Counterparties (Module G)
- [ ] Buyer/supplier relationships linked to invoices and transactions.
- [ ] Confirmation workflow with token, expiry and recorded response; conflicting information detection.
- [ ] Confidentiality: a counterparty can confirm an invoice without gaining access to the other business's records.

## 9. Integrations and payment adapters (Module H)
- [ ] Adapter catalogue (M-Pesa, MTN MoMo, Airtel Money, Flutterwave, Paystack, bank transfer, open banking, accounting/ERP) with explicit capability and status.
- [ ] Real connector interface and credential vault; status reflects actual configuration, never a flipped flag.
- [ ] All providers that lack credentials remain `awaiting_credentials` with documented requirements.

## 10. API, reports, jobs, dashboard
- [ ] Versioned REST API with auth, RBAC, validation, rate limiting, idempotency, pagination, error envelope, OpenAPI document.
- [ ] CSV and PDF reports generated from live records, each stating generation date, sources, method and limitations.
- [ ] Background job queue with retries, failed-job listing and requeue.
- [ ] Dashboard views for every module, all values from the API, every control functional.

## 11. Tests and verification
- [ ] Automated tests for auth, RBAC, tenant isolation, business registration, upload/extraction, invoice rules, duplicates, reconciliation, trust records, provenance, audit chain, API contract, failure handling.
- [ ] Malformed/malicious input tests; cross-tenant access tests; "unsupported evidence must not verify" test.
- [ ] Seed dataset (Rwanda-focused, multi-country) loaded through the real service layer, not raw fixtures.

## 12. Deployment and handover
- [ ] Dockerfile, health check, production env contract, migration-on-boot.
- [ ] Deploy, verify live endpoints and dashboard against the deployed database.
- [ ] Repository documentation: audit findings, architecture, API, methodology, security, deployment, integration status, honest limitations.
- [ ] Commit and push to `planetpurestore-ai/African-financial-trust`.
