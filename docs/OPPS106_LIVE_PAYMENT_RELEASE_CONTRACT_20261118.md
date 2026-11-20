# OPPS-106 — live QR settlement contract and release gates

**Decision (18 Nov 2026): NOT RELEASED.** This document records the production contract; it does not grant approval to enable production QR. Existing staging `PAYFAST_SANDBOX=true` callback and the `sandbox_only_verified_itn` database evidence remain sandbox-only.

## Authority and lifecycle

1. The **server**, never the browser, selects an explicit configured environment (`sandbox` or `live`) for the issuing payment endpoint. Staging and production credentials, PayFast merchant IDs, secrets, trusted callbacks and return URLs must be separated, scoped, and independently verified.
2. During QR **issuance**, persist the environment and a server-owned checkout-intent ID, merchant fingerprint/identifier (no secret), tenant, canonical order, exact amount in cents, currency and callback contract version. A live URL must never be issued by a sandbox-only route; the environment must not be inferred from `JXQR-` or the customer's return URL.
3. On PayFast **ITN**, enforce the current full verification chain **before** privileged settlement: trusted proxy and source-IP policy, canonical form/duplicate-field rejection, signature/passphrase, matching merchant ID, immutable QR intent/tenant/order IDs, exact amount and reference, and PayFast server-to-server `VALID` from the endpoint corresponding to the configured environment. A signed request alone is insufficient.
4. Check that the server-configured **callback environment and merchant identity equal the persisted checkout-intent environment/merchant**. Do so under the same canonical order/QR locks used for settlement. Missing/mismatched provenance must fail closed to a durable review/exception record; no paid receipt should be projected.
5. Persist an immutable **verified environment** only on successful matched settlement, with an explicit evidence/source enum such as `payfast_itn_validated_sandbox` / `payfast_itn_validated_live`, backed by server-controlled callback configuration. The current `sandbox_only_verified_itn` evidence is intentionally staging-specific. Do not accept `environment` or evidence strings from browser parameters or arbitrary RPC callers.
6. In one transaction: deduplicate by gateway payment ID and QR request; write the canonical Café receipt; mark the QR settled; project the matching OPPS order and a single Finance entry. For sandbox: `is_test=true`, `excluded_from_reports=true`, `payment_environment=sandbox`. For live: do **not** auto-classify on prefix—use proven live environment and the existing business/test flags. Do not overwrite an operator's independent QA/reporting exclusion without review.
7. Repeat COMPLETE/ITN returns `replayed` without a second receipt, transaction or activity event. Late/different provider capture goes to a **review queue**—no second payment and no automatic clearing based solely on QR expiry.
8. A failed or cancelled browser return is **not** proof that provider settlement cannot arrive. Manual Cash/Card is held after QR checkout starts until a dedicated staff-reviewed, audited provider reconciliation establishes terminal no-capture or resolves actual payment. No release RPC exists yet.

## Pre-merge acceptance matrix

| Scenario | Expected |
|---|---|
| Sandbox checkout, validated sandbox ITN | One paid receipt, excluded test Finance and OPPS order |
| Valid live checkout, validated live ITN | One live receipt, correctly reported and linked to OPPS |
| Sandbox callback against live intent, or vice versa | Reject and review; no paid receipt |
| Wrong merchant, amount, tenant, order, QR intent, or PayFast payment ID | Reject/review |
| Header spoof, failed signature or PayFast remote validation | No receipt; appropriate reject/retry |
| Same COMPLETE delivered twice | One receipt and Finance row |
| Different COMPLETE ID on settled QR | Exception, not another receipt |
| QR/Manual and two manual devices | Canonical order lock; no double payment |
| Started checkout expires with no ITN | Hold remains until provider-confirmed reconciliation |
| iMin D4 print and Next sale | Physical acceptance pending; does not block offline review, **does block go-live** |

## What is currently true

