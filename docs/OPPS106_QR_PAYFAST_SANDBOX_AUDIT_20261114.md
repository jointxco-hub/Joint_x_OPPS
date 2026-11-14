# OPPS-106 · Café PayFast QR checkout audit (14 Nov 2026)

Staging Supabase project: `tijiamrfnxrbitafiflj`.
**No real or sandbox payment was initiated during this audit.**

## Deployment discovery

The following currently run in staging:
- Edge Function `quick-solution-payfast`, version 12, verify_jwt=false.
- Edge Function `quick-solution-payfast-notify`, version 8, verify_jwt=false.
- SQL RPC `qs_begin_quick_solution_payment` -> `commerce.qs_begin_payfast_payment`.
- SQL RPC `qs_apply_quick_solution_payfast_payment` -> `commerce.qs_apply_payfast_payment`.

The checkout function constructs a signed PayFast URL from the server-derived
order amount, and uses the sandbox hostname when `PAYFAST_SANDBOX=true`.
The notification function sends the ITN body to PayFast's validation endpoint
and only invokes the payment RPC after response `VALID`.
The SQL reconciler compares notified gross amount against the order total
and rejects reuse of provider payment IDs across orders.

## Actual safe test completed

Against existing staging service order `QS-261022-AFEE`, an intentionally
invalid payment token returned `{ok:false,reason:"not_available"}`
for both begin-payment and status RPCs.
There were no pending intents created as a result. Test ran in SQL
`BEGIN...ROLLBACK`.

## Before calling this secure / end-to-end complete

1. **ITN hardening:** Current notification handler does not explicitly check
   locally calculated ITN signature, `merchant_id` against configured
   PayFast merchant, or trusted source IP. PayFast documentation requires
   signature, IP, amount and data-validation checks. The remote `VALID`
   round-trip should remain; it is NOT a substitute for reviewing each
   required check and trusting a verified source address through the edge
   proxy. Payment ID and merchant order reference also need explicit
   transaction-intent correlation.
2. **Return origin:** `safeOrigin(req)` currently accepts any HTTPS Origin
   supplied by a caller. The customer return/cancel URLs should use a
   configured, explicit allowlist of genuine Café origins; do not trust
   attacker-controlled Origin headers.
3. **Sandbox mode:** Deployed code has `PAYFAST_SANDBOX || 'true'`; deployment
   source alone cannot prove actual staging secrets or merchant credentials.
   Confirm `PAYFAST_SANDBOX=true`, sandbox merchant ID/key, passphrase,
   and notify URL before a checkout.
4. **Wallet checkout vs counter QR:** The current function returns a
   signed hosted-checkout URL. A QR that encodes this URL still needs a
   public payment page and a user-facing QR renderer. Verify the actual
   Café UI exposes the correct order-specific link, without exposing
   payment tokens in logs or analytics.
5. **Positive sandbox test:** With a dedicated staging order and controlled
   sandbox merchant account, complete a sandbox payment using a browser,
   validate ITN and Finance/Café/OPPS projections, then replay the same ITN
   to prove idempotence. Check rejected amounts, wrong merchant IDs,
   mismatched intent IDs and invalid signatures.
6. **Tracking:** Confirm the public tracking hostname is authorized for
   the relevant tenant and that scanning/returning from checkout displays
   the correct order without exposing another tenant's data.

References:
- https://developers.payfast.co.za/docs/itn-instant-transaction-notification/
- https://payfast.io/integration/submit-your-solution/
- https://supabase.com/docs/guides/functions/secrets

**Release gate: NOT READY for production / real charges.**
