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

## 15 November 2026 — QR sandbox gateway binding implemented (gate still OFF)

Staging-only SQL migrations applied:
- `20261115171500_opps106_qr_scan_payfast_intent.sql`: adds unique QR
  checkout-intent FK and checkout-start timestamp, plus service-role-only
  `qs_opps106_start_counter_qr_checkout`. Locks canonical Café order then
  QR request; verifies actual amount, no completed receipt, no unrelated
  pending intent, eligible products, tenant, mode and two-minute QR expiry;
  creates or reuses precisely one canonical pending PayFast intent. No
  browser-supplied amount or order identity.
- `20261115173000_opps106_qr_verified_settlement.sql`: service-role-only
  `qs_opps106_settle_counter_qr`. Following the *externally verified*
  signed PayFast ITN, it locks the order/QR, checks QR identity, cents and
  its canonical pending intent, calls the existing Café
  `commerce.qs_apply_payfast_payment` in the same transaction, and marks
  the QR settled only after receipt verification. Same provider reference
  is replayed without a second receipt; different provider reference,
  late/altered or mismatched capture goes to Finance exception/quarantine.
  A checkout initiated before QR expiry can finish within a bounded
  60-minute window; the expired QR itself cannot be scanned again.
- `20261115174500_opps106_qr_scanner_intent_reuse.sql`: fixes scanner status
  so an already-started QR accepts only its **own** pending PayFast intent
  during QR lifetime, but refuses any unrelated pending/complete payment.

These were tested via **rollback SQL fixtures**, not real PayFast callbacks:
- sandbox-only gate disabled => no checkout;
- temporarily enable in transaction => first R350 QR scan creates one
  pending intent; repeat scan reuses the exact intent; expired scan refused;
- a simulated service-role capture credits one R350 receipt in rollback,
  same reference returns replay, a second reference goes to review;
- scanned QR status accepts its own pending intent but no other payment.
All test fixtures were ROLLED BACK and never represented actual money.

Staging-only Edge Functions:
- `quick-solution-qr-opps106-notify` **v1 ACTIVE**, verify_jwt=false:
  separate QR-only PayFast callback. Reuses the proven signed-ITN
  validation pattern: explicit sandbox mode, Cloudflare source-IP allowlist,
  PHP URL-encoded MD5 signature, merchant/m_payment_id/QR identity,
  remote PayFast VALID. On COMPLETE invokes the canonical QR settlement
  RPC. No changes to the already-working Café checkout/webhook.
- `quick-solution-qr-opps106-scan` **v3 ACTIVE**, verify_jwt=false:
  public bearer-UUID scan URL. Rejects invalid/expired/revoked QR;
  sandbox-only checkout signing takes PayFast merchant credentials from
  Edge secrets and request/amount/intent from server-locked SQL. Never
  derives amount, origin or PayFast host from the caller. Browser return
  message expressly does not claim a payment; ITN is authoritative.
- Existing `quick-solution-qr-opps106-preflight` **v2 ACTIVE**, verify_jwt=true:
  staff QR check/issue API remains behind OFF issuance switch.

Post-install database audit:
- `qr_payments.issuance_controls`: `cafe_order=false`,
  `opps_invoice=false`.
- `qr_payments.payment_requests`: 0 total / 0 active / 0 checkout intents.
- Anonymous/authenticated roles cannot directly execute the
  QR start/settlement RPCs; service_role can.

### Outstanding gates — do NOT enable issuance yet

- Real authenticated staff HTTP request through staging Edge Function,
  then actual phone/iMin D4 QR scan, PayFast **sandbox** wallet payment,
  signed ITN 200 and exactly one R350 ledger receipt have NOT happened.
- Noncomplete (FAILED/CANCELLED) QR ITNs currently receive a safe no-ledger
  acknowledgement; reconcile their pending intent cleanup before release.
- Scan link expiry is checked before issuing the PayFast hosted URL.
  PayFast's already-issued hosted URL may remain reusable independently;
  verified additional captures go to Finance review but this does not
  itself prevent a second wallet/card debit. Test and design checkout
  cancellation/expiry at the provider or an appropriate compensating flow.
- Frontend QR renderer still needs an explicitly reviewed
  staging scan URL host/path allowance and UI; no counter QR button
  has been enabled.
