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
