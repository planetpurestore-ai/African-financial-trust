# Security

This document describes what is implemented, what is assumed and what is not yet production-grade. It is intentionally blunt; the platform handles financial evidence and must not be represented as certified or penetration-tested.

## Implemented controls

### Authentication and sessions

- Passwords are hashed with `scrypt` (N=16384, r=8, p=1, 64-byte key, 16-byte random salt) and compared in constant time.
- Session tokens are 32 random bytes, stored only as SHA-256 hashes in `sessions`; the raw token is in an HttpOnly cookie.
- In production the session cookie is `Secure`, `SameSite=None`, `Path=/` so it works in the hosted HTTPS app. CSRF uses a separate non-HttpOnly cookie and `x-aft-csrf` double-submit check on state-changing session requests.
- API keys are `aft_<prefix>_<secret>`, stored as SHA-256 hashes with a lookup prefix, expiring optionally, revocable, and scope-limited.
- Login is rate-limited (default 12 attempts/minute/process). Generic “Invalid email or password” responses avoid account enumeration.
- Logout revokes the session row.
- Administrator invitations use 32-byte random tokens stored only as SHA-256 hashes, expire after 48 hours, are single-use, and create an `invited` account that cannot sign in until activation. Activation requires a 14-character password and matching confirmation, hashes the password with scrypt, revokes no unrelated sessions, and writes an audit event.
- Optional TOTP MFA can be enrolled from the system dashboard. TOTP secrets are encrypted at rest; login challenges expire after five minutes, allow at most five attempts, do not issue a session before verification, and support single-use hashed recovery codes.

### Authorisation and tenancy

- Role-based access control: `system_admin`, `institution_admin`, `institution_analyst`, `business_admin`, `business_user`, `auditor`.
- Business ownership is enforced by `owner_org_id`. Institution access requires an active, non-expired `access_grants` row.
- Grant scopes (`trust_record.read`, `documents.read`, `invoices.read`, `reconciliation.read`) are enforced by the business-access helper. A missing scope returns 404.
- API-key scopes are enforced in addition to roles and grants. A key issued for invoices cannot read documents, audit logs or system health.
- Cross-tenant reads and writes are tested (business detail, documents, document bytes, invoices, trust records).

### Input and file handling

- Zod schemas validate request bodies and query parameters. SQL is parameterised through `mysql2`; no string interpolation of user values.
- Uploads are limited to 25 MB and an allowlist of MIME types. Magic-byte checks reject PDF/PNG/JPEG/TIFF/XLSX mismatches and binary data in text files.
- Original filenames are sanitised for the `Content-Disposition` header. Downloads require business access and set `x-content-type-options: nosniff`.
- Uploaded bytes are content-addressed in `document_blobs`; duplicate uploads share bytes and point to the original. The container filesystem is not the durable store.
- Temporary extraction files are removed after processing.

### Secrets and credentials

- Integration credentials are encrypted with AES-256-GCM using a 32-byte key derived from `APP_ENCRYPTION_KEY` (or `MANUS_JWT_SECRET` as key material in the hosted environment). The API never returns plaintext credentials; it returns a masked value.
- The encryption key is supplied by the platform secret store/environment, not committed to the repository. `.env` and storage are git-ignored.
- If `APP_ENCRYPTION_KEY` is rotated, previously stored integration credentials cannot be decrypted and must be re-entered. Plan rotation accordingly.

### Audit and integrity

- Each organisation has an append-only audit log with a monotonically increasing `seq`, previous hash and SHA-256 hash. The chain head is locked in a transaction to prevent forks.
- `GET /audit/verify` recomputes the chain and detects modified rows. The test suite deliberately tampers with an entry and verifies detection.
- Trust Records are canonicalised and hash-chained. Verification recomputes from stored JSON.
- Identity changes, access grants, document review, invoice verification, payment recording, reconciliation acceptance, report generation and integration changes are audited.

### Transport and headers

- Helmet sets a restrictive CSP (`default-src 'self'`, no inline scripts, no object embedding), HSTS via the hosting proxy, `nosniff`, referrer policy and related headers.
- The app is served over HTTPS by the hosting platform. The container itself listens on HTTP behind the proxy.
- The app does not set `X-Frame-Options: DENY`; it can be embedded in the Manus Preview. Production embedding policy should be reviewed before third-party embedding.

