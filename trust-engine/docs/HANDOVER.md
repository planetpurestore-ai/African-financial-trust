# Handover

**Prepared:** 24 November 2026
**Application:** African Financial Trust — Trust Engine
**Live URL:** https://aftengine-dgfbrcn2.manus.space
**Repository:** https://github.com/planetpurestore-ai/African-financial-trust
**Existing landing page:** https://africanfinancialtrust.pages.dev/

This document is the honest status of the build. It distinguishes what is operational, what is partial, and what is not implemented. Do not upgrade any statement below into a claim of a live bank, registry, payment or AI integration.

## 1. Executive status

The Trust Engine is a working full-stack application. It has a real database, authentication, tenant isolation, document ingestion, deterministic extraction, invoice verification, transaction reconciliation, counterparty confirmation, versioned Trust Records, a hash-chained audit log, PDF/CSV reports, a role-based dashboard, a versioned API and automated tests. It is deployed and publicly reachable, and the live instance has been verified with a real login and a real Trust Record hash check.

It is **not** a production-certified financial institution platform. No external registry, bank, mobile-money, payment or email provider is connected. The synthetic demo accounts were disabled in production, their sessions revoked and audit events recorded; their known password remains in source history and must never be used for real onboarding. There has been no penetration test, load test, backup restore drill or regulatory review. TOTP MFA is now implemented and tested locally, but the published runtime still requires the next deployment and production administrator enrollment before real customer onboarding.

## 2. What was delivered

| Area | Status | Evidence |
| --- | --- | --- |
| Backend API | Operational | Express/Node 22, `/api/v1`, OpenAPI 3.1 at `/api/v1/openapi.json` |
| Database | Operational | 40 tables, migrations 001–009, managed TiDB in hosting, MariaDB in tests |
| Authentication | Operational; MFA pending deployment/enrollment | scrypt passwords, sessions, CSRF, API keys, roles, logout, expiring single-use invitations/password activation, TOTP challenge and recovery codes |
| Tenant isolation | Operational | Organisation ownership, institution grants, scope checks, cross-tenant tests |
| Business identity | Operational (manual checks) | Business records, identifiers, representatives, history, manual verification decisions |
| Document ingestion | Operational | PDF/CSV/XLSX/JSON/images, SHA-256, duplicate detection, private download, durable blobs |
| Extraction | Operational (deterministic) | pdftotext, tesseract OCR, csv-parse, ExcelJS; field confidence/snippet/provenance |
| Invoice verification | Operational | 12 rules, statuses, score/coverage/confidence, verification events |
| Reconciliation | Operational | CSV/TSV import, exact/probable/partial matching, human accept/reject, payment creation |
| Trust Records | Operational | Six weighted categories, grades A–E, versioning, evidence items, SHA-256 chain |
| Counterparty confirmation | Operational (manual delivery) | Single-use token, public preview/confirm/decline, conflict state |
| Payment adapters | Partial | Catalogue, encrypted credentials, real connection test; **no data sync or payment initiation** |
| Audit trail | Operational | Per-organisation hash chain, verification endpoint, tamper detection test |
| Reports | Operational | PDF and CSV, generation date, sources, methodology, limitations |
| Dashboard | Operational | Login, overview, businesses, documents, invoices, reconciliation, counterparties, integrations, audit, reports, system health, trust index |
| Public confirmation page | Operational | `/confirm/:token` in the SPA |
| Tests | Operational | 34 integration + 6 unit tests, all passing |
| Deployment | Operational | Public container at the live URL, managed database, `/health` 200 |
| GitHub delivery | Operational | Source pushed to `main` at commit `92314b2`; landing page preserved at root and engine delivered under `trust-engine/`. |
| Email/SMS delivery | Not implemented | No provider configured; links are returned for manual sending |
| AI extraction/scoring | Not implemented | No model is called; methodology is deterministic |
| Registry/tax API integration | Not implemented | Manual verification workflow only |
| Payment initiation | Not implemented | AFT is not a payment processor |

## 3. Live verification performed

The final published checkpoint is **`15b3f6fc1916537129ec5a05c4f1c697fe4e8221`** (`15b3f6f`), published on 24 November 2026 to the live URL above. On that origin:

