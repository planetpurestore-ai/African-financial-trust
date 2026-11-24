# Deployment

## Current hosted deployment

| Item | Value |
| --- | --- |
| Trust Engine URL | https://aftengine-dgfbrcn2.manus.space |
| Platform | Manus Cloud container, managed TiDB database |
| Container image | `Dockerfile` at repository root |
| Health check | `GET /health` (unauthenticated, 200 when the database responds) |
| Database migrations | Applied automatically at container start unless `AUTO_MIGRATE=false` |
| Published checkpoint | `15b3f6fc1916537129ec5a05c4f1c697fe4e8221` (`15b3f6f`), published 24 November 2026 |
| Existing landing page | https://africanfinancialtrust.pages.dev/ (separate static site) |

The published container is public. The first publication was private; public visibility was explicitly confirmed by the owner. The app has its own login screen; platform OAuth is not used for application accounts.

## Local development

Prerequisites: Node.js 22+, MySQL 8+/MariaDB 10.6+, `pdftotext`, `pdftoppm`, `tesseract`.

```bash
npm ci
cp .env.example .env
```

Set at least:

```dotenv
NODE_ENV=development
PORT=3000
DATABASE_URL=mysql://aft:password@127.0.0.1:3306/aft_dev
APP_ENCRYPTION_KEY=<32-byte base64 or 64-hex>
COOKIE_SECURE=false
STORAGE_DIR=./storage
```

Then:

```bash
npm run migrate
npm run seed       # optional; synthetic data
npm start
```

The dashboard is at `http://localhost:3000`. The seed creates synthetic organisations, businesses, documents, invoices, reconciliations, counterparties and Trust Records. It does not create live integrations.

## Docker

```bash
docker build -t aft-trust-engine .
docker run --rm -p 3000:3000 \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e DATABASE_URL='mysql://user:password@host:3306/aft' \
  -e APP_ENCRYPTION_KEY='<32-byte key>' \
  -e COOKIE_SECURE=true \
  aft-trust-engine
```

The image installs `poppler-utils`, `tesseract-ocr` and `tesseract-ocr-eng`, runs as the non-root `node` user, and stores source evidence in the database rather than the container filesystem. `STORAGE_DIR` is used only for temporary extraction and generated report files.

For durable reports across container restarts, mount a volume at `/app/storage` or move report bodies to object storage. Document blobs and all financial records already live in the database.

## Manus deployment configuration

The project is configured with:

- `features.server: true` (container hosting)
- `deploy.dockerfilePath: "Dockerfile"`
- `deploy.healthPath: "/health"`
- `runtime.dev-commands`: `aft-engine` → `npm start`, port 3000

Publication is a separate step from a Git checkpoint. The live version corresponds to the published checkpoint recorded in the project’s Version history. To publish a new checkpoint, use the Dashboard Publish control or the Webdev publish operation after pushing to canonical `main`.

The live deployment is published from checkpoint `15b3f6f`, which includes the invitation flow. Migration 008 adds the `user_invitations` table; container startup applies it automatically unless `AUTO_MIGRATE=false`. Verify the live activation route before creating the first production invitation.

## Database

The managed TiDB database is shared by development, testing and production in the Manus project. Do not run destructive tests or the seed script against it without an explicit decision; the seed is guarded by an existing-data check and `SEED_FORCE`.

Migrations are numbered SQL files in `db/migrations/`. The runner records filename and checksum in `schema_migrations`; a changed checksum for an applied migration is refused. Apply manually with:

```bash
DATABASE_URL='mysql://...' npm run migrate
```

`007_document_blobs.sql` adds durable content-addressed storage. Existing documents stored under legacy filesystem keys remain readable through the fallback in `readDocumentBuffer`, but new uploads use `blob:<sha256>` keys.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | MySQL/TiDB DSN |
| `APP_ENCRYPTION_KEY` | Production | 32-byte key for integration-credential AES-256-GCM; falls back to `MANUS_JWT_SECRET` in the hosted environment |
| `PUBLIC_ORIGIN` | Recommended | Exact public origin for origin checks and absolute links |
| `NODE_ENV` | Yes | `production` enables secure cookies and config assertions |
| `PORT` | No | Default 3000 |
| `COOKIE_SECURE` | Production | Must be true in production; defaults to true when `NODE_ENV=production` |
| `SESSION_HOURS` | No | Session lifetime, default 12 |
| `STORAGE_DIR` | No | Temporary/report directory, default `./storage` |
| `MAX_UPLOAD_MB` | No | Default 25 |
| `AUTO_MIGRATE` | No | Set `false` to disable startup migrations |
| `JOB_WORKER_ENABLED` | No | Set `false` for API-only replicas |
| `RATE_LIMIT_*` | No | In-memory rate limits |

## Health and verification

```bash
curl -i https://aftengine-dgfbrcn2.manus.space/health
curl -s https://aftengine-dgfbrcn2.manus.space/api/v1/openapi.json | head
```

`/health` returns `{ "status": "ok", "database": true }` when the database responds. `/ready` is an alias with a minimal `{ "ready": true }` body.

## Landing page

The existing `africanfinancialtrust.pages.dev` site is a static Cloudflare Pages deployment. Its source in the GitHub repository remains at the root (`index.html`, `robots.txt`, `sitemap.xml`); the Trust Engine source is under `trust-engine/`. The landing page’s “Access Trust Engine” link was updated to the new hosted app. Cloudflare Pages must rebuild from the repository for that link change to appear on the public landing page; this repository push alone does not prove the Cloudflare deployment rebuilt.

## Backup and restore

The application does not implement its own database backup scheduler. The managed TiDB service provides the durability layer; the operator must confirm its backup retention and point-in-time recovery settings. A restore drill has not been performed. Before production, document:

1. Backup frequency and retention.
2. Restore procedure and target recovery time.
3. Verification that `document_blobs`, `trust_records`, `audit_logs` and `audit_chain_heads` restore consistently.
4. A post-restore audit-chain and Trust Record hash verification.

## Production checklist

- Keep all synthetic demo accounts disabled; the demo password remains in source history and must never be used for real onboarding.
- Complete secure activation of the first production administrator, then require MFA before customer onboarding.
- Set a unique `APP_ENCRYPTION_KEY` in the platform secret store.
- Set `PUBLIC_ORIGIN` to the final domain.
- Confirm database backups and perform a restore drill.
- Configure a transactional email provider for confirmation links and alerts.
- Add malware scanning and SSRF allowlisting before untrusted uploads/integration URLs.
- Put an edge WAF/rate limiter in front of the container.
- Add monitoring/alerting for 5xx rates, failed jobs, failed logins and audit-chain verification.
- Decide data residency and retention, and publish privacy/terms documents.
