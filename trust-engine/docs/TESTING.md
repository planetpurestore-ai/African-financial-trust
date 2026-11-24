# Testing

## Results (24 November 2026)

| Suite | Command | Result |
| --- | --- | --- |
| Integration/API | `npm test` | **33 passed, 0 failed** |
| Unit | `npm run test:unit` | **6 passed, 0 failed** |

The integration suite runs against a real MySQL/MariaDB database (`aft_test`), applies all migrations, creates isolated tenants and users, uploads real generated PDFs, processes extraction, verifies invoices, imports a bank statement, reconciles it, generates and verifies Trust Records, tampers with an audit entry, and exercises API-key and grant scope boundaries.

## How to run

```bash
mysql -uroot -e "CREATE DATABASE IF NOT EXISTS aft_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
TEST_DATABASE_URL='mysql://user:password@127.0.0.1:3306/aft_test' npm test
npm run test:unit
```

If `TEST_DATABASE_URL` is omitted, the suite uses `DATABASE_URL`. Never point it at a database containing real or demonstration data: the suite creates and removes its own records, but it also runs migrations and audit-tampering checks. The default test environment sets `JOB_WORKER_ENABLED=false` and a temporary `STORAGE_DIR`.

The test database must exist and the user must have DDL rights. `pdftotext`, `pdftoppm` and `tesseract` are required for the PDF extraction test.

## What the integration suite covers

### Authentication and tenancy

- Health endpoint reports a live database connection.
- Invalid login is rejected without disclosing which factor failed.
- Session authentication returns the current user, organisation and role.
- State-changing session requests require a matching CSRF token.
- Unauthenticated API calls are rejected.
- An authorised administrator can create a single-use invitation; the invited account cannot sign in before activation.
- Activation rejects invalid and expired tokens, passwords shorter than 14 characters and mismatched confirmation values.
- Successful activation writes an audit event, permits sign-in and rejects token reuse.
- Auditor accounts are read-only.
- Business registration sets `self_declared` status and the correct owner organisation.
- A second tenant cannot read the first tenant’s business; its list contains only its own record.
- An institution without a grant sees no business records.
- Invalid business input returns field-level validation detail.
- API keys authenticate without CSRF, can be revoked, and are scope-limited.
- An access grant limited to `invoices.read` can read invoices but not documents or Trust Records.

### Documents and extraction

- A generated PDF invoice is uploaded, stored, SHA-256 hashed, and returns `content_hash`.
- Re-uploading identical bytes is detected as a duplicate.
- Extraction is deterministic, produces at least three fields, and every field carries `document_extracted` provenance and confidence.
- A cross-tenant document read is refused with 404.
- The original PDF is downloadable by the owning tenant and refused to another tenant.
- Unsupported upload types are rejected.
- The durable blob path is exercised by download and extraction.

### Invoice verification

- An invoice with no corroborating evidence is not marked verified and returns `evidence_insufficient`.
- Arithmetic contradictions return `inconsistent` and the arithmetic rule fails.
- A corroborated invoice becomes `verified` after a purchase order, delivery note, payment and counterparty confirmation, with a score ≥ 80.
- Duplicate invoice numbers are flagged as `duplicate_suspected`.
- A document alone cannot verify an invoice (unit test).

### Reconciliation

- A bank statement CSV is imported, reconciled, and an accepted match creates a payment record.

### Trust Records and audit

- A Trust Record is versioned, hashed and chained to its predecessor.
- The hash verification endpoint returns `valid: true`.
- An institution can read a Trust Record only after an explicit grant.
- A grant’s scopes are enforced (invoices-only grant cannot read documents or Trust Records).
- The audit chain verifies; a deliberate tamper is detected; restoring the row restores validity.

### Contract and error handling

- The OpenAPI contract is served and describes the v1 API.
- Unknown API routes return a structured 404 JSON error, not HTML.
- Content hashing is stable and case-sensitive.

## What the unit suite covers

- Canonical JSON sorts keys and mirrors JSON round-trip semantics (undefined omission, array nulls).
- Hashes are stable across database JSON normalisation.
- ISO timestamps are normalised for MySQL DATETIME columns.
- Missing corroboration yields `evidence_insufficient`.
- Arithmetic contradiction yields `inconsistent`.
- A document alone cannot verify an invoice.

## Gaps

The following are **not** covered by automated tests:

- Browser end-to-end journeys (login, navigation, modal interactions, mobile layout). Visual checks were performed manually during development, not codified.
- Load, stress and concurrency testing. The job claim is conditionally safe, but no multi-replica soak test exists.
- OCR accuracy benchmarks on real scanned documents.
- Malicious file fuzzing beyond type/signature checks.
- Penetration testing, dependency CVE scanning and secret scanning in CI.
- Backup/restore drills.
- Email/SMS delivery (no provider configured).
- Live provider integrations (none connected).
- Cross-browser cookie behaviour for `SameSite=None` in third-party embeds.

Add these before claiming production readiness. The test suite is evidence of implemented behaviour, not proof of security or regulatory compliance.
