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

## 15 Nov 2026 — atomic counter QR issuance and scan validity gate

**Staging migrations permanently applied (production unchanged):**
- `20261115163500_opps106_counter_qr_issuance_disabled.sql`:
  private `qr_payments.issuance_controls` with `cafe_order=false` and
  `opps_invoice=false` defaults, no anonymous/user write access; authenticated
  staff `qs_opps106_issue_counter_qr(uuid,text)` RPC.
  It takes a `FOR UPDATE` lock on the canonical Café service order, invokes
  the existing staff-scoped `qs_opps106_counter_qr_preflight` after lock,
  checks the private issuance switch, uses a server-derived ZAR-cent total,
  reuses an identical active operation or a concurrent staff request,
  revokes/marks expired stale requests, and creates a 2-minute intermediate
  scan URL with an unpredictable server-generated UUID. Browser never
  supplies an amount.
- `20261115165200_opps106_scanned_qr_readonly_status.sql`:
  `qs_opps106_scan_counter_qr_status(uuid)` grants EXECUTE to
  `service_role` only; returns invalid, revoked, expired, settled or
  awaiting_gateway without customer information. It rejects paid, pending
  gateway intents, or changed order totals, even while a QR row is active.

**Staging Edge Functions:**
- `quick-solution-qr-opps106-preflight` v2, ACTIVE,
  `verify_jwt=true`: staff token verified with Supabase Auth, supports
  `{"action":"check","orderId":"..."}` and
  `{"action":"issue","orderId":"...","operationKey":"..."}`.
  Issue currently returns QR_ISSUANCE_DISABLED for authorized eligible
  orders because the server switch is **off**.
- `quick-solution-qr-opps106-scan` v1, ACTIVE,
  `verify_jwt=false` as a public scan landing: validates random UUID
  using a service-role-only read RPC; 404 for unknown, 410 for
  expired/revoked/settled, 503 for otherwise active requests.
  **It never redirects to PayFast and never accepts payment.**

**SQL rollback tests passed:**
- Staff simulated with the `authenticated` DB role + JWT subject;
  eligible new synthetic unpaid R350 counter order rejected with switch off.
- Within the same ROLLED BACK transaction, temporarily enabled the switch:
  first request generated R350/35,000 cents; same operation key reused
  request, second device's different operation key reused exactly same
  active ID and URL; unrelated user denied by preflight.
- Independently tested scanner state valid→awaiting_gateway and
  correctly constructed older expired request→expired; paid-order
  reference→revoked, unknown→invalid.
- Direct anon execute privileges on issuer/scanner false; scan only service
  role, issuance only authenticated staff. No test rows persisted.
- Post-apply verified both private switches false, QR request count **0**.

**Limitations / next release checks:**
- No real signed-user HTTP request has yet verified the v2 issue action.
- The scanner public HTTP page has been deployed, but an external GET
  could not be verified from this tool environment.
- **No PayFast checkout link and no payable QR** is available.
- Next implementation must atomically bind PayFast issuance to the QR
  request, verify the user's scan before initiating checkout and enforce
  expiration/revocation immediately before issuing a gateway URL, correlate
  signed PayFast ITN to one saved request and canonical receipt, handle
  late captures/quarantine. QR presentation module presently accepts only
  PayFast checkout hosts; it must be intentionally updated to recognize
  ONLY approved intermediate scan host/path once settlement is reviewed.
- Run realistic 2-device concurrency, real JWT HTTP, replay, expired scan,
  finance ledger and phone/iMin tests before enabling switch.
