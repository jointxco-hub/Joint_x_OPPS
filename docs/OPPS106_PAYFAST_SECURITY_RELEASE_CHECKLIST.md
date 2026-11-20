# OPPS-106 PayFast QR security hardening — staging release checklist

Status: **committed to feature/106-cafe-visibility-qr, NOT DEPLOYED**.
Do not enable live checkout or notify until a trusted source-IP header is verified
and sandbox end-to-end tests pass.

## Files

- `supabase/functions/quick-solution-payfast/index.ts` — same hosted checkout
  flow, but ignores request Origin and uses only `QUICK_SOLUTION_RETURN_ORIGIN`.
  Requires explicit sandbox mode and passphrase. Binds checkout
  `custom_str3` to the exact checkout intent ID.
- `supabase/functions/quick-solution-payfast-notify/index.ts` —
  local ITN MD5 signature, merchant ID, source IP allowlist, strict
  notification fields and exact amount/intent binding are required
  *before* contacting PayFast validation endpoint and the privileged payment
  reconciliation RPC. Transient backend failures return 503 for retry.
- `supabase/migrations/20261114224000_opps106_payfast_intent_binding.sql` —
  service-role-only, READ-ONLY helper used by ITN to correlate exact pending or
  completed checkout intent with the service order, merchant reference and
  amount. Does not expose `commerce` schema to browser clients.
- `tests/qs-payfast-hardening.test.mjs` — offline signature and security-gate
  regression cases.

## Required settings in STAGING (secret values must never be committed)

- `PAYFAST_SANDBOX=true` explicitly.
- `PAYFAST_MERCHANT_ID`, `PAYFAST_MERCHANT_KEY`,
  `PAYFAST_PASSPHRASE` — matching the sandbox merchant account.
- `QUICK_SOLUTION_RETURN_ORIGIN=https://<verified-cafe-staging-origin>`
  (pure origin, no path/query/hash).
- `PAYFAST_TRUSTED_CLIENT_IP_HEADER=cf-connecting-ip` only AFTER confirming
  the managed gateway strips/overwrites client-provided values. Do not choose
  `x-forwarded-for` or `forwarded`.
- `PAYFAST_SOURCE_IP_GATEWAY_VERIFIED=true` only AFTER that ingress
  guarantee is validated. Absent this, notify deliberately rejects callbacks.
- `PAYFAST_SANDBOX_SOURCE_IPS=<verified sandbox source IPs/CIDRs>`.
  Enter known PayFast sender IPs. Runtime supports exact IPv4 or CIDR ranges.
- `PAYFAST_LIVE_SOURCE_IPS=<verified PayFast live CIDR list>` for future
  production deployment; keep list current with PayFast official documentation.

PayFast's published ranges are in
https://developers.payfast.co.za/documentation/
and official callback guidance at
https://developers.payfast.co.za/docs/itn-instant-transaction-notification/ .
Check actual sandbox sender addresses and the trust boundary; don't assume
any `cf-connecting-ip` value received by an untrusted proxy is safe.

## Deployment order (STAGING only)

1. Apply the new read-only migration and test anon/authenticated EXECUTE denied,
   service_role granted.
2. Verify staging environment variables and gateway source-header behavior.
3. Deploy the **notify** function (still fail-closed if missing configuration),
   then the **checkout** function. Both are currently verify_jwt=false because
   they handle public payment tokens and PayFast server callbacks, not user JWTs.
4. Generate a NEW checkout URL/QR (old URLs have no custom_str3 and intentionally
   cannot be credited after the hardening change). Invalidate old pending
   intents safely according to payment policy after confirming they are unpaid.
5. Make one sandbox transaction. Confirm correct PayFast source IP, signature,
   merchant, exact intent, amount, VALID response and one canonical payment.
6. Replay identical notification: no extra receipt. Try wrong signature,
   source IP, merchant, amount, reference, intent ID and duplicate fields;
   no order may be credited.
7. Confirm the result is visible in Café, OPPS invoice/order, and tenant-routed
   tracking. Test payment cancel/failed return paths.
8. Review the production-shape migration, permissions and PayFast configuration,
   then only deploy with explicit release authorization.

