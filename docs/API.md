# API

Base path: `/api/v1`. The machine-readable contract is served at **`/api/v1/openapi.json`** (OpenAPI 3.1). The live deployment exposes it at https://aftengine-dgfbrcn2.manus.space/api/v1/openapi.json.

## Authentication

Two mechanisms are supported:

1. **Session cookie** — `POST /auth/login` with `{ "email", "password" }`. The response sets `aft_session` (HttpOnly, Secure, SameSite=None in production) and `aft_csrf` (readable by the SPA). State-changing requests must send the CSRF value in `x-aft-csrf`.
2. **API key** — `Authorization: Bearer aft_<prefix>_<secret>` or `x-api-key`. Keys are created at `POST /api-keys`; the secret is shown once and only its SHA-256 hash is stored. API keys do not need CSRF.

Sessions expire after `SESSION_HOURS` (default 12). Logout revokes the session row. API keys can be revoked with `DELETE /api-keys/{id}`.

### Login example

```bash
curl -sS -c cookies.txt \
  -H 'content-type: application/json' \
  -d '{"email":"finance@kigalifresh.rw","password":"AftDemo!2026#Kigali"}' \
  https://aftengine-dgfbrcn2.manus.space/api/v1/auth/login
```

The JSON response includes `data.csrfToken`. Send it on writes:

```bash
curl -sS -b cookies.txt -H 'x-aft-csrf: <token>' \
  -H 'content-type: application/json' \
  -d '{"businessId":"...","legalName":"..."}' \
  https://aftengine-dgfbrcn2.manus.space/api/v1/businesses
```

## Authorisation model

Roles: `system_admin`, `institution_admin`, `institution_analyst`, `business_admin`, `business_user`, `auditor`.

- `auditor` is read-only for state-changing business routes.
- Business owners can read/write their own business. Institutions need an explicit `access_grants` row; grants are limited to `trust_record.read`, `documents.read`, `invoices.read` and `reconciliation.read`, and can expire.
- A missing business or missing scope returns **404**, not 403, to avoid leaking record existence.
- API keys additionally carry scopes. Core scopes: `business.read`, `business.write`, `documents.read`, `documents.write`, `invoices.read`, `invoices.write`, `reconciliation.read`, `reconciliation.write`, `trust_record.read`, `trust_record.write`, `counterparties.read`, `counterparties.write`, `reports.read`, `reports.write`, `audit.read`, `system.read`, `integrations.read`, `integrations.write`. A key with `invoices.read` cannot read the audit trail or system health.
- Access-grant scopes are enforced in addition to API-key scopes. A grant for `invoices.read` does not authorise document download or Trust Record access.

## Response conventions

Success:

```json
{ "data": { }, "meta": { "total": 0, "limit": 25, "offset": 0, "returned": 0 } }
```

Errors:

```json
{ "error": { "code": "not_found", "message": "Business not found", "request_id": "01..." } }
```

Common status codes: `200` read/update, `201` created, `202` queued, `400` validation, `401` unauthenticated, `403` role/CSRF/scope denied, `404` not found or not visible, `409` conflict/idempotency, `413` upload too large, `429` rate limited, `500` unexpected, `503` dependency unavailable.

List endpoints accept `limit` (max 100) and `offset`; most business-scoped lists require `businessId`.

## Endpoint summary

### Authentication and keys

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/auth/login` | Sign in; sets session and CSRF cookies |
| POST | `/auth/logout` | Revoke current session |
| GET | `/auth/me` | Current user, organisation, role |
| GET | `/api-keys` | List key metadata (never the secret) |
| POST | `/api-keys` | Create a key; secret returned once |
| DELETE | `/api-keys/{id}` | Revoke a key |

### Businesses and access

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/businesses` | Businesses visible to the caller |
| POST | `/businesses` | Register a business |
| GET | `/businesses/{id}` | Detail, identifiers, statistics |
| PATCH | `/businesses/{id}` | Update; history entry is written |
| POST | `/businesses/{id}/verify` | Record a manual identity verification decision |
| GET | `/businesses/{id}/access-grants` | List institution grants |
| POST | `/businesses/{id}/access-grants` | Grant scoped, expiring access |
| DELETE | `/businesses/access-grants/{grantId}` | Revoke a grant |

