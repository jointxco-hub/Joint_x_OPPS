# OPPS-106 — live PayFast candidate deployment and acceptance

**Status:** candidate implemented on feature branch; **NOT DEPLOYED / NOT APPROVED**.
This work is deliberately separate from the existing staging sandbox callbacks.
Do not copy staging migrations to production or toggle issuance controls.

## New, isolated source

- `supabase/functions/_shared/payfastGatewayProfile.js`: fail-closed private profile selector.
- `supabase/functions/quick-solution-qr-opps106-live-scan/index.ts`: future live scanner. Signs a live PayFast checkout URL from server-locked order intent; never uses the sandbox process URL.
- `supabase/functions/quick-solution-qr-opps106-live-notify/index.ts`: future live ITN handler. Requires configured live source-IP policy, signature/merchant/remote PayFast `VALID`, exact persisted checkout identity and live environment. Mismatch quarantines, never credits.
- `supabase/production-candidate/opps106_live_gateway_rpcs_REVIEW_ONLY.sql`: private disabled-by-default merchant policy; distinct live issuer/settlement/noncomplete RPCs; provenance evidence constraint extended for real live captures. **Not auto-applied.**
- `tests/issue-106-live-gateway-profile.test.mjs` and `tests/issue-106-live-candidate-isolation.test.mjs` protect separation and deny unsafe fallback.
- Disposable PostgreSQL CI additionally parses the candidate SQL; this does **not** prove end-to-end settlement semantics.

## Server-only environment contract

**Never put the following in Vite `VITE_*` variables, public Pages, or customer URLs.**
A dedicated live project or callback deployment must supply:
- `PAYFAST_SANDBOX=false`; `OPPS106_QR_MODE=live`.
- `PAYFAST_MERCHANT_ID`, `PAYFAST_MERCHANT_KEY`, `PAYFAST_PASSPHRASE` — live account credentials only.
- `OPPS106_LIVE_MERCHANT_ID` — independently approved live merchant ID, equal to configured PayFast merchant ID.
- `OPPS106_SANDBOX_MERCHANT_ID` — known sandbox merchant ID; must differ from live.
- `OPPS106_LIVE_GATEWAY_APPROVED=true` **and** `OPPS106_LIVE_CALLBACK_ENABLED=true` — explicit, controlled release approvals (both default absent/false).
- `OPPS106_LIVE_RETURN_BASE` — reviewed own HTTPS OPPS return/cancel origin; never an ephemeral Vercel preview URL.
- `OPPS106_LIVE_NOTIFY_URL` — reviewed HTTPS endpoint with the exact path `/functions/v1/quick-solution-qr-opps106-live-notify`.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` — server secret config for the **approved** project.
- `PAYFAST_SOURCE_IP_GATEWAY_VERIFIED=true`, `PAYFAST_TRUSTED_CLIENT_IP_HEADER` and maintained `PAYFAST_LIVE_SOURCE_IPS` — only after validating that the ingress proxy strips any client-supplied matching header and injects the authentic single-hop source. No trusted proxy configuration = **reject all ITNs**.

These are *requirements*, not values currently configured or verified.

## Required independent release controls

1. Review the production database migration and use a transactional release with backups and rollback plan. The private `qr_payments.live_gateway_policy` begins `enabled=false`; the existing `qr_payments.issuance_controls` remains OFF.
2. Review secrets, project isolation, merchant ID, callback domain, PayFast merchant settings and HTTPS proxy ingress.
3. Deploy the live candidate to a separately named Edge route with authorization and policy guards. **Never overwrite** `quick-solution-qr-opps106-notify` / `quick-solution-qr-opps106-scan` sandbox functions.
4. Run signed live-mode ITN integration tests against a disposable/payment-safe fixture before enabling any live issuance. Include merchant mismatch, live/sandbox reversal, replay, duplicate gateway ID, unmatched capture, legacy QR, late ITN, failed PayFast VALID and Cash/Card race. Test full OPPS/Finance reporting classification.
5. Confirm the iMin D4 physical receipt printing and new-sale reset when available; confirm latest OPPS review UI deployed as READY.
6. Obtain explicit business release approval. Only then consider enabling the live policy and targeted QR issuer switch, initially for a single reviewed order and amount.
7. **Stopping new QR issuance is not payment rollback.** Previously opened PayFast checkouts can notify late; keep the trusted live notification handler operational to reconcile or quarantine valid provider captures. Never disable the callback solely because the issuer switch was disabled.
8. Provider terminal no-capture proof is unresolved. Staff evidence alone, absent ITN, and QR expiry are not sufficient to release a Cash/Card hold.

## Known limitations and boundaries

- The separate live candidates are code and a proposed SQL contract; there has been **no live checkout, no live ITN test, no live key onboarding, and no production deployment**.
- A successful SQL parse is not equivalent to integrated money movement or security certification. Full database behavior, RLS, merchant portal validation, incident/replay drills and production migration review remain required.
- Historical sandbox R60/R72 and unresolved R120 records remain untouched. Production and both QR issuer switches remain unchanged.
- PayFast's published live process and validation endpoints are `https://www.payfast.co.za/eng/process` and `https://www.payfast.co.za/eng/query/validate`; sandbox uses `sandbox.payfast.co.za`. See https://developers.payfast.co.za/docs/itn-instant-transaction-notification/ .

