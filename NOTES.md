# Working notes (internal)

## Environment
- Project dir: `/home/ubuntu/aftengine` (Manus webdev project `wdp_d05f9cca2ce04f6e3b1f5333`, resource `manus-resource://manus-webdev/project/wdp_d05f9cca2ce04f6e3b1f5333`).
- Managed DB: TiDB Serverless, `DATABASE_URL` injected in project env (not shell). Schema migrated (37 tables).
- Local dev/test DB: `mysql://aft:aft_dev_password@127.0.0.1:3306/aft_dev` (MariaDB 10.11). Tests use `aft_test`.
- `dotenv` does not override existing env, so pass `DATABASE_URL=` explicitly for local runs.
- Local server test: `DATABASE_URL='mysql://aft:aft_dev_password@127.0.0.1:3306/aft_dev' PORT=3000 node src/server.js`.
- TiDB ignores CHECK constraints; application zod schemas enforce enums.
- tesseract + pdftotext installed locally; Dockerfile must install `tesseract-ocr poppler-utils`.

## Repo audit facts
- GitHub repo `planetpurestore-ai/African-financial-trust` = single `index.html` (2.1 MB) marketing page only; no backend, DB, API or tests.
- `africanfinancialtrust.pages.dev` serves that file; unknown paths return it with 200.
- Homepage links to `aft-trust-engine-free-mvp.onrender.com` (separate, not in repo; ~44 s cold start, 55 KB single-page prototype).
- GitHub connector exists but is disabled (`bbb0df76-66bd-4a24-ae4f-2aac4750d90b`). Need to enable via `manus-config connector ensure --uid ...` (shows user card) before pushing.

## Progress
- Backend modules written: auth/RBAC, businesses, documents+extraction, invoices+rules, transactions+reconciliation, trust records, counterparties, integrations, audit, admin, reports, jobs, OpenAPI.
- Seed script written (`scripts/seed.js`) with 11 countries, 7 orgs, 4 businesses, generated invoice PDFs.
- Currently debugging: transaction-visibility (fixed in invoices), then trust/documents getters, then seed.

## Remaining
1. Fix `getTrustRecord`/`getDocument` inside transactions (same pool-visibility bug).
2. Run seed; fix errors; verify invoice statuses and trust scores.
3. Build dashboard (public/) — navy rail, cream canvas, gold/teal, real API only.
4. Tests (node:test + supertest) against aft_test: auth, RBAC, tenant isolation, upload/extraction, invoice rules, duplicates, reconciliation, trust record, audit chain, API.
5. Dockerfile, app.config.ts logoUrl, routes config, deploy, verify live.
6. Docs: AUDIT, ARCHITECTURE, API, METHODOLOGY, SECURITY, DEPLOYMENT, INTEGRATIONS, HANDOVER.
7. Push to GitHub (needs connector enabled) and update landing page link if possible.
8. Final handover message with live URL, repo, test results, honest limitations.

## Seeded credentials (local; regenerate for production)
Password default `AftDemo!2026#Kigali`; accounts:
admin@africanfinancialtrust.africa (system_admin), auditor@africanfinancialtrust.africa (auditor),
analyst@kigalicommercial.rw (institution_admin), credit@kigalicommercial.rw (institution_analyst),
analyst@nairobicapital.ke (institution_analyst, no grants), finance@kigalifresh.rw,
accounts@nyamirambotextiles.rw, finance@gasabologistics.rw, finance@nairobiagro.co.ke (business_admin).