## Checks completed

- Staging SQL `BEGIN/ROLLBACK` test: correct intent returns true, mismatched
  order/reference/amount/intent return false.
- Staging SQL permission test: anon=false, authenticated=false,
  service_role=true for execute privilege.
- Exact helper source evaluated offline with deterministic digest stub
  (not a genuine PayFast integration test): valid signature input passed,
  tampered amount failed, duplicate merchant field failed, IPv4 CIDR inclusion
  and exclusion passed.
- No credential values fetched or printed; no payment initiated; no deployment
  made; production unchanged.

**Open release gate:** test the source-IP trust boundary and actual incoming
PayFast ITN in a controlled sandbox before saying this is production-ready.

## 14 November 2026 — staging canary deployment update

Completed:
- Applied `opps106_payfast_intent_binding` to **staging only**, with success
  reported by Supabase.
- Ran persisted-function checks: matching intent=true, wrong amount=false,
  wrong intent=false; anon and authenticated cannot execute; service_role can.
- Deployed two **separate** staging Edge Function endpoints, leaving existing
  checkout and notify versions unchanged:
  - `quick-solution-payfast-opps106-test` (v1, active).
  - `quick-solution-payfast-notify-opps106-test` (v1, active).
- Canary checkout has its notify_url pointed at the canary notify function.
- Confirmed both deployments' source and active status via Supabase tools.
- Security advisors consulted; existing findings are not an approval of this
  feature or its gateway setup.

Still blocked:
- Need actual proof that Supabase's inbound `cf-connecting-ip` value cannot
  be spoofed on the Edge Function URL, including forged-header request.
- No supported access to inspect staging secret **names/values** here; do not
  infer `PAYFAST_SANDBOX`, return origin or trusted-IP settings are present.
- This execution environment cannot resolve the staging HTTPS URL via curl,
  so HTTP-level canary calls and PayFast sandbox payment are **not yet tested**.
- Canary webhook deliberately fails closed if the source-IP trust/configuration
  gate is absent.
- The two original staging payment functions and production are unchanged.

Use only the canary URLs when ready for negative and positive sandbox testing:
`https://tijiamrfnxrbitafiflj.supabase.co/functions/v1/quick-solution-payfast-opps106-test`
`https://tijiamrfnxrbitafiflj.supabase.co/functions/v1/quick-solution-payfast-notify-opps106-test`

Do not send real money through these testing functions.

## Follow-up staging verification — 14 November 2026 (canary v2)

- The staging URL was probed from the execution container; outgoing DNS
  resolution failed. External webpage retrieval also could not reach the
  canary endpoint. Neither result proves the function itself is down.
- PayFast's published source range list was consulted. An October 2026
  Supabase public community discussion says `cf-connecting-ip` should be
  overwritten at Cloudflare, but a maintainer explicitly asked for an
  authoritative gateway contract; the security assumption remains **unverified**
  until a controlled spoofed-header test and/or provider confirmation.
- Fixed a second security/correctness issue: after the successful PayFast
  projection, the original pending intent may become `cancelled` and a
  separate completed gateway payment record is created. A genuine replay
  must be matched by the **same PayFast provider payment ID**, not merely by
  the old intent ID and amount.
- Added `20261114225000_opps106_payfast_intent_replay.sql` and applied
  the migration **to staging only**.
- Live database assertions passed:
  `valid_replay=true`, `wrong_payment_id=false`,
  `valid_pending=true`, `wrong_amount=false`;
  anon=false, authenticated=false, service_role=true for execute privilege.
- Deployed the updated staging notification canary, version **2**, active.
  Existing original staging checkout/notify functions and all production
  functions were unchanged.
- No successful PayFast sandbox transaction can be claimed. Staging environment
  variable values, actual inbound client-IP header, and the hosted checkout
  still require verification.

Official source IP docs:
https://developers.payfast.co.za/documentation/
Supabase hosted header contract discussion:
https://github.com/orgs/supabase/discussions/52040

## 14 November 2026 — ingress test function / Trinity script