- Real signed-JWT HTTP, HTTP webhook replay/negative cases, cross-tenant,
  concurrent Cash/EFT, cancel/failure, late capture, security advisors,
  regression suite, full release review before any production migration.
- HTTP GET to public staging scan URL was not independently reachable from
  the assistant's browsing environment; deployment ACTIVE is confirmed,
  not an HTTP acceptance-test result.

The QR payment system is **integrated in staging code but intentionally
not enabled for users**. Production systems are untouched.

## 15 November 2026 — QR FAILED/CANCELLED callback reconciliation

Migration `20261115181500_opps106_qr_noncomplete_events.sql`
was applied **only to staging**:
- Private RLS-enabled `qr_payments.noncomplete_events`, denied to
  `anon` and `authenticated`, with limited `service_role` grants.
  Retains verified noncomplete provider events with request/order/tenant
  identity, amount cents, handling and unique provider/status/request key.
- New service-only
  `public.qs_opps106_record_counter_qr_noncomplete(uuid,uuid,uuid,bigint,text,text)`
  locks the order then request, matches tenant, amount, saved checkout intent
  and pending status; closes only that matching `pending` intent to
  `cancelled`/`failed`, revokes the associated QR, and writes an
  auditable noncomplete event. Mismatch, already-settled and stale cases are
  logged without claiming a payment. No client-selected payment status.
- Dedicated `quick-solution-qr-opps106-notify` **v2 ACTIVE** now calls that
  function for only source-allowlisted, locally signed,
  merchant-identity matched, remotely PayFast-validated
  `FAILED`/`CANCELLED` ITNs. Database failure returns 503
  (retry), not a false 200 success. Complete captures still route
  exclusively through the atomic QR settlement RPC.

**Rollback-tested in staging:** synthetic R350 QR initiated one pending
intent; a verified-simulation cancelled event changed that exact intent
to cancelled, created one noncomplete ledger record, repeated event did
not duplicate it; subsequent simulated COMPLETE went to
`CAPTURE_REQUIRES_RECONCILIATION`, with ZERO completed order receipts.
All fixture rows rolled back. This does not simulate an actual PayFast
signed HTTP callback or bank debit.

Post-deploy verification: `cafe_order=false`,
`opps_invoice=false`, zero QR requests, zero noncomplete events,
no direct anon RPC execution or private table read.
Supabase callback deployment v2 ACTIVE.

**Browser HTTP test blocker:** container-side curl to the Supabase
staging hostname failed DNS resolution (`Could not resolve host`).
We cannot assert real HTTP GET/POST/PayFast callback behavior from this
environment. Validate staging project URL and actual route using a
trusted client/browser before permitting QR issuance.

**Unresolved risk:** a customer can abandon a PayFast hosted checkout
without a usable signed FAILED/CANCELLED callback. Its pending intent
must be treated as `review_required` after a defined age, not
automatically cleaned and retried without validating provider status.
PayFast-hosted URL reuse after QR expiry can still debit a customer;
an expired local QR alone is NOT proof of provider-side cancellation.
Keep the QR gate OFF until provider-side URL/retry behavior, operator
reconciliation and duplicate-capture remediation are verified.

**Read-only stale intent review (safe for service-privileged SQL):**
```sql
select r.id as qr_request_id,
       r.target_id as cafe_order_id,
       r.expires_at,
       r.checkout_started_at,
       p.status as payfast_intent_status,
       extract(epoch from now()-r.checkout_started_at)/60 as age_minutes
from qr_payments.payment_requests r
join commerce.service_order_payments p on p.id=r.checkout_intent_id
where r.target_type='cafe_order'
  and p.status='pending'
  and r.checkout_started_at < now()-interval '30 minutes'
order by r.checkout_started_at;
```
Never automatically mark these paid or cancelled based only on elapsed
time. Escalate to manual PayFast-side status checking.

## 15 Nov 2026 — staff QR test screen in isolated OPPS feature branch

Committed (not released to production):
- `src/api/cafeCounterQr.js`: signed-in Supabase staff RPC preflight
  and issuer client; requires UUID, valid operation key, authenticated
  session; browser never supplies amount or tenant.