- **Staging callback**: `supabase/functions/quick-solution-qr-opps106-notify/index.ts` explicitly rejects live mode.
- **Staging SQL**: `supabase/staging-only/20261118_opps106_gateway_environment_provenance.sql` currently writes only `sandbox` / `sandbox_only_verified_itn`.
- **Staging settled R60 and R72** are documented, correctly classified and excluded; QR issuance switches both OFF.
- Real two-session PostgreSQL Counter/QR races and Café regression suite have passed. Those are not substitutes for a **live-mode** gateway-verification test.
- There is a staff-only read-only review queue; there is **no** automatic release or audited no-capture override.
- iMin D4 thermal receipt printing is not yet tested on the physical device.
- New OPPS review UI is committed but Vercel preview deployment is currently blocked by the daily deployment quota. This does not alter the database/CI results.

## Release discipline

Keep staging-only SQL under `supabase/staging-only/`; do not copy it as a production migration. Require reviewed production-shape migration, gateway environment and merchant attestation, security tests, OPPS reporting checks, a staff-approved exception resolution process, physical POS acceptance, ready preview, and explicit deployment approval. Do not flip either `qr_payments.issuance_controls` switch as an incidental test step.


## 18 November follow-up: isolated contract code (not wired to settlement)

Added `src/server/cafeQr/gatewayEnvironmentContract.js` with `resolveVerifiedPayfastEnvironment` and `tests/issue-106-gateway-environment-contract.test.mjs`.

- Pure fail-closed resolver checks an explicit backend-configured environment and merchant against server-persisted checkout intent identity, and against already-verified PayFast callback identity, amount, source, signature and remote validation booleans.
- Returns explicit `payfast_itn_validated_sandbox` or `payfast_itn_validated_live` evidence only after all checks match.
- Sandbox returns a force-test/exclusion reporting directive. Live returns `reporting: null`, deliberately preserving any independent staff-set QA/exclusion choices.
- No actual callback integration, database write, deployment or production payment authorization is performed by this pure helper. It does not replace PayFast verification; its `verifiedCallback` argument **must** be constructed only after real trusted ITN verification, never directly from raw request fields.
- CI also locks the existing sandbox-only live-mode refusal until a reviewed production implementation exists.

## 18 November — staging checkout/callback integration (implemented)

The sandbox-only real scanner/notification paths are now bound to persisted checkout identity:
- `opps106_staging_bound_checkout_identity` migration added `qr_payments.payment_requests.checkout_environment`, `checkout_merchant_id`, `checkout_gateway_reference`, `checkout_contract_version`. The original unsafe one-argument checkout RPC now fails closed; the new service-role-only `qs_opps106_start_counter_qr_checkout_verified` writes the record atomically on checkout.
- Staging scanner Edge Function **v7** reads PayFast mode/merchant from private server environment and passes it to the bound checkout RPC; it still refuses non-sandbox mode.
- Staging PayFast notification Edge Function **v5** verifies source, signature, merchant and PayFast remote VALID, then reads the server-issued checkout identity and invokes the shared `resolveVerifiedPayfastEnvironment` contract. The SQL settlement also requires matching persisted merchant, payment reference and contract version before a new receipt.
- `opps106_staging_verified_capture_quarantine` added service-role-only, durable exceptions for independently verified but mismatched/legacy captures; no payment is credited on mismatch.
- Historical R60/R72 settled requests and one older unresolved checkout were intentionally **not backfilled** with guessed checkout provenance. A verified late COMPLETE for the old unbound checkout is held for Finance review, not falsely marked paid.
- Both QR issuance switches OFF. This is not an implementation of live PayFast settlement. Production gateway attestation, migration review, end-to-end live/sandbox integration tests and iMin acceptance remain open.

These changes have passed QR contract and disposable two-session PostgreSQL CI. A browser preview of the updated staff UI remains blocked by the Vercel daily deployment allowance.
