# Delivery checklist

Status as of 24 November 2026. `[x]` means implemented and exercised; `[~]` means partially implemented or not production-proven. Details are in [docs/HANDOVER.md](docs/HANDOVER.md).

## Foundation

- [x] MySQL/TiDB schema (37 tables) with foreign keys and indexes.
- [x] Idempotent migration runner with checksum history (001–007).
- [x] scrypt password hashing, hashed session tokens, API-key hashing, AES-256-GCM credential vault, hash-chained audit writer.

## Authentication, RBAC and tenancy

- [x] Login/logout/me, six roles, session revocation, login rate limit.
- [x] Organisation ownership and institution access grants; cross-tenant reads return 404.
- [x] API keys with prefix lookup, hashing, expiry, revocation and scope enforcement.
- [~] Failed-login lockout is a rate limit, not a per-account lockout.
- [ ] MFA, email verification and password reset.

## Business identity (A)

- [x] Register/update businesses, identifiers, representatives and change history.
- [x] Country profiles for 11 African markets; Rwanda seeded as the initial market.
- [x] Explicit self-declared / documents-submitted / partially-verified / verified / rejected lifecycle.
- [x] Manual verification with reviewer, method, reference and note.
- [ ] Automated registry/tax API checks (not claimed).

## Documents and extraction (B)

- [x] Multipart upload, type/size validation, SHA-256 duplicate detection, private durable blob storage.
- [x] PDF text (`pdftotext`), OCR fallback (`tesseract`), CSV, XLSX and JSON extraction.
- [x] Deterministic classification and field extraction with confidence, page/snippet and provenance.
- [x] Processing status, retries, error capture, manual field review.
- [~] No malware scanning; OCR English language pack only.

## Invoice verification (C)

- [x] Invoices, lines, POs, contracts, delivery evidence, payments and status history.
- [x] Twelve deterministic rules with explanations and evidence.
- [x] Status set including `evidence_insufficient`, `inconsistent`, `verified`, `partially_verified`, `duplicate_suspected`, `disputed`.
- [x] Rule results stored in `verification_events` and exposed by the API.

## Reconciliation (D)

- [x] CSV/TSV and JSON transaction import with external-id dedupe.
- [x] Per-organisation amount/date/reference tolerances.
- [x] Exact/probable/partial/unmatched matching with explanations.
- [x] Human accept/reject; acceptance creates a reconciliation-sourced payment and audit entry.
- [~] No FX conversion; amounts must be in the same currency.

## Trust Record and evaluation (E, F)

- [x] Versioned snapshot with six weighted categories, coverage, confidence, discrepancies, provenance and audit state.
- [x] Documented weights and limitations; explicitly not a credit score.
- [x] Immutable prior versions with SHA-256 chaining and hash verification.
- [~] Hash chain is database-local; no external anchoring.

## Counterparties (G)

- [x] Buyer/supplier relationships linked to invoices.
- [x] Single-use confirmation tokens with expiry and recorded response/conflict.
- [x] Public page exposes only a limited invoice summary.
- [~] Link delivery is manual; no email/SMS provider.

## Integrations and payment adapters (H)

- [x] Provider catalogue with explicit capabilities and manual/file adapters.
- [x] Encrypted credential vault and real outbound connection tests.
- [x] Status reflects the recorded test, never a manually flipped live flag.
- [ ] Provider data synchronisation, webhooks, token refresh and payment initiation.

## API, reports, jobs and dashboard

- [x] Versioned `/api/v1` REST API, RBAC, validation, rate limiting, pagination, error envelope, OpenAPI 3.1.
- [x] PDF/CSV reports with generation date, sources, method and limitations.
- [x] Background job queue with retries, failed-job listing and requeue.
- [x] Dashboard views backed by live queries for every module; all visible controls functional.
- [~] Rate limiting is in-memory; jobs have no stale-lease recovery.

## Tests and verification

- [x] 30 integration tests against a real database.
- [x] 6 unit tests for hashing, dates and invoice status semantics.
- [x] Malformed input, cross-tenant access, grant-scope and API-key-scope tests.
- [x] "Unsupported evidence must not verify" test.
- [x] Synthetic multi-country seed through the real service layer.
- [ ] Browser E2E, load/soak, OCR benchmark, malware fuzzing, CVE scan and penetration test.

## Deployment and handover

- [x] Dockerfile, health check, production env contract, migration-on-boot.
- [x] Deploy and verify live health, login, business data, Trust Record and hash.
- [x] Documentation: architecture, API, methodology, security, deployment, integrations, testing and handover.
- [ ] Commit and push source to `planetpurestore-ai/African-financial-trust` with the landing page preserved. Delivery tree and local commit are ready; push is blocked by the connector's read-only repository permission (HTTP 403). The owner must grant Contents: Read and write.
- [ ] Cloudflare Pages rebuild of the landing page verified.
- [ ] Custom domain, MFA, email provider, backup restore drill and production hardening.