- `src/pages/CafeQrSandbox.jsx`: OPPS-only `/CafeQrSandbox` route
  protected by existing app auth, current Café workspace and exact
  staging Supabase project URL. A staff member can input Café
  `commerce.service_orders.id`, check server eligibility and request
  a sandbox scan link. While database issuance is OFF, the request
  returns `QR_ISSUANCE_DISABLED`; no PayFast link is issued.
  No QR image generation yet: the page only renders the server-validated
  scan URL when issuance eventually becomes approved.
- `src/App.jsx`: authenticated route added separately, leaving
  autogenerated `pages.config.js` untouched and no production nav entry.
- `src/features/cafeQr/paymentRequestView.js`: explicit opt-in
  `allowStagingScan` allows ONLY exact
  `https://tijiamrfnxrbitafiflj.supabase.co/functions/v1/quick-solution-qr-opps106-scan?rid=<uuid>`.
  Lookalike host, extra query, invalid UUID, fragments or expired state
  fail closed; production defaults to the prior PayFast URL whitelist.
- `tests/issue-106-qr-staff-ui.test.mjs`: new regression source and
  URL validator tests. **Not yet executed by CI**; branch compilation
  and real browser UI are not verified.

The staff screen directly calls permissioned Supabase RPCs, not the
previous staging Edge preflight CORS-restricted to the Café preview.
The DB RPC derives the authenticated user from `auth.uid()`,
checks tenant membership and capability, and still enforces private
issuance switch OFF. No service key is exposed in the browser.

**Known gap:** test container DNS cannot resolve Supabase or Vercel;
do not claim a successful HTTP acceptance check. The OPPS feature
route is committed but not verified as deployed and visible at a
staging URL. Next: run Node tests and Vite build, deploy only to an
isolated OPPS preview, verify signed-in staff preflight and blocked
issue request in browser; then deliberately schedule a controlled
PayFast sandbox scan after the hosted checkout re-use risk is reviewed.

Verification after these commits: both issuance controls false,
`qr_payments.payment_requests` count 0, stale pending QR count 0.

## 15 Nov 2026 — real CI tests and ready OPPS preview

- Vercel linked OPPS project `joint-x-opps` on team `joint-x`
  published **READY** preview for commit
  `e64d0de42573302dc8f5df87413308a36de473ae`, containing the
  isolated `/CafeQrSandbox` route:
  `https://joint-x-opps-git-feature-106-cafe-visibility-qr-joint-x.vercel.app/CafeQrSandbox`.
- Read-only inspection of Vercel Preview `VITE_SUPABASE_URL` confirmed
  it targets `https://tijiamrfnxrbitafiflj.supabase.co` (staging),
  NOT production; do not echo or expose the separate anon key.
- Added branch-scoped GitHub Actions
  `.github/workflows/opps106-qr-safety.yml`, with
  read-only repository permission and no deployment secrets, to run
  the QR presentation, staff UI security and PayFast correlation
  Node test files.
- Initial CI run caught one **invalid test fixture**: a signature
  placeholder was followed by a signed field, which the signer
  correctly rejects. Fixed the test to sign all unsigned fields
  first, then separately assert that appending a field after
  `signature` is forbidden.
- Re-run GitHub Actions run `43727517121`, job `132852576325`
  passed **18/18 tests**, zero failures on Node 24.
  See https://github.com/jointxco-hub/Joint_x_OPPS/actions/runs/43727517121.

**Remaining:** browser navigation/login/real authenticated RPC
request not yet validated; full application test suite and actual
PayFast sandbox phone scan not yet performed. CI runs pure Node
security tests; Vercel READY reports successful app build, not
customer-facing acceptance.

Both QR issuance switches remain OFF and no QR requests/charges
were created.

## 15 Nov 2026 — ONE-order PayFast sandbox trial enabled (expires automatically)

Verified PayFast's official custom payment documentation confirms merchant
`m_payment_id` correlation and sandbox wallet testing; no official
guarantee established that a signed, already-issued hosted checkout URL
cannot be revisited/paid again. The 14-day PayFast Request Money expiry
does not apply to the custom PayFast checkout used here. Safeguards in
our QR ledger, callback and Finance review remain necessary.

Staging migration `20261115193000_opps106_single_order_qa_gate.sql`
was compiled/tested inside a rolled-back transaction and applied to
staging. It adds `allowed_order_id` and `active_until` to the
private QR issuance control, and alters both staff issuer and public
scan-to-checkout RPC to require **exact allowed order ID and
unexpired window**, not merely global `enabled=true`.
The staff issuer additionally blocks ANY fresh issuance after a first
QR request for that exact test order; different staff attempts may only
reuse that same active request. No unrestricted tenant-wide
activation is possible via this gate.