- `GET /health` returned HTTP 200 with `{ "status": "ok", "database": true }`.
- `GET /` returned the SPA shell (HTTP 200, `text/html`).
- `GET /manus-routes.json` returned the declared route manifest.
- The nine synthetic demo accounts were disabled and their active sessions revoked after the earlier live checks; they must no longer be used.
- `GET /api/v1/businesses` returned the seeded Kigali Fresh business.
- `GET /api/v1/businesses/{id}/trust-record` returned grade **A**, score **82.94**, version 1.
- `GET /api/v1/trust-records/{id}/verify-hash` returned `valid: true` with identical stored and recomputed hashes.
- A business user received HTTP 404 when requesting another tenant's business by ID.
- An institution user saw only the two businesses covered by its grants; document access outside the grant scope returned HTTP 404.
- A PDF Trust Record report generated successfully and downloaded as a valid `%PDF-` file (4,474 bytes).
- `GET /api/v1/audit/verify` returned `valid: true` over 15 chained audit entries.
- The site became publicly accessible after an explicit visibility confirmation.

The seeded businesses and their Trust grades after the final regeneration are:

| Business | Grade | Score |
| --- | --- | ---: |
| Kigali Fresh Foods Ltd | A | 82.94 |
| Nyamirambo Textiles SARL | B | 71.05 |
| Nairobi Agro Supplies Ltd | C | 63.78 |
| Gasabo Logistics Ltd | E | 11.44 |

These are synthetic demonstration records, not real companies.

## 4. Architecture summary

The application is a modular monolith: one Node 22 process serves the API and SPA, runs migrations and processes extraction jobs. MySQL/TiDB is the durable store. Uploaded bytes are content-addressed in `document_blobs` so a container restart does not lose evidence. Generated reports use the container storage directory and should be moved to object storage or a mounted volume for long-term durability.

Detailed documents:

- [Architecture](ARCHITECTURE.md)
- [API](API.md)
- [Methodology](METHODOLOGY.md)
- [Security](SECURITY.md)
- [Deployment](DEPLOYMENT.md)
- [Integrations](INTEGRATIONS.md)
- [Testing](TESTING.md)

### Database

40 tables across nine migrations:

`organisations`, `users`, `sessions`, `access_grants`, `api_keys`, `country_profiles`, `org_settings`, `businesses`, `business_identifiers`, `business_representatives`, `business_history`, `counterparties`, `documents`, `document_extractions`, `extracted_fields`, `invoices`, `invoice_lines`, `invoice_status_history`, `purchase_orders`, `contracts`, `delivery_evidence`, `payment_records`, `import_batches`, `transactions`, `reconciliations`, `reconciliation_matches`, `trust_records`, `evidence_items`, `verification_events`, `audit_chain_heads`, `audit_logs`, `integrations`, `integration_credentials`, `processing_jobs`, `idempotency_keys`, `reports`, `document_blobs`, `user_invitations`, `user_mfa`, `mfa_challenges`.

The schema is multi-country and multi-currency: `country_profiles` holds registration/tax labels and formats; monetary rows carry ISO currency codes. Rwanda is the seeded initial market, not a hardcoded constraint. There is no FX conversion engine; amounts are compared in their recorded currency.

### Backend

- Express 4, ESM, no ORM. Explicit SQL with parameter binding.
- `src/api.js` mounts modules; `src/server.js` bootstraps migrations, jobs, static hosting and health.
- `src/middleware/auth.js` handles sessions, API keys, CSRF, roles and scopes.
- `src/modules/*` contains auth, businesses, documents, extraction, invoices, transactions, trust, counterparties, integrations, reports, audit, admin and jobs.
- `src/lib/audit.js` writes and verifies the audit hash chain.
- `src/openapi.js` is the API contract.
- `db/migrations/*.sql` is the schema source of truth.

### Frontend

Vanilla ES modules in `public/`; no framework build step. The shell, router, API client, modals, formatters and views are separated (`core.js`, `views-core.js`, `views-ops.js`, `app.js`). It preserves the existing cream/navy/gold/teal brand and uses live API data for every statistic. There are no hardcoded dashboard counts.

## 5. API

The API is versioned at `/api/v1`. Authentication is a session cookie plus `x-aft-csrf`, or an API key bearer token. The OpenAPI document is the authoritative schema. Key endpoints cover auth, businesses, access grants, documents, invoices, commercial evidence, transactions, reconciliation, Trust Records, counterparties, confirmations, integrations, API keys, audit, reports and system health.

API keys are scope-limited; access grants are scope-limited; missing access returns 404 to avoid record enumeration. See [API.md](API.md) for the endpoint table, error envelope, pagination and examples.

## 6. Integration status

