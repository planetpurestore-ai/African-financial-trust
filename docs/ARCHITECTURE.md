# Architecture

## 1. Purpose and boundaries

AFT is verification infrastructure. It answers a narrow question: *what evidence exists about this business or transaction, where did each fact come from, and what can be consistently established from it?* It does not custody funds, lend, process payments, replace an accounting system or issue a statutory credit score.

The implementation is deliberately a modular monolith. A single Node.js process serves the API and the dashboard, runs database migrations at startup and processes document-extraction jobs. This keeps the first deployment operable without a message broker, object-storage account or separate frontend host. The module boundaries and database schema allow extraction workers or the dashboard to be split out later.

## 2. Runtime topology

```
Browser (vanilla ES modules)
        |
        | HTTPS, same-origin cookies + CSRF header
        v
Express 4 application  ──────────────►  Managed MySQL / TiDB
  ├─ /api/v1/*  (JSON API, OpenAPI)         37 tables, migrations 001–007
  ├─ /health, /ready                       audit chain + Trust Records
  ├─ static public/ (SPA shell)
  ├─ document extraction job worker
  └─ PDF/CSV report renderer
        |
        └─ short-lived filesystem workspace for pdftotext/tesseract
           (source bytes are stored in document_blobs)
```

- **Container:** Node 22 Debian slim with `poppler-utils` and `tesseract-ocr`.
- **Database:** MySQL 8-compatible managed TiDB in the hosted environment; MariaDB locally.
- **Files:** uploaded bytes are content-addressed by SHA-256 in `document_blobs`. The container filesystem is used only as a temporary workspace, so a restart does not lose evidence.
- **Jobs:** an in-process worker claims `processing_jobs` rows with a conditional update. It is safe for the current single-container deployment; a multi-replica deployment should move extraction to a dedicated worker or add lease/heartbeat recovery.
- **Reports:** generated on demand and stored under the storage directory for download. Report metadata is in the `reports` table; report bodies are not treated as durable evidence and can be regenerated.

## 3. Module map (mandate A–H)

| Mandate module | Implementation |
| --- | --- |
| A. Business identity | `src/modules/businesses/*`, `businesses`, `business_identifiers`, `business_representatives`, `business_history`; verification states are explicit, registry checks are manual and labelled as such. |
| B. Document ingestion | `src/modules/documents/*`, `src/modules/extraction/*`; upload validation, SHA-256, duplicate rows, private download, deterministic text/OCR/spreadsheet extraction, field provenance and human review. |
| C. Invoice / receivable verification | `src/modules/invoices/*`; 12-rule deterministic engine, line items, statuses, verification events, payment records. |
| D. Transaction reconciliation | `src/modules/transactions/*`; CSV/TSV statement import, normalisation, exact/probable/partial matching, review, acceptance and payment creation. |
| E. Trust Record | `src/modules/trust/*`; snapshot payload, category scores, coverage/confidence, grade, discrepancies, evidence items, versioning and hash chain. |
| F. Trust / evidence evaluation | Same module plus `verification_events`; weights are code-defined and versioned (`1.0.0`), not model-generated. |
| G. Counterparty verification | `src/modules/counterparties/*`; counterparty registry, single-use confirmation tokens, public confirmation endpoint, conflict recording. |
| H. Payment adapter architecture | `src/modules/integrations/*`; provider catalogue, encrypted credential vault, connection test, explicit manual/file adapters. No payment execution endpoint. |

Supporting modules: authentication/sessions (`src/modules/auth`), access grants (`src/modules/businesses/access.js`), audit (`src/lib/audit.js`), reports (`src/modules/reports`), admin/health (`src/modules/admin`), jobs (`src/modules/jobs`).

## 4. Request and security lifecycle

1. Helmet sets CSP and related headers. `/health` and `/ready` are unauthenticated.
2. `/api/v1` passes through an in-memory rate limiter.
3. `authenticate` resolves either an `aft_session` cookie (hashed token in `sessions`) or a bearer API key (hashed key in `api_keys`).
4. Session-authenticated state-changing requests require the `x-aft-csrf` header to match the non-HttpOnly `aft_csrf` cookie (double-submit). API keys are exempt from CSRF but remain scope/role constrained.
5. Route middleware applies `requireAuth`, `requireWriteRole` or role checks.
6. Business access is resolved through `getBusinessAccess`: owners see their own business; institutions see only businesses with an explicit, non-revoked `access_grants` row and a permitted scope. Missing access returns 404 rather than leaking existence.
7. Zod validates input. SQL uses parameter placeholders. Errors are normalised to `{ error: { code, message, request_id } }` without stack traces.
8. Mutating services write audit entries inside the same database transaction where practical. The audit chain head is locked with `SELECT ... FOR UPDATE` to prevent forks.