Rollback tests verified a staff-issued scoped R60 QR, idempotent second
request, refusal of re-issue after old QR expiry, and missing-request
rejection without mutating durable rows.

**Time-limited activation** in staging:
- tenant Quick Solution Café; `cafe_order` only,
- order `QS-261115-33EC`,
  `76cfdcca-2447-4f5e-9d57-360da7a2fb1d`, R60 unpaid,
- `qr_payments.issuance_controls.cafe_order.enabled=true`,
  `allowed_order_id` exact UUID,
  `active_until=2026-11-15 16:07:47.092754+00` (18:07:47 SAST).
- `opps_invoice.enabled=false`.
- At initial readback 2026-11-15 15:23:05 UTC, scope active,
  0 QR request rows, 0 started checkouts, order still unpaid.
- After `active_until`, both the staff issue RPC and public QR
  scan-to-PayFast RPC reject use even if the row's `enabled` bit
  remains true. No scheduler automatically toggles the bit.
- This is a PayFast **sandbox** wallet test; never submit live card
  details or treat browser return as settlement.

**Next manual acceptance:** staff opens isolated OPPS preview
`/CafeQrSandbox`, enters the R60 UUID, checks eligibility and
requests QR; screen currently displays a validated **scan link**
rather than an encoded QR image. Open that link on a separate
phone/browser while the two-minute QR itself is valid; verify
redirect reaches `sandbox.payfast.co.za` only. Complete a single
sandbox wallet transaction and inspect signed QR-specific ITN,
one completed Café receipt, order paid, QR settled and any linked
OPPS projections. STOP on provider error and do not attempt
a second payment without review.

**Unresolved release blocker:** custom hosted PayFast URL can possibly
be replayed after QR expiry. Any additional capture is quarantined
for Finance rather than double-posted; this does not guarantee
a second payer debit could not occur. Live release requires
provider-side confirmation and remediation/refund workflow.
Production remains unchanged.

## 15 November 2026 — first live QR scan bug and fix

Actual signed-in staff trial of R60 counter order
`QS-261115-33EC` / `76cfdcca-2447-4f5e-9d57-360da7a2fb1d`:
- Staff issuance at 15:27:59 UTC created QR
  `7705b342-1323-4b54-89d1-30990b9d91ea`, amount 6,000 cents,
  expires 15:29:59 UTC. No PayFast checkout intent ever created.
- Public scan GET at 15:28:09 UTC returned HTTP 404 according to
  Supabase function_edge_logs, **before expiry**. The browser displayed
  raw HTML containing "invalid request" rather than a rendered page.
- ROOT CAUSE of 404: `quick-solution-qr-opps106-scan/index.ts`
  used a malformed UUID regex that omitted the fourth UUID segment:
  `[89ab][0-9a-f]{12}` instead of
  `[89ab][0-9a-f]{3}-[0-9a-f]{12}`. Even valid server-issued UUIDs
  failed validation before database lookup.
- Database scanner status simulated before expiry inside a ROLLED BACK
  transaction returned `awaiting_gateway`, confirming the underlying
  QR/order state was eligible; its current status naturally returns expired.
- Fixed and deployed Edge scanner **v4 ACTIVE**, commit
  `d3b52a0f2d99b14ad14e0cfbd707284d1350fe34`.
- Added regression `tests/issue-106-qr-scan-uuid.test.mjs`
  for real issued UUID, malformed/truncated inputs; QR CI run
  `43730375910` passed **20/20**, zero failures.
- Immediately disabled Café issuance again; invoice issuance stayed
  disabled. Original unused QR was marked `expired` with NULL URL
  after its deadline, with checkout_intent_id NULL.
  R60 order remains unpaid; no charge or receipt generated.
- **Unresolved**: user's browser showed response HTML literally (MIME
  / response rendering). The Edge source sets `text/html`,
  but actual HTTP response headers have not been captured.
  Need a fresh browser test and inspect Headers/Content-Type.
- One-use order rule means **do not re-enable and issue another QR
  for this same R60 order**. A future genuine sandbox run requires a
  NEW unpaid counter order and new narrowly scoped activation after
  scanner GET and HTML rendering tests.

