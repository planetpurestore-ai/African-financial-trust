# Working notes (internal)

This file is for maintainers. The authoritative delivery status is in [docs/HANDOVER.md](docs/HANDOVER.md); architecture and operating details are in [docs/](docs/).

## Environment

- Project directory: `/home/ubuntu/aftengine` (Manus Webdev project `wdp_d05f9cca2ce04f6e3b1f5333`).
- Hosted database: managed TiDB, `DATABASE_URL` injected by the platform; 37 tables, migrations 001–007 applied.
- Local development database: `mysql://aft:aft_dev_password@127.0.0.1:3306/aft_dev` (MariaDB 10.11). Tests use `aft_test` via `TEST_DATABASE_URL`.
- `dotenv` does not override an existing environment variable, so pass `DATABASE_URL=` explicitly for local commands.
- Local start: `DATABASE_URL='mysql://aft:aft_dev_password@127.0.0.1:3306/aft_dev' PORT=3000 node src/server.js`.
- TiDB ignores CHECK constraints; zod enforces enums at the application boundary.
- Native extraction tools: `pdftotext`, `pdftoppm` (poppler-utils) and `tesseract`. The Dockerfile installs them.

## Current state (24 November 2026)

- Live: https://aftengine-dgfbrcn2.manus.space (published checkpoint `79ab2e1`).
- Delivery tree: `/home/ubuntu/aft-github` — landing page at repository root, engine under `trust-engine/`. **Not pushed:** the GitHub connector token is read-only and returns 403 on push. See HANDOVER §11 item 13.
- Tests: 30 integration + 6 unit, all passing.
- Managed demo Trust Records were regenerated after the canonical-JSON hashing fix; all four verify.
- Document bytes are stored in `document_blobs`; local filesystem keys are legacy fallback only.
- No provider is connected; integration checks are credential tests only.
- Demo password remains `AftDemo!2026#Kigali` and must be rotated before real use.

## Deployment reminders

- Push to canonical `main` creates a checkpoint; publishing is a separate action.
- `webdev.config` deploy declaration: `Dockerfile`, health path `/health`.
- Startup applies migrations unless `AUTO_MIGRATE=false`.
- The hosted container and managed TiDB are shared by development and production; do not run destructive tests against the managed database.
- The landing page at `africanfinancialtrust.pages.dev` is a separate Cloudflare Pages deployment. A GitHub push does not prove Cloudflare rebuilt it.

## Useful commands

```bash
npm test
npm run test:unit
npm run migrate
npm run seed
npm start
```

Seed accounts are listed in [README.md](README.md) and [docs/HANDOVER.md](docs/HANDOVER.md).