## 5. Data model

37 tables in seven migrations:

- **Tenancy and identity:** `organisations`, `users`, `sessions`, `access_grants`, `api_keys`, `country_profiles`, `org_settings`.
- **Business:** `businesses`, `business_identifiers`, `business_representatives`, `business_history`.
- **Evidence:** `documents`, `document_extractions`, `extracted_fields`, `document_blobs`.
- **Commercial records:** `counterparties`, `invoices`, `invoice_lines`, `invoice_status_history`, `purchase_orders`, `contracts`, `delivery_evidence`, `payment_records`.
- **Reconciliation:** `import_batches`, `transactions`, `reconciliations`, `reconciliation_matches`.
- **Trust and audit:** `trust_records`, `evidence_items`, `verification_events`, `audit_logs`, `audit_chain_heads`.
- **Platform:** `integrations`, `integration_credentials`, `processing_jobs`, `idempotency_keys`, `reports`.

Every business-scoped row carries `business_id`; tenant ownership is additionally enforced by `organisations` and `access_grants`. Foreign keys and indexes are defined in `db/migrations/`. The migration runner records filename and SHA-256 checksum in `schema_migrations` and refuses changed applied migrations.

### Provenance levels

The system distinguishes:

- `self_declared` — entered by the business, not independently checked.
- `document_extracted` — parsed from an uploaded source file; field confidence and snippet are retained.
- `counterparty_confirmed` — a counterparty used a single-use link to confirm an invoice.
- `independently_verified` — a reviewer recorded a registry/tax/other check with a reference. No automated registry API is claimed.

A document upload never silently becomes “verified”. Invoice rules and Trust Record categories read the evidence state and report gaps explicitly.

## 6. Document pipeline

1. Multer writes the upload to a temporary directory with a 25 MB default limit.
2. MIME allowlist and magic-byte checks reject mismatched files.
3. SHA-256 is computed. A duplicate in the same business creates a `duplicate` document row that points to the original; bytes are shared by content hash.
4. Non-duplicate bytes are inserted into `document_blobs` (`LONGBLOB`) under the hash, then the `documents` row is created and a `document.extract` job is queued.
5. The worker writes a temporary working copy, extracts text (`pdftotext`; OCR via `pdftoppm` + `tesseract`; CSV via `csv-parse`; XLSX via ExcelJS), classifies the document, extracts fields with snippets/confidence and stores an extraction run plus field rows.
6. Low-confidence extraction becomes `needs_review`; a reviewer can correct a field, which is recorded in the audit trail with previous and new values.
7. Downloads require business access; duplicate rows resolve to the original blob.

## 7. Invoice and Trust Record computation

Invoice verification is pure deterministic code in `src/modules/invoices/rules.js`. The result contains per-rule status, weight, detail and evidence, plus score, coverage, confidence, corroboration count, status and limitations. The invoice row stores the latest status/score and a `verification_events` row records the outcome.

Trust Records are snapshots, not live views. `buildTrustRecord` reads current business, invoice, payment, transaction, counterparty, identifier, reconciliation and audit data; computes six weighted categories; applies a coverage penalty (`weighted × (0.5 + 0.5 × coverage)`); assigns grade A–E; and stores the complete payload, evidence items and a SHA-256 hash chained to the previous record. Regenerating a record creates a new version and supersedes the old one. Verification recomputes the hash from the stored JSON, so tampering with the payload is detectable.

## 8. Failure and operational behaviour

- **Database unavailable:** `/health` returns 503; API requests fail with structured errors.
- **Extraction failure:** the document becomes `failed`, the job retries with exponential backoff up to `max_attempts`, and the error is visible in the dashboard.
- **Worker crash:** a `running` job can remain stuck because there is no lease heartbeat. Operators can inspect `/system/jobs`; a restart does not automatically reclaim stale `running` rows. This is a known limitation for multi-instance or high-volume operation.
- **Report generation:** PDF/CSV is rendered synchronously; large portfolios should be moved to a background job.
- **Rate limiting:** in-memory per process, so limits are not shared across replicas.

## 9. Deliberate non-goals

No payment initiation, no custody, no lending decision, no statutory credit score, no automated registry/tax API claim, no AI-generated verification conclusion, and no claim that a document alone proves a transaction occurred. These boundaries are enforced in code and stated in reports and the UI.