No production changes.

## 15 November 2026 — R72 sandbox completion but rejected ITN; return-page fix

User confirmed PayFast sandbox completion for R72 Café counter order
`QS-261115-9641`, order UUID
`f89b7e69-e642-46ef-8d3b-85fa25b473cf`.
This is NOT YET a completed OPPS payment. Authoritative staging
checks showed:
- QR `0fd9376f-2b3d-4df3-97d8-d46e04df37fe` amount 7200 cents,
  checkout intent `9397a087-d81e-4c6b-a72a-2fd0371a7502`,
  started 15:42:25 UTC, still pending and without provider reference.
- Public scanner GET at 15:42:25 UTC returned HTTP **303** (redirect).
- QR-specific PayFast ITN POST at **15:43:04 UTC returned 403**;
  function log: `[qr-itn] Invalid merchant/order/intent identity`.
- Browser GET return to scan function
  `...?rid=...&return=1` returned **HTTP 200** at 15:43:21 UTC.
  The staff OPPS page did not auto-refresh/confirm payment. Browser
  return is NOT settlement evidence.
- Root cause of ITN rejection: same malformed UUID regex previously
  fixed in the QR scanner was still present in QR notifier. This rejects
  valid custom_str1/order, custom_str3/request and custom_str5/tenant
  before the remote PayFast validation and canonical settlement.
