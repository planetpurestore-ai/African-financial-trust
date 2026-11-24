# African Financial Trust — Trust Engine

African Financial Trust (AFT) is independent B2B financial-trust infrastructure. The Trust Engine ingests transaction evidence, verifies invoices against deterministic rules, reconciles bank and mobile-money records, records counterparty confirmations and produces evidence-based, tamper-evident Trust Records for businesses and institutions.

This repository is the working Trust Engine implementation, not a marketing prototype. It includes a real Express/MySQL backend, a database schema with migrations, document ingestion and extraction, invoice verification, reconciliation, an audit chain, a role-based dashboard, PDF/CSV reports, an OpenAPI contract and an integration-test suite.

## Live application

- Trust Engine: **https://aftengine-dgfbrcn2.manus.space**
- Existing public landing page: https://africanfinancialtrust.pages.dev/
- Source repository: https://github.com/planetpurestore-ai/African-financial-trust

The Trust Engine is a container deployment with a managed TiDB database. The landing page remains a separate static site. The landing page's “Access Trust Engine” link points at the deployed Trust Engine.

## What is operational

- Email/password authentication with scrypt hashing, server-side sessions, CSRF protection, API keys and role-based access control.
- Organisation tenancy, business ownership, institution access grants and cross-tenant query isolation.
- Business identity records with self-declared, document-submitted, partially verified and verified states.
- PDF, CSV, XLSX, JSON, PNG, JPEG and TIFF document ingestion with content hashing, duplicate detection, signature checks, private downloads and durable database-backed blob storage.
- Deterministic extraction (pdftotext, tesseract OCR, csv-parse, ExcelJS) with field-level confidence, snippet and provenance. No AI model is called.
- Invoice verification with 12 deterministic rules, evidence coverage, confidence, discrepancies and explicit `verified`, `partially_verified`, `inconsistent`, `duplicate_suspected`, `evidence_insufficient` and `disputed` states.
- Purchase orders, contracts, delivery evidence and payment records.
- CSV/TSV bank-statement import, exact/probable/partial matching, review and acceptance; accepting a match creates a reconciliation-sourced payment.
- Counterparty registry and single-use public confirmation links. Confirmation does not move money.
- Versioned Trust Records with category weights, evidence grades, coverage, confidence, discrepancies, provenance and a SHA-256 hash chain.
- Hash-chained audit log per organisation, with verification and tamper detection.
- PDF and CSV reports with generation date, sources, methodology and limitations.
- Dashboard views backed by live database queries: overview, businesses, documents, invoices, reconciliation, counterparties, integrations, audit, reports, system health and trust index.
- OpenAPI 3.1 contract at `/api/v1/openapi.json`, versioned `/api/v1` API and unauthenticated `/health` and `/ready` probes.
- 28 integration tests and 6 unit tests, run against a real MySQL/MariaDB database.

## What is not operational

Read [docs/HANDOVER.md](docs/HANDOVER.md) before representing this system to a customer, regulator or investor.

- No business-registry, tax-authority, bank, mobile-money or payment provider is connected in production. Integration records can store encrypted credentials and test connectivity, but no provider data is synchronised and no payment is initiated.
- No transactional email or SMS provider is configured. Counterparty confirmation links are returned in the API/UI for manual sending.
- No AI extraction, credit score, lending decision or automated fraud conclusion is produced. Verification is deterministic and evidence-based.
- Demo accounts use a published password and must be removed or rotated before any real use.
- The landing page's Cloudflare deployment is separate from this container. Updating the GitHub landing source does not by itself prove Cloudflare rebuilt the page.

## Local development

Prerequisites: Node.js 22+, MySQL 8+/MariaDB 10.6+, `pdftotext`, `pdftoppm` and `tesseract` for PDF/OCR extraction.

```bash
npm ci
cp .env.example .env
# edit DATABASE_URL and APP_ENCRYPTION_KEY
npm run migrate
npm run seed        # optional synthetic demonstration dataset
npm start           # http://localhost:3000
```

Tests use a separate database and never the demonstration data:

```bash
mysql -uroot -e "CREATE DATABASE IF NOT EXISTS aft_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
TEST_DATABASE_URL='mysql://user:password@127.0.0.1:3306/aft_test' npm test
npm run test:unit
```

The default test suite disables the background worker and uses a temporary storage directory. See [docs/TESTING.md](docs/TESTING.md).

## Demo accounts

The seeded demonstration dataset uses the password `AftDemo!2026#Kigali` for every account. These are synthetic records for evaluation only.

| Role | Email |
| --- | --- |
| System administrator | `admin@africanfinancialtrust.africa` |
| Read-only auditor | `auditor@africanfinancialtrust.africa` |
| Institution administrator | `analyst@kigalicommercial.rw` |
| Institution analyst | `credit@kigalicommercial.rw` |
| Business administrator — Kigali Fresh | `finance@kigalifresh.rw` |
| Business administrator — Nyamirambo Textiles | `accounts@nyamirambotextiles.rw` |
| Business administrator — Gasabo Logistics | `finance@gasabologistics.rw` |
| Business administrator — Nairobi Agro | `finance@nairobiagro.co.ke` |

## Documentation

- [Repository audit and preservation record](docs/AUDIT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [API](docs/API.md)
- [Verification methodology](docs/METHODOLOGY.md)
- [Security](docs/SECURITY.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Integrations](docs/INTEGRATIONS.md)
- [Testing](docs/TESTING.md)
- [Handover and honest status](docs/HANDOVER.md)

## Stack

Node.js 22, Express 4, MySQL/TiDB via `mysql2`, vanilla ES-module dashboard, PDFKit, ExcelJS, csv-parse, multer, helmet, zod. No ORM and no frontend framework; migrations and SQL are explicit.

## Licence and ownership

Source prepared for African Financial Trust. No open-source licence is granted by this repository unless one is added by the owner.