- Staging-only function `opps106-staging-ingress-check` v1 deployed and
  confirmed ACTIVE. It reports no IP address or secret values; only a
  literal-header equality test and boolean configuration readiness flags.
  It is a temporary public diagnostic and should be disabled after testing.
- GitHub script:
  `scripts/opps106-check-staging-ingress.ps1`.
- Run on Trinity in PowerShell:
  `powershell -ExecutionPolicy Bypass -File .\\scripts\\opps106-check-staging-ingress.ps1`
  from the checked-out feature branch, or manually execute:
  `curl.exe -sS -H "CF-Connecting-IP: 203.0.113.9" https://tijiamrfnxrbitafiflj.supabase.co/functions/v1/opps106-staging-ingress-check`.
- Required interpretation: `ingress_header_present=true` and
  `forged_header_survived=false` indicate the forged value was overwritten
  on that single request path. A true spoof result is a HARD STOP. This is
  not proof of every alternative ingress route, so the gateway contract
  remains a prerequisite for production.
- The diagnostic reports `PAYFAST_SANDBOX`, merchant ID/key/passphrase
  presence, origin validity, source-IP flag/header, and sandbox allowlist
  as booleans. It never reveals values.
- Direct HTTPS access from our execution environment remains unavailable
  (DNS resolution failure); **no actual HTTP spoof test has been executed**
  by the assistant as part of this change.

## 15 November 2026 — Trinity gateway evidence and diagnostic retirement

Trinity PowerShell observations supplied by operator:
- Normal GET to staging ingress diagnostic: HTTP 200, JSON showed
  `ingress_header_present=true`, `forged_header_survived=false`.
- Same URL with a caller-forged `CF-Connecting-IP: 203.0.113.9`:
  HTTP 403 Cloudflare error 1000, without Supabase function response.
- DNS resolved against 1.1.1.1 after intermittent timeout.
- Staging presence booleans: `PAYFAST_SANDBOX=true`,
  merchant ID/key/passphrase configured; return origin NOT configured;
  source-gateway flag NOT configured; trusted source header NOT configured;
  sandbox IP allowlist NOT configured.

Scope: This tests one public Cloudflare ingress route, NOT an official guarantee
about every possible path. No sandbox checkout was performed.

After collecting the evidence, the temporary public diagnostic was replaced
with a static HTTP 410 function (`opps106-staging-ingress-check` v2), so
it no longer discloses even configuration presence booleans.

Outstanding: confirm genuine Quick Solution Café HTTPS return origin; safely
set `QUICK_SOLUTION_RETURN_ORIGIN`. After validating ingress contract,
configure `PAYFAST_TRUSTED_CLIENT_IP_HEADER`,
`PAYFAST_SOURCE_IP_GATEWAY_VERIFIED` and a verified PayFast sandbox IP
allowlist (do not blindly copy guessed ranges). Complete actual sandbox
checkout, ITN and payment ledger/invoice/OPPS visibility checks.

## 15 November 2026 — confirmed Café return origin

Operator supplied the customer storefront URL:
`https://cafe.jointx.co.za/products/pvc-banner`.

The correct payment return **origin** is:
`QUICK_SOLUTION_RETURN_ORIGIN=https://cafe.jointx.co.za`.

Do NOT include the product path. The checkout handler appends its own
`/?qs_payment=return&order=...` or `/?qs_payment=cancel&order=...`.
The host is supplied by the operator; an independent public fetch of the
specific product page did not complete, so test return routing in staging.

The Edge Function secret has **not** been changed via the connector. Set it
only for staging via the Supabase dashboard. Confirm that the root landing
page accepts payment-return query parameters and displays the correct order
status. Do not deploy the hardened checkout to production yet.

## 15 Nov 2026 — official PayFast notification source list

PayFast's developer documentation currently recommends allowing *all* of
the following source IPv4 networks/addresses for inbound ITN requests:

```text
197.97.145.144/28,41.74.179.192/27,102.216.36.0/28,102.216.36.128/28,144.126.193.139
```

Source: https://developers.payfast.co.za/documentation/ (Ports and IP addresses).
That list is published as PayFast server IPs, not explicitly a separate,
guaranteed sandbox-only list. Verify actual sandbox callbacks and keep the
allowlist current as PayFast publishes changes.