### Documents and extraction

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/documents` | Multipart upload (`file`, `businessId`) |
| GET | `/documents?businessId=` | List document metadata |
| GET | `/documents/{id}` | Extraction runs and fields with confidence/provenance |
| GET | `/documents/{id}/file` | Access-checked original bytes |
| POST | `/documents/{id}/process-now` | Run extraction synchronously |
| POST | `/documents/{id}/reprocess` | Queue extraction again |
| PATCH | `/documents/{id}/fields/{fieldId}` | Human correction of an extracted field |

### Invoices and commercial evidence

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/invoices?businessId=` | List invoices |
| POST | `/invoices` | Create invoice with optional lines |
| GET | `/invoices/{id}` | Invoice, lines, payments, verification |
| POST | `/invoices/{id}/verify` | Run the 12-rule deterministic check |
| GET | `/invoices/{id}/verification` | Latest stored verification result |
| POST | `/invoices/{id}/payments` | Record a payment |
| GET/POST | `/commercial/purchase-orders` | List/create purchase orders |
| POST | `/commercial/contracts` | Create contract |
| POST | `/commercial/delivery-evidence` | Record delivery note |

### Transactions and reconciliation

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/transactions?businessId=` | List normalised transactions |
| POST | `/transactions` | Create one transaction |
| POST | `/transactions/import` | CSV/TSV multipart or JSON `rows` |
| GET | `/reconciliation?businessId=` | List reconciliation runs |
| POST | `/reconciliation/run` | Match open invoices against transactions |
| GET | `/reconciliation/{id}` | Matches with explanations |
| POST | `/reconciliation/matches/{id}/accept` | Accept a match and create a payment |
| POST | `/reconciliation/matches/{id}/reject` | Reject a suggested match |

### Trust Records and counterparties

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/businesses/{businessId}/trust-record` | Latest Trust Record |
| GET | `/businesses/{businessId}/trust-records` | Version history |
| POST | `/businesses/{businessId}/trust-record/generate` | Create a new immutable version |
| GET | `/trust-records/{id}` | Record with evidence and predecessor |
| GET | `/trust-records/{id}/verify-hash` | Recompute and compare the SHA-256 hash |
| GET | `/counterparties?businessId=` | List counterparties |
| POST | `/counterparties` | Create counterparty |
| GET | `/counterparties/{id}` | Counterparty detail |
| POST | `/counterparties/{id}/request-confirmation` | Create single-use link |
| GET | `/counterparty-confirmations/{token}` | Public preview (limited invoice fields) |
| POST | `/counterparty-confirmations/{token}` | Public confirm/decline |

### Integrations, audit, reports and system

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/integrations` | Provider catalogue plus organisation configuration |
| POST | `/integrations` | Configure a provider (no connection implied) |
| PUT | `/integrations/{id}/credentials` | Store encrypted credentials |
| POST | `/integrations/{id}/check` | Real outbound connection test; result recorded |
| GET | `/audit` | Query audit entries (org-scoped) |
| GET | `/audit/verify` | Recompute audit hash chain |
| GET | `/reports` | List generated reports |
| POST | `/reports` | Generate PDF/CSV (`type`, `format`, `businessId`) |
| GET | `/reports/{id}/download` | Download a generated report |
| GET | `/system/overview` | Live dashboard counts and breakdowns |
| GET | `/system/health` | Database, storage, jobs, integrations |
| GET | `/system/jobs` | Processing queue |

## Versioning

The URL prefix is the version (`/api/v1`). Breaking changes will use a new prefix; additive fields may appear within v1. The OpenAPI document is the authoritative schema. The database schema is versioned separately through numbered migrations and a checksum record.

## Rate limits

Default: 300 requests per minute per process for `/api/v1`, and 12 login attempts per minute. Limits are in-memory and therefore per container, not global. A multi-replica deployment needs a shared rate-limit store.

## Upload constraints

Default maximum 25 MB. Allowed MIME types: PDF, CSV, XLSX, JSON, JPEG, PNG, TIFF, plain text. Magic-byte/signature checks reject files whose content does not match the declared type. Uploaded bytes are content-addressed in `document_blobs`; downloads are access-checked and served with `nosniff`.

## Public endpoints

`GET /health`, `GET /ready`, `GET /api/v1/openapi.json`, `GET /api/v1` and the counterparty confirmation preview/submit routes are reachable without a session. The confirmation routes expose only the issuer name, invoice number/date/total/currency and the decision; they do not expose the full business record.