**No live provider connection exists.** The catalogue includes M-Pesa, MTN MoMo, Airtel Money, Flutterwave, Paystack, generic open banking, bank-statement import, accounting export, manual registry, manual tax and manual delivery. For the five API providers and open banking, `POST /integrations/{id}/check` performs a real outbound credential test against the provider's documented endpoint. It does not import transactions, poll balances, receive webhooks, refresh tokens or initiate payments.

Required external credentials are listed in [INTEGRATIONS.md](INTEGRATIONS.md). None are present in the repository or hosted environment.

## 7. Demo accounts

All seeded accounts were created with the password **`AftDemo!2026#Kigali`**. They are disabled in the live database, their active sessions were revoked, and `user.disabled` audit events were written. The password remains visible in source history for synthetic local/test fixtures and must never be used for real onboarding.

| Role | Email |
| --- | --- |
| System administrator | `admin@africanfinancialtrust.africa` |
| Read-only auditor | `auditor@africanfinancialtrust.africa` |
| Institution administrator | `analyst@kigalicommercial.rw` |
| Institution analyst | `credit@kigalicommercial.rw` |
| Unauthorised institution analyst | `analyst@nairobicapital.ke` |
| Kigali Fresh business admin | `finance@kigalifresh.rw` |
| Nyamirambo Textiles business admin | `accounts@nyamirambotextiles.rw` |
| Gasabo Logistics business admin | `finance@gasabologistics.rw` |
| Nairobi Agro business admin | `finance@nairobiagro.co.ke` |

**Do not re-enable these accounts or load real data into the synthetic organisations.** The seed is guarded by an existing-data check; `SEED_FORCE=true` appends another synthetic dataset and is not recommended on a shared database.

## 8. Testing and evidence

```bash
npm test          # 34 integration tests, real MySQL/MariaDB
npm run test:unit # 6 unit tests
```

Both suites passed on 24 November 2026. The integration suite also covers invitation creation, pre-activation login refusal, token expiry, minimum password and mismatch validation, activation audit logging and token reuse refusal.

Not covered: browser E2E automation, load/concurrency testing, OCR accuracy benchmarks, malware fuzzing, dependency CVE scanning, penetration testing, backup restore drills, email/SMS delivery and live provider data flows. See [TESTING.md](TESTING.md).

## 9. Deployment and operations

The live container is built from the repository `Dockerfile` (Node 22, poppler, tesseract, non-root). The platform supplies `DATABASE_URL` and key material. Migrations run at startup unless `AUTO_MIGRATE=false`. `/health` and `/ready` are unauthenticated.

To run locally or in another container, see [DEPLOYMENT.md](DEPLOYMENT.md). To publish a new version in the Manus project, push the intended commit to canonical `main` and publish the resulting checkpoint; a Git push alone is not a publication.

### Operating costs

No paid external service is currently connected, so the only current cost is the Manus plan that hosts the container and managed TiDB database. The exact Manus charge depends on the plan and usage; no separate invoice was generated for this build. The following are planning estimates, not quotes:

| Cost driver | Current | Indicative production cost |
| --- | --- | --- |
| Container + managed TiDB | Included in the Manus plan | Plan-dependent; monitor CPU, memory and database size |
| Domain / TLS | Existing landing domain; platform TLS | Domain renewal; TLS usually included |
| Transactional email | $0 (not configured) | ~$15–30/month at low volume (provider-dependent) |
| SMS for confirmations | $0 (not configured) | ~$0.01–0.05 per message in African markets; varies by country/provider |
| OCR compute | Included; open-source tesseract | Container CPU; scale with document volume |
| Object storage for reports | Not used; local volume | A few dollars per 100 GB/month, provider-dependent |
| Monitoring/logging | None beyond platform logs | $0–50/month for a small stack |
| Registry/tax API contracts | None | Commercially negotiated; unknown |
| Payment provider | None | Setup and per-transaction fees; contract-dependent |
| Independent penetration test | Not performed | Roughly $5,000–25,000 one-off, scope-dependent |
| Legal/privacy/compliance | Not performed | Jurisdiction-dependent |

Do not treat these ranges as commitments. Obtain quotes for the chosen providers and jurisdictions.

## 10. Security limitations

Implemented: scrypt password hashing, hashed session tokens, CSRF, secure cookies, API-key hashing and scopes, role and grant checks, tenant isolation, upload signature checks, private downloads, AES-256-GCM credential encryption, audit hash chain, Trust Record hash chain, Helmet CSP, parameterised SQL, structured errors and request IDs.

