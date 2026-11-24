# African Financial Trust

African Financial Trust (AFT) is independent B2B financial-trust infrastructure. It turns fragmented transaction evidence into verified, evidence-based Trust Records for businesses and institutions.

This repository contains:

- The public AFT landing page at the repository root (`index.html`, `robots.txt`, `sitemap.xml`), preserved from the original site.
- The full Trust Engine implementation in [`trust-engine/`](trust-engine/): Express/Node backend, MySQL/TiDB schema, document ingestion and extraction, invoice verification, reconciliation, counterparty confirmation, Trust Records, audit chain, reports, dashboard, API, Dockerfile and tests.

## Live applications

- **Trust Engine:** https://aftengine-dgfbrcn2.manus.space
- **Landing page:** https://africanfinancialtrust.pages.dev/

The landing page's “Access Trust Engine” link points at the deployed Trust Engine. The landing page remains a separate static Cloudflare Pages property; a GitHub push does not by itself prove Cloudflare rebuilt it.

## Trust Engine status

Operational: authentication and RBAC, tenant isolation, business identity records, PDF/CSV/XLSX/image ingestion, deterministic extraction, invoice verification (12 rules), reconciliation, counterparty confirmation links, versioned hash-chained Trust Records, audit chain, PDF/CSV reports, dashboard, versioned API, 30 integration tests and 6 unit tests.

Not operational: no live bank, mobile-money, payment, registry, tax or email provider is connected; no payment is initiated; no AI model is called; demo accounts use a published password and must be rotated. See the full [handover](trust-engine/docs/HANDOVER.md), [architecture](trust-engine/docs/ARCHITECTURE.md), [API](trust-engine/docs/API.md), [methodology](trust-engine/docs/METHODOLOGY.md), [security](trust-engine/docs/SECURITY.md) and [deployment](trust-engine/docs/DEPLOYMENT.md) documents.

## Quick start

```bash
cd trust-engine
npm ci
cp .env.example .env
# set DATABASE_URL and APP_ENCRYPTION_KEY
npm run migrate
npm run seed   # optional synthetic dataset
npm start
```

Tests:

```bash
TEST_DATABASE_URL='mysql://user:password@127.0.0.1:3306/aft_test' npm test
npm run test:unit
```

## Repository layout

```
.
├── index.html, robots.txt, sitemap.xml   # original landing page
├── README.md
└── trust-engine/                         # full Trust Engine application and documentation
```

No open-source licence is granted unless one is added by the owner.