Given the Trinity 15 Nov gateway spoofing test, the remaining staging-only
settings to configure after source-IP contract review are:

```text
PAYFAST_SANDBOX_SOURCE_IPS=197.97.145.144/28,41.74.179.192/27,102.216.36.0/28,102.216.36.128/28,144.126.193.139
PAYFAST_SOURCE_IP_GATEWAY_VERIFIED=true
```

`PAYFAST_TRUSTED_CLIENT_IP_HEADER=cf-connecting-ip` was confirmed set by
operator, and `QUICK_SOLUTION_RETURN_ORIGIN=https://cafe.jointx.co.za`
was also confirmed set. Do not put `PAYFAST_SOURCE_IP_GATEWAY_VERIFIED=true`
into production based on one staging ingress test. If a real sandbox
notification's origin falls outside the published set, hold rather than
removing the gate or widening the list without PayFast confirmation.

## 15 November 2026 — dedicated sandbox checkout fixture

Created a staging-only service order (no customer email or phone):
- Order number: `QS-SBX-OPPS106-20261115104927`
- Order ID: `2847e6d5-d625-4c88-9b8f-fdc9926b287e`
- Amount: R350, one valid PayFast-eligible product item
- Customer: `OPPS106 Sandbox Test`
- Marked `source_metadata.opps106Sandbox=true`.
- Checkout-token value was **not** committed anywhere in GitHub.
- Token validity is three hours from creation (expiry 2026-11-15 13:49:27 UTC).
- The `commerce.qs_begin_payfast_payment` RPC returned `ok=true`
  and `alreadyPaid=false` for the fixture inside a rolled-back transaction.
- Canary checkout `quick-solution-payfast-opps106-test` updated to v6 to
  **refuse all non-sandbox payment URLs** regardless of environment changes.

Next: use the authenticated token in a client-side PowerShell POST to the
canary checkout, insist response `sandbox=true`, and open hosted PayFast.
Do not print or commit the token or signed payment URL. Once PayFast sandbox
reports success, read-only inspect this order's ledger and ITN logs to verify
that the R350 payment was captured exactly once.

The configured return origin is the **public Café website**. A staging-only
order may not appear there after redirect; rely on staging ledger verification,
not the browser redirect alone. Never mark paid from a return URL.

## 15 November 2026 — first real PayFast sandbox payment and failed ITN

The operator completed a R350 wallet-funded PayFast sandbox payment
successfully for order `QS-SBX-OPPS106-20261115104927`. PayFast returned
the customer to `https://cafe.jointx.co.za/?qs_payment=return&order=...`.
As expected, public Café cannot restore the session for the synthetic
staging-only order. The browser return is **not evidence of payment reconciliation**.

**Authoritative staging read:** `commerce.service_orders.payment_status=unpaid`,
one `commerce.service_order_payments` row `pending`, no `pf_payment_id`,
and no linked OPPS order. Do not mark this paid manually.

At 2026-11-15 11:02:23 UTC, real PayFast ITN reached the staging canary,
HTTP 403. Cloudflare/Supabase logs showed the actual client IP
`144.126.193.139` (inside the published PayFast allowlist).
Function log exact rejection: `[qs-itn] Invalid ITN signature`.
Therefore gateway/IP checks passed; signature check rejected the callback
before merchant/intent/PF postback checks.

PayFast docs specify PHP `urlencode` semantics in received parameter
order, with appended passphrase, not generic JS `encodeURIComponent`.
Source updated to escape `! ' ( ) * ~`, which JS ordinarily leaves bare,
and deployed to staging notification canary v7. Added non-secret
signature-mismatch diagnostics that log **only field names and duplicate count**.
This is a candidate compatibility fix, **not yet proven to resolve the rejected
ITN**, which arrived under v6. Never accept invalid signatures, spoof an ITN,
or manually create receipts to force a pass.

Next: request PayFast sandbox ITN resend for the same test transaction if
the dashboard provides it, or conduct a **new isolated sandbox checkout**.
Inspect v7 function logs and DB status to determine whether signature,
merchant, intent, PayFast server validation and ledger reconciliation all
pass. No production deployment until resolved.

