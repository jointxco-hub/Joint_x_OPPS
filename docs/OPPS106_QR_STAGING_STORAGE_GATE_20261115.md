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
