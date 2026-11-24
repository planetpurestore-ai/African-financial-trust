# Integrations

## Status

**No provider is connected in the hosted deployment.** The integration catalogue is real code, credentials are encrypted, and a connection test performs an actual outbound request to the provider's documented endpoint. A successful test proves only that the supplied credentials reached that endpoint; it does not import transactions, synchronise balances, initiate payments or create a standing connection.

The seeded dataset contains no integration rows. The dashboard’s “Integrations connected” metric counts rows with `status = 'connected'` and is therefore zero until a provider is configured and tested successfully.

## Provider catalogue

| Provider | Category | Countries | Declared capabilities | Implemented here |
| --- | --- | --- | --- | --- |
| M-Pesa (Safaricom Daraja) | Mobile money | KE, TZ, GH, MZ, LS, CD, EG | Transaction read, payment status, balance read | OAuth credential test only |
| MTN Mobile Money | Mobile money | RW, UG, GH, CM, CI, ZM, NG, ZA | Transaction read, payment status | Collection token credential test only |
| Airtel Money | Mobile money | RW, UG, KE, TZ, ZM, MW, NG, CI, SN | Transaction read, payment status | OAuth credential test only |
| Flutterwave | Payment provider | NG, GH, KE, RW, ZA, UG, TZ, CM, CI | Transaction read, payment status, settlement read | Balance endpoint credential test only |
| Paystack | Payment provider | NG, GH, ZA, KE, CI, EG | Transaction read, payment status, settlement read | Bank-list credential test only |
| Generic open banking (OAuth2 client credentials) | Open banking | ZA, NG, KE, GH, EG | Transaction read, balance read | Token endpoint credential test only; operator supplies token/base URLs |
| Bank statement import | Bank | All | Statement import | CSV/TSV file import; no remote connection claimed |
| Accounting/ERP export | Accounting | All | Ledger/invoice import | CSV/XLSX file import; no vendor API claimed |
| Business registry (manual) | Registry | RW, KE, NG, GH, TZ, UG, ZA, ZM, CI, SN | Manual verification | Human decision with reference; no registry API claimed |
| Tax authority check (manual) | Tax | RW, KE, NG, GH, TZ, UG, ZA | Manual verification | Human decision; no tax API claimed |
| Delivery evidence (manual) | Logistics | All | Delivery evidence | Document upload; no logistics API claimed |

The country lists describe the provider's advertised coverage, not a regulatory approval or an AFT integration. Country profiles in `country_profiles` carry registration/tax labels and formats for the initial markets; Rwanda is the seeded initial market.

## Credentials required for a real connection

| Provider | Credentials |
| --- | --- |
| M-Pesa | Consumer key, consumer secret, business shortcode, optional Lipa na M-Pesa passkey |
| MTN MoMo | Ocp-Apim-Subscription-Key, API user, API key, target environment |
| Airtel Money | Client ID, client secret |
| Flutterwave | Secret key |
| Paystack | Secret key |
| Open banking | Client ID, client secret, token URL, base URL |
| Bank statement | None (file import) |
| Registry/tax | None for the manual workflow; a registry/tax API contract would be required for automation |

Credentials are submitted to `PUT /api/v1/integrations/{id}/credentials`, encrypted with AES-256-GCM, and never returned in plaintext. The API returns a masked value and the last test result.

## Connection-test behaviour

`POST /api/v1/integrations/{id}/check`:

1. Decrypts the stored credentials.
2. Sends the provider-specific authentication request to the configured base URL (defaults are the provider's documented sandbox/production endpoints).
3. Records HTTP status, success/failure, timestamp and a short detail.
4. Sets `status` to `connected` only when the test returns the expected success response; otherwise `error`.
5. Writes an audit entry.

It does not fetch transactions, balances or settlement files. There is no webhook receiver, OAuth redirect flow, token refresh scheduler or data-mapping pipeline. Those are required before calling any provider "integrated".

## Payment adapter architecture

The schema separates:

- `integrations` — organisation, provider, category, status, configuration (non-secret), last check.
- `integration_credentials` — AES-256-GCM ciphertext, IV, auth tag, key version placeholder.
- `payment_records` — evidence of a payment, with `source` (`manual`, `reconciliation`, etc.) and optional transaction/document links.

There is intentionally **no payment-initiation endpoint**. AFT is not a payment processor and does not custody funds. A future payment adapter would need, at minimum:

1. Provider onboarding and contractual authorisation.
2. OAuth/webhook handling with replay protection.
3. Idempotency keys and exactly-once reconciliation.
4. Strong customer authentication and transaction signing.
5. Sanctions/AML screening and licensing review.
6. Reconciliation of provider settlement reports against internal payment records.
7. A separate security review and likely PCI-DSS scope assessment if card data is involved.

None of the above is implemented. Do not represent the current connection test as a live payment integration.

## Adding a provider safely

1. Add a catalogue entry with explicit `manual: true` or a real `check` implementation.
2. Keep credentials in the encrypted vault; never log them.
3. Allowlist the provider host and block private/link-local addresses to reduce SSRF risk.
4. Record the test result and audit it.
5. Add contract tests against a sandbox before enabling a data-sync job.
6. Update this document and the dashboard copy so the status remains honest.

## External accounts the owner must supply

- Safaricom Daraja developer account and app (M-Pesa).
- MTN MoMo developer account and subscription.
- Airtel Africa developer account.
- Flutterwave and/or Paystack business account.
- A bank/open-banking provider contract and OAuth application.
- A transactional email provider (e.g. Postmark, SendGrid, SES) for confirmation links and notifications.
- Optionally an SMS provider for mobile-money markets.
- Registry/tax API contracts if automated checks are desired; otherwise the manual workflow remains the honest option.

No credentials for these services are present in the repository or the hosted environment.