## 15 November 2026 — sandbox retry prepared

- Official PayFast developer documentation states the **sandbox only sends
  each payment notification once**; do not assume that a 403 is retried
  in the sandbox.
- Updated signature parser to keep blank parameters in the signed sequence,
  in their received order; reject trailing fields after the signature.
  Together with the preceding PHP-compatible urlencode correction, this is
  notification canary **v8 (ACTIVE)**.
- New synthetic staging-only order:
  `QS-SBX-OPPS106-B-20261115110737`;
  `06e4bc70-ea4b-4ae0-83d6-44623fed9d5f`;
  R350, unpaid, one PayFast-eligible item, no real contact data.
  Token valid until 2026-11-15 14:07:37 UTC.
- Payment token intentionally **not stored in GitHub**.
- `commerce.qs_begin_payfast_payment` returned `ok=true`,
  `alreadyPaid=false`, R350 inside a transaction that was ROLLED BACK;
  the test has not yet initiated a permanent payment intent.
- Next: initiate hosted PayFast sandbox checkout on Trinity, then verify
  function_logs for canary v8, gateway ITN HTTP status, service order
  ledger and order status. Do not infer payment from return URL alone.

## 15 November 2026 — SECOND SANDBOX PAYMENT VERIFIED SUCCESSFULLY

Operator completed wallet-funded R350 sandbox payment for isolated staging
fixture `QS-SBX-OPPS106-B-20261115110737`, order ID
`06e4bc70-ea4b-4ae0-83d6-44623fed9d5f`.

**Authoritative read-only staging verification**
- PayFast ITN posted at `2026-11-15T11:09:12.461Z` to
  `quick-solution-payfast-notify-opps106-test` **v8**, HTTP **200**.
- The inbound `cf-connecting-ip` was `144.126.193.139`, an officially
  allowlisted PayFast IPv4 source.
- `commerce.service_orders.payment_status = paid`.
- Exactly **one** `commerce.service_order_payments` row `completed`:
  R350.00, provider PayFast, gateway reference `3519868`.
- No pending intent remains; prior session intent was `cancelled`.
- No duplicate completed receipt, completed amount sums to R350.00.
- The synthetic order has `opps_order_id = null`; no
  `commerce.service_order_handoffs` entry exists. The **OPPS order handoff
  has NOT been verified** and should not be claimed as working.
- Public Café return page could not restore the browser payment session
  because synthetic staging order was created outside the real public
  storefront. This is an expected cross-environment session mismatch, but
  **normal customer-flow return UX has NOT been tested**.

**Proven:** Hosted PayFast sandbox checkout → notification source/signature
verification → PayFast server validation/intent binding → one completed
staging receipt → order payment status paid. HTTP 200 is supported by the
database receipt; individual intermediate validations are inferred from
the fail-closed deployed handler rather than independently exposed.

**Not proven:** replay of an identical ITN via HTTP, normal-site session
restoration, Café-to-OPPS handoff / tracking, invoice-origin orders,
production readiness. Original staging functions and production remain
unchanged. Keep draft PR and do not claim end-to-end launch readiness.

## 15 November 2026 — follow-up: OPPS handoff and browser return architecture

Read-only live staging preview for paid synthetic order
`06e4bc70-ea4b-4ae0-83d6-44623fed9d5f`:
- `commerce.qs_build_opps_handoff_preview` returned
  `ready=false` with one blocker `NO_CUSTOMER_CONTACT`;
  its proposed OPPS order correctly has R350 total, R350 deposit paid,
  payment_status paid, item and Café collection shipping method.
- The test fixture intentionally has no real customer contact, so don't
  bypass the storefront customer contact requirement.
- `public.admin_send_quick_solution_order_to_opps` is a **staff-controlled**
  action; it creates a public.orders record, sends a handoff record and
  synchronizes the OPPS payment ledger only when preview is ready.
  The fact that no `opps_order_id` exists on our synthetic fixture is
  therefore consistent with intended manual handoff, not evidence that
  gateway capture failed.