## 20 November — disposable live settlement integration test

Added `tests/fixtures/opps106-live-database-behavior.sql` to the existing isolated PostgreSQL CI job, running **the actual proposed live RPCs**, not just checking that SQL parses. Run #44729669417 passed all three OPPS-106 jobs (QR security, PostgreSQL race + live behavior, OPPS build).

**Verified within a disposable database with synthetic provider data:**
- Live issuer refuses the disabled private merchant policy (no real QR issued).
- Merchant mismatch records a `GATEWAY_PROVENANCE_MISMATCH` exception, and repeated delivery does not duplicate it.
- A simulated payment cannot create a receipt when the test gateway projection refuses it.
- An already-bound cancelled checkout can be closed even while new live issuance is disabled.
- With a **mock canonical payment projector**, one synthetic COMPLETE produces one completed receipt and a settled QR with `payfast_itn_validated_live` evidence; repeating it returns `replayed`, and a different provider ID creates an `ADDITIONAL_CAPTURE` exception without a second receipt.

**Critical accounting release gate found:** the current **staging-only** `commerce.qs_project_manual_receipt` classifies PayFast QR receipts as sandbox when their `raw_itn.m_payment_id` begins with `JXQR-` and `custom_str4='cafe_order'`. A real live payment uses this same reference shape, so this heuristic **must never be promoted to production**. The production projector must join the exact QR checkout/receipt to server-verified `gateway_environment` and `gateway_environment_evidence` under canonical tenant and payment identity. Sandbox captures must be marked test/excluded; verified live captures must not automatically set test/excluded, and any existing operator QA flags must be preserved unless separately audited. Confirm OPPS order, transaction and invoice receipts each link exactly once and classify correctly.

These results are **not** proof of a real live PayFast interaction. The candidate has not been deployed, no live merchant keys are connected, provider remote `VALID` has not been tested against a live capture, and production accounting projection is not approved. Keep issuer switches OFF and PR DRAFT.

## 20 November — verified Finance and OPPS-order classification candidate

**Implementation, not deployment.** Added `supabase/production-candidate/opps106_verified_finance_projector_REVIEW_ONLY.sql` to the draft branch. It replaces the staging-only `JXQR-` sandbox heuristic with an exact join between the completed PayFast Café receipt and one settled QR request, matched by tenant, Café order ID, amount in cents, PayFast payment ID, original `JXQR-<request UUID>` reference, gateway environment and evidence. Live additionally requires matching server-bound merchant and checkout contract. Missing/ambiguous evidence raises `QR_GATEWAY_ENVIRONMENT_REVIEW_REQUIRED` instead of classifying a payment as revenue.

The live candidate settlement RPC now retries `commerce.qs_project_manual_receipt` after stamping the verified settled QR and preserves a `paymentProjectionReview` audit flag if a separate Finance issue remains. This is intentionally after the canonical payment capture, because `commerce.qs_apply_payfast_payment` catches projection errors to avoid discarding a provider-confirmed receipt.

**Finance and OPPS classification policy:**
- Verified sandbox QR: `payment_environment=sandbox` on OPPS order, PayFast reference linked, `is_test=true` and `excluded_from_reports=true` on Finance and OPPS.
- Verified live QR: `payment_environment=live` on OPPS order, exact PayFast reference, new Finance revenue **not** automatically excluded. Independent staff-set test/exclusion flags remain intact on already existing records.
- Unverified QR prefix alone, non-settled QR, mismatched merchant/payment identity, duplicate or ambiguous QR evidence: no verified Finance classification; escalate for provider/ledger reconciliation.
- The Finance candidate is review-only and has not been applied to Supabase staging or production. Legacy staging settled R60/R72 remain untouched.

**Disposable PostgreSQL tests:** `tests/fixtures/opps106-finance-provenance-behavior.sql` and `tests/fixtures/opps106-opps-handoff-classification.sql` run after the live gateway candidate and synthetic provider settlement fixture. They verify live Finance inclusion, sandbox exclusion, unverified prefix rejection, QA flag preservation, OPPS order environment/reference classification and safe treatment of unresolved QR payments. **GitHub Actions #44737337388 passed all three jobs** (QR security, PostgreSQL concurrency/migration/Finance/OPPS behavior, OPPS build).

**Unverified release dependencies:** integration with real PayFast live VALID and merchant credentials, production migration security review, PayFast-to-Finance end-to-end replay and exception drill, current Vercel preview, and physical iMin D4 receipt printing. Keep both QR switches OFF, live SQL undeployed, PR draft.