- Fixed `quick-solution-qr-opps106-notify` and deployed **v3 ACTIVE**
  with the correct five-part UUID regex. Added
  `tests/issue-106-qr-notify-uuid.test.mjs`; GitHub QR CI
  [run 43731612660](https://github.com/jointxco-hub/Joint_x_OPPS/actions/runs/43731612660)
  passed **23/23**.
- New static neutral no-PayFast-claim pages:
  `public/opps106-qr-return.html` and
  `public/opps106-qr-cancel.html`. QR scanner **v5 ACTIVE** now signs
  URLs to isolated feature-branch preview static pages instead of
  the prior Supabase function HTML. This is effective for FUTURE
  checkouts only; old PayFast return URLs cannot be altered.
  CI [run 43731767428](https://github.com/jointxco-hub/Joint_x_OPPS/actions/runs/43731767428)
  **25/25 passed**. HTML page route Vercel deployment readiness and
  real-browser rendering still require an independent acceptance check.
- Immediately switched both QR issuance controls OFF. Order remains
  `unpaid`, original pending intent/QR not mutated or mis-credited.
- PayFast official docs (developers.payfast.co.za) explicitly state
  **Sandbox payment notifications are sent only once**, notwithstanding
  generic live ITN retry guidance. Do not assume failed initial sandbox
  notification will retry after callback fix.
- **Finance reconciliation required**: look up transaction in PayFast
  Sandbox dashboard, ITN and transaction detail, by merchant reference
  `JXQR-0fd9376f-2b3d-4df3-97d8-d46e04df37fe`. Confirm amount,
  status, provider payment ID and ITN failure, without exposing
  credentials. Do NOT replay a fabricated signed ITN or set the order
  paid from a browser return. Test a legitimate provider-native
  redelivery if offered and if the signed source passes all validation,
  otherwise use reviewed sandbox reconciliation with independent provider
  proof. No second charge/retry until provider-side status is confirmed.

Production unchanged; PR remains DRAFT.

## 15 Nov 2026 — PayFast dashboard resend multipart ITN (QR v4)

Following the R72 checkout, the user attempted a PayFast dashboard
`Resend ITN`. PayFast displayed "ITN resend failed".
Authoritative Supabase function logs showed **two real resend POSTs**:
- 15:52:56 UTC: POST QR notify HTTP 403.
- 15:53:36 UTC: POST QR notify HTTP 403.
- Signature diagnostics showed a MIME multipart boundary and
  `Content-Disposition: form-data; name` as ONE bogus URL-encoded
  key, with no `signature` field. Root cause: dashboard resend
  payload `multipart/form-data`, whereas QR handler called
  `URLSearchParams(await req.text())` for every request.
- Other safeguards (IP, source, merchant, signature, remote PayFast VALID,
  canonical receipt) were intentionally NOT bypassed.

Fixed isolated staging QR notification handler:
- Accepts `application/x-www-form-urlencoded` and
  `multipart/form-data`, validates multipart with `req.formData()`,
  rejects file values, duplicate keys, invalid field names, unsupported
  media types, and oversized normalized bodies.
- Re-serializes decoded multipart fields as a URL-encoded form, preserving
  order; then runs the **same** local signature/merchant/trusted source
  and PayFast server-side validation before any SQL settlement.
- GitHub Actions QR safety run
  [43732533278](https://github.com/jointxco-hub/Joint_x_OPPS/actions/runs/43732533278)
  passed **28/28** tests; the multipart test currently covers source
  integration guards, not a true PayFast-signed multipart fixture.
- Staging `quick-solution-qr-opps106-notify` **v4 ACTIVE**.
- No new transaction, receipt or QR was created. Existing R72 order
  remains unpaid, its PayFast intent pending, both issuance gates OFF.
- **Still unverified:** actual dashboard resend with v4, remote PayFast
  VALID acceptance, and database settlement. Before a controlled
  resend, verify the sandbox transaction is COMPLETE and exactly R72,
  using merchant reference
  `JXQR-0fd9376f-2b3d-4df3-97d8-d46e04df37fe`.
  Resend the EXISTING notification only, never start another checkout.
  If PayFast reports another failure, capture ITN response and inspect
  backend log; do not loosen signature/IP checks or fake a completed
  receipt.

Production remains untouched.

## 15 Nov 2026 — R72 settled, staff-confirmed OPPS handoff workflow

Verified staging service-order `QS-261115-9641`,
`f89b7e69-e642-46ef-8d3b-85fa25b473cf`:
- Order payment_status `paid`, amount R72.00.
- Exactly 2 `commerce.service_order_payments` rows: one
  `cancelled` original PayFast pending intent and one `completed`
  R72.00 payment, provider ref `3520172`. **Only one actual completed
  payment: no duplicate receipt.**
- `commerce.service_order_handoffs.status='ready'`,
  no blockers; one informational `COUNTER_GUEST_NO_CONTACT` warning
  because the walk-in supplied no email/phone.
- Existing preview payload `ready=true`,
  proposed OPPS `payment_status='paid'`, `deposit_paid='72.00'`.
- `service_orders.opps_order_id IS NULL`, and no OPPS order matching
  this source UUID or order number exists. **Not sent to OPPS.**
- Existing staff-only RPC
  `admin_send_quick_solution_order_to_opps(uuid)` checks
  signed-in Café staff `cafe.operations.manage`, locks original
  service order, applies deterministic handoff idempotency and calls
  canonical finance ledger synchronization. Do NOT execute through
  unauthenticated/superuser bypass.

Added isolated OPPS feature-branch code:
- `src/api/cafeQrHandoff.js`: signed-in staff preview/send RPC client.
- `src/pages/CafeQrSandbox.jsx`: separate "Send paid order to
  OPPS" panel, **Preview OPPS handoff**, payment/deposit/warning/blocker
  display, explicit checkbox approval and "Confirm Send to OPPS".
  QR payment remains disabled; this is an operations handoff, not
  a charge or payment replay.
- `tests/issue-106-qr-handoff-ui.test.mjs`, now included in QR
  CI workflow. [Run 43733109774](https://github.com/jointxco-hub/Joint_x_OPPS/actions/runs/43733109774)
  passed **31/31** Node safety tests.

**Deployment blocker:** Latest handoff UI could not be deployed through
Vercel. `create_deployment` returned **HTTP 402
`api-deployments-free-per-day`**, with suggested cooldown 24 hours.
Existing READY preview is at an OLDER commit and DOES NOT yet contain
this handoff panel. Vercel project quota/billing is user controlled;
do not alter production, upgrade a plan or claim the feature is live.
Once deploy allowance returns, publish an isolated preview from commit
`49ababec596d9077b803d0530f2b04850f226c0a` or later, check
staging env configuration, then ask signed-in staff to preview and send.

Post-work database check: R72 order remains paid, submitted,
`opps_order_id=NULL`, handoff **ready**; no staff send occurred.

## 18 Nov 2026 — Customer payment confirmation & Café counter paid state

The R60 counter QR for order `QS-261118-98C6` (`7334c164-8294-4ef2-a9bd-9b87b4ee9e27`)
successfully scanned, completed at PayFast Sandbox, settled via signed ITN,
and was independently verified:
- QR ID `f50bd2bf-7ee5-4389-b9d6-9867e04d8e66` status `settled`,
  amount_cents 6000, gateway reference `3526444`.
- Exactly **one** completed R60 receipt. Café order `paid`;
  no OPPS handoff yet. Both QR issuance switches **OFF**.
- Customer originally saw neutral `Payment verification in progress` after
  browser return, because old return URL had no correlation identifier.
- Added scoped `?rid=<opaque request UUID>` to *future* PayFast-signed
  return/cancel URLs; the URL remains static staging Vercel host. No PII
  included in return query.
- Staging scan Edge Function **v6 ACTIVE**: readonly
  `GET ?rid=<UUID>&status=1` queries service-role-only
  `qs_opps106_scan_counter_qr_status(uuid)`, returns ONLY minimal
  `{state:"paid"|"pending"|"unavailable"}`, with no-store caching and
  origin-specific CORS; no checkout creation or write RPC in that path.
  `paid` maps exclusively to server `settled`, not browser return.
- Updated `public/opps106-qr-return.html`: bounded polling (~90s),
  shows `Payment confirmed` only after server `paid`; otherwise
  pending, delayed, or safe unavailable message. Instructions explicitly
  warn not to pay twice. No customer details or payment mutation.
- CI [run 44289150323](https://github.com/jointxco-hub/Joint_x_OPPS/actions/runs/44289150323):
  **33/33 pass**. New OPPS staging preview READY
  `https://joint-x-opps-o4y01r0rc-joint-x.vercel.app`.
- Café Counter feature branch updates the server-paid order card to show
  a prominent `Payment confirmed`, `View / Print receipt`, `Next sale`.
  The paid view hides further payment controls even if local QR state has
  not yet cleared. Café focused tests **63/63 pass** and Vite build pass.
  Full suite still has 5 unrelated pre-existing storefront PayFast and
  delivery-copy failures; keep release gated.
- New Café staging preview READY:
  `https://quick-solution-cafe-staging-kgxecnvop-joint-x.vercel.app/counter`.
- **No new payments or production rollout.** Existing R60 settled QR
  can be safely used to acceptance-test the return status page using
  `/opps106-qr-return.html?rid=f50bd2bf-7ee5-4389-b9d6-9867e04d8e66`.
  This GET does not start checkout. Confirm browser actually displays paid
  before treating customer status UX as accepted.

## 18 Nov 2026 — Fixed false "Verification unavailable" on customer return

Browser acceptance after the first return-page update showed
"We could not verify the payment" even though the R60 QR request was
already `settled`. Staging RPC directly confirmed `settled`; the
client-to-Edge cross-origin GET was not observed in relevant Edge logs.
The exact browser-network rejection mechanism was not independently
captured, so do not claim a specific CORS/CSP root cause.

The fix avoids cross-origin browser status lookup entirely:
- New same-origin Vercel serverless read-only handler
  `api/opps106-qr-status.js`; strict UUID and one-query-argument
  validation, fixed Supabase staging origin, **always** adds `status=1`,
  upstream redirect disabled, 6s timeout, narrow `{state}` response,
  `no-store`, no credentials, no payment writes.
- `vercel.json` explicitly routes `/api/opps106-qr-status`
  before SPA fallback.
- `public/opps106-qr-return.html` now calls that same-origin endpoint;
  CSP uses `connect-src 'self'`.
- [QR test run 44291729835](https://github.com/jointxco-hub/Joint_x_OPPS/actions/runs/44291729835)
  **37/37 PASS**, including relay behavior and error handling.
- Vercel preview with exact commit `0395c66e9ecd393d00b0ff67041d066e3fe1908b`
  is **READY**.
- Independently fetched real staging alias
  `https://joint-x-opps-git-feature-106-cafe-visibility-qr-joint-x.vercel.app/api/opps106-qr-status?rid=f50bd2bf-7ee5-4389-b9d6-9867e04d8e66`:
  **HTTP 200**, `content-type: application/json`, **`{"state":"paid"}`**.
- Independently fetched matching static return page at that alias:
  **HTTP 200**, `text/html`, correct same-origin JS.
- Still need actual browser acceptance of the refreshed return page
  (JS execution), then the mobile/iMin paid-card acceptance.
  Production unchanged; both issuance switches OFF, no new charges.