- No staff send performed; no synthetic OPPS order created.

Connected GitHub repo `jointxco-hub/quick-solution-cafe` source inspection:
- `src/components/OrderBasket.jsx` and `GuidedOrder.jsx` save
  a payment session in browser localStorage **before** redirecting to PayFast.
- `src/components/PaymentReturn.jsx` reads that session by order ID,
  polls `getQuickSolutionPaymentStatus` and never marks paid itself.
- PowerShell canary initiation bypasses session storage entirely.
  Consequently the warning `We can't verify this browser session` in
  the synthetic test is expected, not a demonstrated normal-store bug.
- The current frontend `src/lib/supabaseApi.js` calls the **standard**
  `quick-solution-payfast` function slug, not our
  `quick-solution-payfast-opps106-test` canary.
  Do NOT use the staging storefront browser to declare the hardened
  canary flow tested until it points to the canary.

Vercel project discovered:
- Project `quick-solution-cafe-staging`,
  ID `prj_3VFMOuqcIm0tgwZKNfuk1q0ZBlds`.
- Its preview `VITE_SUPABASE_URL` targets staging
  `tijiamrfnxrbitafiflj` (checked project settings).
- Recent preview is `https://quick-solution-cafe-staging-k4gtl55sb-joint-x.vercel.app`
  (READY), but the project enforces SSO on preview URLs.
- **Critical environment mismatch:** staging PayFast checkout return origin
  is `https://cafe.jointx.co.za`. Starting a checkout on any
  `vercel.app` staging preview while returning to the public Cafe host
  will NOT restore the same origin-scoped localStorage session.
- Before a valid normal-browser sandbox test, pin a stable staging preview
  URL that the tester can access, point the staging Edge Function return
  origin to its exact HTTPS origin, and route the staging UI's payment API
  to the hardened canary checkout. Ensure both changes cannot affect
  the real Café site. Then place an ordinary *staging-only* customer order
  with standard contact and test staff handoff from an authenticated
  staging Café admin.
- Production remains untouched; this step was research/read-only.

## 15 November 2026 — staging browser flow deployed, production unchanged

Created isolated GitHub branch
`jointxco-hub/quick-solution-cafe:feature/opps106-sandbox-browser-check`
based on previously deployed staging feature branch
`feature/qr-payment-eligibility-106`.

- `src/lib/payfastCanaryRoute.js` resolves browser payments to
  `quick-solution-payfast-browser-opps106-test` **only** when both
  hostname belongs to the `quick-solution-cafe-staging*.vercel.app`
  Vercel staging preview family AND backend hostname equals
  `tijiamrfnxrbitafiflj.supabase.co`. Otherwise always standard slug.
- Both checkout init and status calls use the same selected endpoint.
- Added `tests/opps106-sandbox-browser-route.test.mjs` covering staging,
  public Café host, wrong Supabase backend and unrelated domains.
- A brand-new staging-only checkout function
  `quick-solution-payfast-browser-opps106-test` v1 ACTIVE is a clone
  of the tested hardened checkout, with enforced `PAYFAST_SANDBOX=true`,
  a fixed HTTPS return origin of
  `https://quick-solution-cafe-staging-git-feature-opps106-d3a1f2-joint-x.vercel.app`,
  no caller-derived return URL, and notify endpoint
  `quick-solution-payfast-notify-opps106-test` v8.
- Vercel preview was built from commit
  `bbd59fd01f84184eb3e2b52b95a539c12dbc0f22`,
  deployment `dpl_8rAC5LZSkxYWFgMcKFapvgyuu1X2`, READY.
- Stable branch preview URL:
  `https://quick-solution-cafe-staging-git-feature-opps106-d3a1f2-joint-x.vercel.app`.
- The staging Vercel preview `VITE_SUPABASE_URL` was verified to
  target the correct staging Supabase project. Preview is Vercel
  SSO-protected; tester must be allowed to open it.
- The shared staging Edge Function return origin was **not changed**;
  the dedicated browser-test checkout pins its own return origin.
- No production deployment, public domain remapping or data mutation.
- Regression tests added but no full `node --test` run observed;
  Vercel Vite build completed successfully, which is not the test suite.

