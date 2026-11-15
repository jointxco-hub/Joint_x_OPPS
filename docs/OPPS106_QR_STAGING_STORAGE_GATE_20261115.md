# OPPS-106 — QR private storage and webhook security gate
Date: 2026-11-15 · staging: tijiamrfnxrbitafiflj · PR #108

## Applied on staging only

1. `20261115143000_opps106_qr_private_payment_requests.sql`
   - Private `qr_payments.payment_requests` table: tenant, target, amount in cents, currency, operation key, expiry, active/revoked/expired/settled state, gateway reference.
   - Partial unique index: **at most one active request** for the same tenant, type, target.
   - Unique operation key per target and unique gateway reference for settled requests.
   - Strict amount/status and checkout-URL constraints.
   - `qr_payments.payment_exceptions` for a verified additional capture or reconciliation discrepancy.
2. `20261115144500_opps106_qr_unmatched_capture_quarantine.sql`
   - Private `qr_payments.unmatched_captures` for genuine, verified gateway captures that cannot be safely linked to a known request.
   - Unique gateway payment ID prevents duplicate quarantine entries.

Both migrations compiled and passed rollback fixture checks before staged installation.
After installation, staging reports 3 tables, 0 payment requests and 0 unmatched captures.
Both QR tables are RLS enabled with NO browser role policies; `anon` and
`authenticated` have no direct table/schema access; `service_role` has limited
table grants. The Supabase security advisor flags RLS-without-policy as
informational for these deliberately private tables. Other advisor warnings
are pre-existing, separate release-review concerns.

**No QR links, payments, invoice receipts, OPPS orders or production objects
were created by this change.**

## Development-only QR webhook strengthening

Updated `src/server/cafeQr/qrPayfastCorrelation.js` to validate the
PayFast ITN local MD5 signature using the reviewed PHP-compatible encoding,
including blank fields and in-payload ordering; rejects appended fields after
`signature`. A trusted ingress source gate, passphrase and explicit
`sandbox` mode are now prerequisites. This check happens before remote
PayFast server validation. `qrWebhookCoordinator.js` forwards these
security prerequisites. Added tests for tampered amounts, absent trust and
missing passphrase.

**Important:** The existing proven `quick-solution-payfast-notify-opps106-test`
canary is a DIFFERENT, deployed checkout flow. The QR-specific coordinator
is **NOT** deployed. Source code changes do not imply validated live
gateway behavior; the full QR code test suite has not run yet.

## Explicit blockers before QR can be shown or scanned

- Build and review an authenticated staff-only server issuance/status API
  with durable transaction/target lock, tenant capabilities, idempotency,
  canonical outstanding-balance resolution and scheduled expiry.
- Use a controlled, short-lived **intermediate payment link**, so QR expiry
  is enforceable at initiation; an already-generated PayFast hosted checkout
  URL may still be usable after a local request record expires.
- Implement PayFast URL issuance for request-specific identity and callback
  correlation, using the same validated signing, source IP and merchant
  checks proven by the Café staging canary.
- Connect QR notification's verified settlement to the correct ledger
  (Café service-order or OPPS invoice), preserving any captured funds that
  require review and never duplicating existing EFT/Cash/PayFast receipts.
- Resolve manual invoice-only receipt/Finance mismatch documented in
  `OPPS106_INVOICE_ORIGIN_GATE_20261115.md` before invoice QR payments.
- Add unit/integration tests against a real local Postgres instance and
  authentic end-to-end sandbox scan; test two devices, expired/revoked
  QR, late capture, partial payments, wrong role/tenant and webhook replay.
- Only then connect the staff-facing QR display, test on phone/iMin D4
  and obtain release approval.

Until the above gates pass, keep all QR payment issuance endpoints disabled
and keep production unchanged.

## 15 November 2026 — authenticated Café counter QR preflight deployed

New staging migration `20261115150500_opps106_counter_qr_preflight.sql`
created `public.qs_opps106_counter_qr_preflight(uuid)`, a tightly
scoped read-only `SECURITY DEFINER` RPC. It:
- Derives user identity from `auth.uid()`, not caller-provided user ID.
- Checks active Quick Solution Café tenant membership and explicit
  `quick_solution` capability; anon has no execute grant.
- Rejects any other tenant, storefront channel, OPPS-linked order,
  paid/partial order, incomplete product configuration, pending gateway
  intent, blocked/review-required order and unconfirmed delivery fee.
- Derives amount in integer cents from the stored total and verified
  completed service-order receipts; no browser-provided amount.
- Returns a minimal eligible/not-payable outcome and notes this is
  **only a preflight**. It does not lock the order or grant charge authority.

The migration was compiled inside a rollback transaction and tested using
a rollback-only R350 counter fixture with one valid product and an authenticated
Café staff-role simulation. Assertions passed for authorized unpaid counter,
paid counter, storefront order, and unrelated user. Role/claim simulation is
**not** a full real signed-JWT HTTP acceptance test.

Staging migration permanently installed. Post-install SQL checks confirmed:
- function executable for `authenticated` but NOT `anon`;
- null/absent user identity returns `NOT_AUTHORIZED`;
- `qr_payments.payment_requests` remains empty.

New Edge Function `quick-solution-qr-opps106-preflight` v1 ACTIVE,
`verify_jwt=true`, read-only POST
`{"action":"check","orderId":"uuid"}`. It verifies the actual Supabase
Auth user token via `auth.getUser(jwt)`, then invokes the staff-scoped
RPC using that JWT. Browser CORS is pinned to the isolated staging Café
Vercel branch-preview hostname; CORS is NOT authorization.

**Not yet tested:** an authenticated real browser POST to this new
function. It cannot generate, issue, render or settle a QR. The normal
Café checkout, original payment functions, existing OPPS order state and
production remain untouched.

**Next:** build the durable short-lived QR issuance + guarded intermediate
redirect, map the scan to an order-specific canonical PayFast intent, and
complete gateway callback identity/settlement regression before any payable
QR is exposed.
