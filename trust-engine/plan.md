# African Financial Trust — Trust Engine: implementation plan

## Starting point (verified)

- `planetpurestore-ai/African-financial-trust` contains one file: `index.html` (2.1 MB, mostly embedded imagery). No backend, database, API, build step or tests.
- `africanfinancialtrust.pages.dev` serves that static page. All unknown paths return the same 2.1 MB HTML (HTTP 200), so `/engine`, `/dashboard` and `/trust-engine` are not applications.
- The homepage links to `aft-trust-engine-free-mvp.onrender.com`, a separate prototype that is not in the repository. It cold-starts in ~44 s and exposes a single-page interface (overview, transactions, evidence, documents, reconciliation, audit, reports, connections).
- Consequence: there is no source of truth for the Trust Engine in the repository, and no persistence behind the interface.

## Target architecture

A single Node.js service (Express, ESM) with a MySQL-compatible database, serving both the JSON API and the institutional dashboard.

```
Browser dashboard  ─┐
API clients        ─┼─►  Express  ─►  service layer  ─►  MySQL 8
Webhooks / jobs    ─┘        │                │
                             │                ├─ extraction pipeline (PDF text, CSV/XLSX, OCR)
                             │                ├─ deterministic verification rule engine
                             │                ├─ reconciliation engine
                             │                └─ evidence/trust evaluator + hash-chained audit
                             └─ static dashboard (no build step)
```

Design choices:

1. **No ORM.** Parameterised SQL through `mysql2` with a small repository layer. Keeps the schema explicit and portable to any MySQL 8 host.
2. **Server-rendered nothing, static SPA dashboard.** Vanilla ES modules, hash routing, no bundler. The container serves `/` from `public/`; every number on screen comes from `/api/v1`.
3. **Deterministic verification first.** Rules are code with named IDs, explicit inputs, outcomes and human-readable explanations. AI extraction is an optional adapter, disabled by default, and can never set a verification status.
4. **Provenance is a first-class column.** Every value carries `provenance_level`: `self_declared`, `document_extracted`, `counterparty_confirmed`, `independently_verified`.
5. **Multi-tenant by construction.** Every query is scoped by organisation; institution access to a business requires an explicit `access_grants` row.
6. **Tamper-evident audit.** Per-organisation SHA-256 hash chain over canonical JSON; a verify endpoint recomputes it.

## Modules and files

```
db/migrations/            numbered SQL migrations, applied by src/db/migrate.js
src/server.js             HTTP bootstrap, security headers, static hosting
src/db/                   pool, migration runner, transaction helper
src/lib/                  ids, crypto, jwt, passwords, validation, errors, pagination
src/middleware/           session auth, API-key auth, RBAC, tenant scope, rate limit, idempotency
src/modules/
  auth/                   login, logout, sessions, users
  businesses/             registration, identity, history, verification
  documents/              upload, validation, dedupe, extraction orchestration
  extraction/             pdf/csv/xlsx/ocr adapters, classifier, field parser
  invoices/               invoice + PO + contract + delivery evidence, verification rules
  transactions/           imports, normalisation, reconciliation engine
  trust/                  evidence evaluation, trust record snapshots
  counterparties/         relationships and confirmation workflow
  integrations/           adapter catalogue, credential vault, status checks
  audit/                  hash chain, event log, verification
  reports/                CSV + PDF generation
  jobs/                   queue, worker, retries, failed jobs
  admin/                  system health, metrics
public/                   dashboard (index.html, css, js views)
tests/                    node:test + supertest, real MySQL test schema
docs/                     architecture, API, methodology, security, deployment, audit
```

## Data model (principal tables)

`organisations`, `users`, `sessions`, `access_grants`, `businesses`, `business_identifiers`, `business_history`, `counterparties`, `documents`, `document_extractions`, `extracted_fields`, `invoices`, `invoice_lines`, `purchase_orders`, `contracts`, `delivery_evidence`, `payment_records`, `transactions`, `reconciliations`, `reconciliation_matches`, `trust_records`, `evidence_items`, `verification_events`, `audit_logs`, `integrations`, `integration_credentials`, `api_keys`, `processing_jobs`, `idempotency_keys`, `country_profiles`, `org_settings`, `reports`.

All money is `DECIMAL(20,4)` with an ISO-4217 currency column. All timestamps are UTC `DATETIME(3)`. Foreign keys are enforced; every tenant-owned table is indexed on its organisation/business scope.

## Verification methodology (summary)

Evidence score is a weighted sum over six categories (identity 20, invoice integrity 20, purchase order 15, delivery 10, payment corroboration 20, counterparty confirmation 15), each scored 0–100 from deterministic checks and multiplied by coverage. The output is explicitly an **evidence confidence** measure, not a credit score. Grade bands: A ≥ 80, B ≥ 65, C ≥ 50, D ≥ 30, E < 30. Every score ships with the rule results, weights, coverage, confidence and limitations that produced it. Full method in `docs/METHODOLOGY.md`.

## Design direction

Reuses the established AFT identity rather than inventing a new one.

- **Palette:** cream `#f7f5ef` workspace, navy `#071b2b` sidebar and headers, gold `#c69a43` for primary actions and accents, teal `#39786f` for verified states.
- **Typography:** Georgia serif for display headings, Inter/system sans for operational data, tabular numerals in tables.
- **Layout:** persistent navy rail, cream content canvas, thin gold rules, dense but calm data tables, evidence drawers on the right.
- **Signature elements:** the gold hairline under section titles, a circular evidence-confidence gauge, and provenance chips (Self-declared / Extracted / Confirmed / Verified).
- **No stock photography, no silhouettes, no decorative illustrations.** Data is the visual.

## Delivery

Local MySQL for development and tests; managed MySQL for the deployed instance. Migrations run idempotently at boot. Dockerfile installs `tesseract-ocr` and `poppler-utils` for OCR/PDF text. Deployment is a container with `/health` readiness, and the code remains deployable to Cloudflare/Fly/Render/a VPS by changing `DATABASE_URL`.