Next manual browser checkpoint: open the stable staging branch URL while
signed into permitted Vercel account, create a brand-new legitimate
**staging** customer order through cart/guided ordering with proper
contact information, pay using **PayFast sandbox wallet only**, and verify
same-domain return, browser polling and tracking. The storefront should
set the payment session itself, unlike the earlier PowerShell test.
Then sign into the staging Café admin to PREVIEW and SEND the order to
OPPS; verify exactly one OPPS order and matching finance ledger with
read-only queries. Do not reuse the contactless synthetic orders.

## 15 November 2026 — genuine staging browser return and handoff readiness PASS

Operator provided payment-confirmed screenshot for normal staging storefront
order `QS-261115-1E4A` (not PowerShell).
Staging database read validated:
- order ID `2adcec55-997f-487b-afd5-f1d09a469567`, storefront channel;
- `payment_status=paid`, total R350, one completed R350 PayFast receipt
  provider ref `3520004`, prior pending intent cancelled;
- browser return showed the same order number, R350, Paid;
- legitimate contact exists on the order;
- `commerce.qs_build_opps_handoff_preview` returned `ready=true`,
  **no blockers, no warnings**. Its proposed OPPS order maps R350
  total and deposit paid, item specification, and Café collection;
- one service-order tracking token exists (its actual use via
  public tracking page is not yet verified);
- as of verification, **no OPPS order** exists for this storefront
  reference and **no staff handoff row** exists. This is expected
  while the authenticated staff send action has not been performed.

The next controlled test is a staff sign-in to staging Café admin,
preview the order, then explicitly send it to OPPS. Never call the staff
function from the privileged database connection to bypass staff auth.
After handoff check `commerce.service_orders.opps_order_id`,
`commerce.service_order_handoffs.status='sent'`,
`public.orders.payment_status='paid'`,
and exactly one synced `public.transactions` completed receipt.
Do not reuse an existing order number, invent payment rows or move to prod.

## 15 November 2026 — real browser test: authenticated Café → OPPS handoff PASS

Operator confirmed using the Café staging staff action to send normal
customer-browser order `QS-261115-1E4A` to OPPS.

**Authoritative staging query evidence:**
- Café service order `2adcec55-997f-487b-afd5-f1d09a469567`:
  `status=accepted`, `payment_status=paid`, `total_amount=350`.
- `commerce.service_order_handoffs`: `status=sent`,
  `sent_at=2026-11-15 13:25:27.451242+00`,
  `opps_order_id=2e142934-7fb8-4929-82b1-575dc6d7292e`,
  `blockers=[]`, `warnings=[]`.
- Linked `public.orders` row has same order number, source
  `quick_solution`, status `confirmed`, payment_status `paid`,
  `total_amount=350`, `deposit_paid=350`,
  fulfillment `collection`, and correct service-order backlink.
- Exactly **one** OPPS order exists for this number and tenant.
- Exactly **one** completed Café PayFast receipt R350, plus one cancelled
  pending intent. The cancelled intent is NOT a completed receipt.
- Exactly **one** completed OPPS `public.transactions` income row for R350,
  linked to the service order and OPPS order. No duplicate completed
  finance transaction. Important: staging finance row presently
  `is_test=false` and `excluded_from_reports=false`; **do not
  use this staging transaction in real reporting**.
- `commerce.qs_customer_payment_snapshot` returned:
  `cafePaid=350`, `oppsPaid=350`, `balanceDue=0`,
  `issues=[]`, `reviewRequired=false`.
- One service-order tracking token exists (expires
  2027-05-14 13:21:39 UTC), but the customer-visible tracking page
  has **not yet been explicitly tested**.
- `public.opps_invoices`: zero linked nonvoid invoices for this
  storefront order. Invoice-origin order projection remains a separate
  outstanding workflow.

**PASS:** Normal staging browser → signed PayFast ITN → Café paid
→ authorized staff handoff → one OPPS order + one finance ledger entry,
all reconciled.

