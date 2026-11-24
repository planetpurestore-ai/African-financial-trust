# Repository audit and preservation record

**Audit date:** 24 November 2026
**Repository:** https://github.com/planetpurestore-ai/African-financial-trust
**Live landing page:** https://africanfinancialtrust.pages.dev/

## What existed before implementation

The GitHub repository contained a single static marketing site:

- `index.html` (approximately 2.1 MB, including embedded imagery and styling)
- `robots.txt`
- `sitemap.xml`
- No `package.json`, backend source, database schema, API, tests, Dockerfile or deployment configuration.

The landing page described the AFT proposition and linked “Access Trust Engine” to a separate Render prototype (`aft-trust-engine-free-mvp.onrender.com`). That prototype was not part of the repository and was not treated as source of truth. The Cloudflare Pages site served the static page for known and unknown paths.

## Findings

| Finding | Consequence |
| --- | --- |
| No application backend in the repository | A real backend, database and API had to be built, not restyled. |
| No database schema or migrations | A 37-table schema with versioned migrations was introduced. |
| No authentication or tenant model | Sessions, CSRF, roles, API keys, organisation ownership and institution grants were implemented. |
| No document pipeline | Upload validation, hashing, durable blob storage, extraction, provenance and review were implemented. |
| No invoice verification engine | A 12-rule deterministic engine with evidence statuses was implemented. |
| No reconciliation | CSV/TSV import, matching, human acceptance and payment creation were implemented. |
| No Trust Record or audit chain | Versioned, hash-chained Trust Records and a per-organisation audit chain were implemented. |
| No tests | 30 integration tests and 6 unit tests were added and pass against a real database. |
| Landing CTA pointed at an external prototype | The CTA now points at the deployed Trust Engine; the landing design and content were preserved. |
| No live external integrations | The integration catalogue is honest about credential tests vs data sync; no provider is claimed as live. |

## What was preserved

- The public landing page at the repository root, including its content, visual identity and metadata.
- The cream/white, dark navy, gold and teal palette; Georgia display typography and the AFT wordmark language.
- The dashboard’s professional financial-infrastructure aesthetic and navigation model.
- The existing public URL `africanfinancialtrust.pages.dev` as a separate static property. It was not replaced or redirected.

## What was added

A complete Trust Engine implementation under `trust-engine/`: Express/Node backend, MySQL/TiDB schema, authentication and RBAC, document ingestion and extraction, invoice verification, reconciliation, Trust Records, counterparty confirmation, integration catalogue and encrypted credentials, audit chain, reports, dashboard SPA, OpenAPI contract, Dockerfile, tests and documentation.

## What was deliberately not fabricated

- No business-registry, tax-authority, bank or mobile-money API is claimed as connected.
- No payment is initiated or settled by AFT.
- No AI model produces a score, verification conclusion or fraud finding.
- No live flag was flipped to make an integration appear connected.
- No dashboard statistic is hardcoded; counts come from database queries.
- No claim is made that the external Render prototype is the deployed engine.

## Residual audit items

The landing page's Cloudflare rebuild was not verified from this environment. The repository source now points the CTA at the new app, but the public page changes only when Cloudflare Pages rebuilds. The owner should confirm the deployment in the Cloudflare dashboard or connect the repository if it is not already connected.

The original Render prototype remains an external artifact. It should be retired or clearly labelled as a legacy prototype to avoid confusion with the deployed Trust Engine.
