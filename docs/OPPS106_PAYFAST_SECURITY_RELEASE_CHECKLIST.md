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