**Still NOT fully certified:** customer-visible tracking transitions;
invoice-origin quote → invoice → order path; PayFast HTTP replay, negative
cases and production release review. Keep prod unchanged, PR draft.

## 15 November 2026 — customer tracking UI verification and browser fallback

Customer screenshot: staging public tracking form for `QS-261115-1E4A`
with the matching checkout phone displayed
`+27671176230` returned
`We could not verify that order` (frontend received null/falsy
tracking response; exact HTTP response was not captured).

Read-only staging diagnosis:
- SQL `public.qs_normalize_sa_phone('+27671176230')` equals the
  normalized phone on the order (`0671176230`).
- `public.get_quick_solution_tracking('QS-261115-1E4A',null,
  '+27671176230')` returns the order.
- Same RPC in a `SET LOCAL ROLE anon` transaction returns order
  `QS-261115-1E4A`, current stage `Preparing your order`.
- `anon` and `authenticated` both have execute privilege.
- This is **not a proven database contact-matching bug**. The
  browser API/response path remains an unresolved discrepancy.
- No corresponding request log could be located with available log
  queries; do not speculate about its HTTP status.
- The earlier synthetic PayFast staging payment and OPPS handoff
  remain paid and reconciled.

Staging-only UX safeguard in
`jointxco-hub/quick-solution-cafe:feature/opps106-sandbox-browser-check`:
- Added `findQuickSolutionTrackingSessionByOrderNumber` in
  `src/lib/trackingSession.js` to read *existing* first-party localStorage
  token for matching order, rejecting expired/malformed sessions.
- When a manually entered tracking contact lookup returns no order,
  `TrackOrder.jsx` attempts a second RPC only when the same browser
  already holds a valid saved tracking token. Database token hash
  verification is still mandatory; no public authorization was weakened.
- Added `tests/opps106-tracking-session-fallback.test.mjs`.
- Branch commit `51dc975643102e1ddd2df619f4a03a7b6a022caf`
  preview deployment `dpl_9EqCiYtPHUEBy6B9YZ9M86o7yV6q`
  shows **READY**. Full Node test suite not executed by assistant.
- Stable preview URL remains
  `https://quick-solution-cafe-staging-git-feature-opps106-d3a1f2-joint-x.vercel.app`.

Retest on original staging checkout browser; if manual contact
lookup still fails, collect browser DevTools Network status and
JSON error from `/rest/v1/rpc/get_quick_solution_tracking`
(redact credential headers and any session tokens).
Do not release production until direct contact lookup cause is
resolved, not merely masked by the saved-token fallback.

## 15 Nov 2026 — tracking timeline layout fix and remaining QR sequence

The customer screenshot verified real staging tracking at stage 'Preparing your order',
paid R350, correct product and Café collection; five-step collection timeline
rendered the 'Complete' step on a wrapped second row because
`src/styles/qs09.css` hard-coded `repeat(4,1fr)`.

Fixed in isolated Quick Solution Café branch
`feature/opps106-sandbox-browser-check`:
- `TrackOrder.jsx` sets `--tracking-step-count` to the actual backend
  timeline length.
- `qs09.css` uses `repeat(var(--tracking-step-count, 4),minmax(0,1fr))`
  and aligns progress rail to step centres; mobile inherits the same count.
- Added static test `tests/opps106-tracking-layout.test.mjs`.
- Vercel staging preview deployment from commit
  `e8ca8002b207cdb9d6787b039dae4897594aecd4` is READY on
  `https://quick-solution-cafe-staging-git-feature-opps106-d3a1f2-joint-x.vercel.app`.
- Responsive visual QA and full Node test suite not yet completed.

**Next staged workflow:** (1) verify invoice-origin quote → approved/paid
invoice → OPPS order projection (prior SQL migration rollback tests passed,
but this full customer path has not); (2) QR-specific customer/counter
payment-request generation, scanned QR, token expiry, settlement
correlation and replay, and notifications/work queue; (3) staging safety,
role/RLS, security regression and production review.

The prior PayFast storefront test already verifies gateway wallet checkout,
signed ITN, staging ledger, staff handoff, and tracking. This is NOT yet proof
the QR-specific payment request adapter and scanner path work.