Not implemented or not proven: MFA enforcement/production enrollment, SSO, email verification, password reset, malware scanning, application-layer encryption of business records, shared rate limiting, field-level read auditing, automated retention/erasure, legal hold, backup restore drill, external anchoring of hashes, SSRF allowlisting for custom provider URLs, dependency CVE scanning, penetration testing and certifications. The audit chain detects casual row tampering, not a privileged database operator rewriting the whole chain. See [SECURITY.md](SECURITY.md).

The highest-priority immediate action is to activate the first production administrator and enforce MFA before customer onboarding. The second is to set a unique `APP_ENCRYPTION_KEY` and confirm database backups.

## 11. Known blockers and incomplete work

1. **No live registry/tax/bank/payment/email provider.** Requires commercial accounts and credentials from the owner. The platform deliberately does not fake these.
2. **No email delivery.** Confirmation links are returned by the API/UI; someone must send them manually. A transactional email provider is needed for automation.
3. **Payment adapters are connection tests, not integrations.** Data sync, webhooks, token refresh, payment initiation and settlement reconciliation are not built.
4. **Demo credentials remain public in source history but are disabled in production.** They must never be re-enabled or used for real data.
5. **MFA is not yet deployed/enforced for the production administrator; password reset/email verification are absent.** Required before onboarding external users.
6. **No backup/restore drill or retention automation.** The managed database is durable, but operational procedures are not proven.
7. **No malware scanning or SSRF allowlist.** Required before untrusted uploads/custom provider URLs at scale.
8. **No load, soak, penetration or browser E2E testing.** The job claim is safe for a single container; stale `running` jobs after a crash are not automatically recovered.
9. **Cloudflare landing rebuild not verified.** The GitHub landing source now points “Access Trust Engine” at the new app, but the public `africanfinancialtrust.pages.dev` page will only change when Cloudflare Pages rebuilds from the repository. The repository push alone does not prove that happened.
10. **No custom domain.** The live URL is a Manus subdomain. Pointing a branded domain requires DNS/domain control.
11. **No FX conversion.** Multi-currency records are stored and compared in their own currency; cross-currency netting is not implemented.
12. **No AI.** This is deliberate, not a missing feature: deterministic rules are used for financial validation. AI extraction is not wired and is not claimed.
13. **GitHub delivery completed.** The complete source is pushed to `planetpurestore-ai/African-financial-trust` at commit `2b91f34`, with the original landing page preserved at the repository root and the Trust Engine under `trust-engine/`.

## 12. Deployment instructions

Short version:

```bash
# After the owner pushes the prepared delivery tree, or from the supplied archive:
cd African-financial-trust/trust-engine
npm ci
cp .env.example .env
# set DATABASE_URL, APP_ENCRYPTION_KEY, NODE_ENV, PUBLIC_ORIGIN
npm run migrate
npm start
```

Container:

```bash
docker build -t aft-trust-engine .
docker run -p 3000:3000 --env-file .env aft-trust-engine
```

The detailed environment table, migration notes, health checks, backup checklist and production checklist are in [DEPLOYMENT.md](DEPLOYMENT.md).

## 13. Recommended next steps

1. Activate `africanfinancialtrust@gmail.com` through the one-time invitation, then enforce MFA before customer onboarding.
2. Add email delivery, email verification and password reset.
3. Contract a transactional email provider and wire confirmation-link delivery.
4. Decide the first real integration (likely bank-statement import and one mobile-money provider) and build data sync with webhooks, idempotency and reconciliation.
5. Add malware scanning and provider-host allowlisting.
6. Commission a penetration test and a backup restore drill.
7. Connect a branded domain and confirm Cloudflare Pages rebuilds the landing page.
8. Define data residency, retention, privacy policy, terms and a data-processing agreement.
9. Add monitoring/alerting and a shared rate limiter before scaling beyond one container.

## 14. Repository layout

```
.
├── index.html, robots.txt, sitemap.xml   # existing landing page (preserved)
├── README.md                             # this delivery
└── trust-engine/
    ├── src/                              # Express API and modules
    ├── public/                           # dashboard SPA and brand assets
    ├── db/migrations/                    # 001–009 schema
    ├── scripts/seed.js                   # synthetic demonstration dataset
    ├── tests/                            # integration and unit tests
    ├── docs/                             # architecture, API, methodology, security, deployment, integrations, testing, handover
    ├── Dockerfile
    ├── app.config.ts
    └── package.json
```

## 15. Ownership and contacts

The repository owner is `planetpurestore-ai`. No security contact, support SLA or on-call rotation is configured. Add a monitored security email and an operational contact before launch. The existing landing page lists `hello@africanfinancialtrust.com` as a contact; that mailbox’s monitoring status was not verified.