### Error handling

- Errors are normalised to a code/message/request ID envelope. Stack traces and SQL errors are not returned to clients.
- Request IDs are generated per request and included in error responses and logs.

## Known limitations and risks

1. **Demo credentials remain published in source but are disabled in the live database.** The seeded accounts all use `AftDemo!2026#Kigali`; their sessions were revoked and login attempts return 403. The seed/demo records remain synthetic and must not be re-enabled or mixed with real data.
2. **MFA is implemented but not yet enforced.** The administrator must enroll and verify an authenticator before customer onboarding; SSO, email verification and password reset are still absent.
3. **No external penetration test or certification.** The code has automated tests, not a security audit. Do not claim ISO 27001, SOC 2 or PCI compliance.
4. **Application-layer encryption of business records is not implemented.** Business names, invoice amounts and documents are stored as ordinary database rows. The managed database provider's at-rest encryption is assumed but not independently verified. Integration credentials are the only application-encrypted secret.
5. **Document blobs are not virus-scanned.** Signature checks validate file type, not safety. Add malware scanning (e.g. ClamAV) before accepting files from untrusted parties at scale.
6. **Rate limiting is in-memory.** Limits reset on restart and are not shared across replicas. Use Redis or an edge rate limiter for multi-instance production.
7. **No CSRF protection for API keys.** This is intentional (bearer tokens are not ambient), but keys must be treated as secrets and never placed in browser JavaScript.
8. **No field-level audit of reads.** Audit records cover mutations and key verification events, not every read. Access logging is at the proxy/platform layer.
9. **No database backup/restore runbook tested end-to-end.** The managed TiDB service provides durability, but AFT has not performed a restore drill. A production operator must define retention, PITR and restore tests.
10. **No data-residency controls in the application.** Country profiles exist for business metadata, but where data is stored depends on the hosting/database region. This matters for Rwanda and other jurisdictions.
11. **No retention job.** `DATA_RETENTION_DAYS` is configured but no scheduled deletion/anonymisation process is implemented.
12. **No legal-hold or subject-access workflow.** GDPR-style access/erasure requests require an operator procedure.
13. **Reports contain business data.** Report files are stored under the storage directory and downloaded through an access-checked route; they are not individually encrypted. Treat the storage volume/database as sensitive.
14. **Integration connection tests make outbound requests.** A malicious or misconfigured provider URL could be used for SSRF against internal addresses. The current catalogue uses fixed provider URLs/defaults, but custom `baseUrl`/`tokenUrl` values should be allowlisted before exposing integration configuration to untrusted tenants.
15. **The audit chain is only as trustworthy as the database operator.** It detects casual row tampering, not a privileged operator who rewrites the entire chain. External anchoring is not implemented.
16. **No secrets rotation automation.** Rotate the database password, session signing material and encryption key through the platform; rotating the encryption key requires re-entering integration credentials.

## Production hardening checklist

- [x] Disable all live demo accounts, revoke their sessions and record the action in the audit chain. The demo password remains in source history and must never be used for real onboarding.
- [ ] Set a unique `APP_ENCRYPTION_KEY` (32 bytes, base64/hex) and store it in the platform secret manager.
- [x] Implement administrator invitation and one-time password activation with expiry, hash-only tokens, minimum password length and audit events.
- [~] TOTP MFA enrollment, challenge verification, lockout threshold and recovery codes are implemented; enroll the production administrator and enforce MFA for regulated/admin roles after recovery is confirmed. Add email verification and password reset.
- [ ] Put the app behind a WAF/edge rate limiter and restrict admin endpoints by network if possible.
- [ ] Add malware scanning for uploads and a quarantine state.
- [ ] Allowlist integration provider hosts; block private/link-local addresses.
- [ ] Configure database backups, PITR and a tested restore procedure.
- [ ] Define retention, legal hold and data-subject request procedures.
- [ ] Add centralized logging/monitoring and alerting for failed logins, job failures and audit-chain failures.
- [ ] Commission an independent penetration test and remediate findings.
- [ ] Review data residency and contractual terms for the hosting and database providers.
- [ ] Add a privacy policy, terms and data-processing agreement before onboarding real businesses.

## Reporting a vulnerability

There is no public security contact configured in this repository. The owner should add a monitored security email before launch. Do not include secrets or personal data in a public issue.
