# Issue #106 — Isolated QR lifecycle adapter gate (9 Nov 2026)

**Implementation**: `src/server/cafeQr/paymentRequestLifecycle.js`
**Tests**: `tests/issue-106-qr-lifecycle.test.mjs`
**Exposure**: none. No route imports this module; it does not call Supabase or PayFast itself, and it does not change production or staging.

## Scope implemented
Server-side state transitions in a dependency-injected module for saved `cafe_order` or `opps_invoice` targets:
- Validates target and idempotency key, checks current staff access through an injected authorization adapter.
- Uses a canonical server-side balance under a required lock; never accepts a browser amount.
- One active request per target; concurrent callers reuse that request.
- Same operation key returns the same active request, but cannot be reused after expiry or balance change.
- Expired and changed-balance requests cannot be displayed as payable by the status function.
- Verified settlement triggers a canonical receipt adapter once; repeated gateway reference is a replay.
- Changed-balance, expired, or additional captures are recorded as reconciliation exceptions rather than silently counted or discarded.

A local in-memory transactional harness exercised these transitions and passed 9 isolated cases before repo publishing. The committed test file covers 8 grouped cases; **GitHub CI has not yet been run on the committed source**.

## Critical integration contracts / not yet implemented

1. **Durable atomic store**: implement a private schema/table + SQL transaction boundaries, unique operation key per target, and one-active-request exclusion. The injected `withTargetLock` currently has no database adapter. An in-memory mutex is test-only and is unsafe across Edge Function workers.
2. **Real authorization**: derive tenant and staff permission from validated identity. The `authorize` adapter is a placeholder. Check authorization under the database transaction, not only before it.
3. **Gateway checkout binding**: `issueCheckout` is injected; it needs the production-approved PayFast signature generator, fixed merchant/notify URL, request ID correlation and a validated return origin. Never expose secrets or accept client amount.
4. **Reliable external checkout creation**: placing non-transactional gateway side effects inside a DB lock is unsafe without a bounded reservation/outbox/recovery design. PayFast's URL signing itself may be pure, but confirm this before implementation.
5. **Verified webhook only**: a JavaScript object containing `verified: true` is not proof. Only the existing deployed PayFast handler may construct it *after* full signature, merchant, order/request ID and amount checks. Do not expose `recordVerifiedSettlement` as a browser endpoint.
6. **Canonical receipt transaction**: `applyCanonicalReceipt` is injected, not implemented. Existing Café and invoice PayFast writers have different RPCs. Reconcile within the same durable transaction or use a properly designed idempotent staging/outbox saga; simply nesting an external RPC call does not guarantee atomicity.
7. **Expired QR does not revoke an already-signed PayFast URL**: customer may have opened it. Any genuine captured funds arriving later must be logged as exceptions and reconciled/refunded through established finance controls. Never drop or misrepresent captured money.
8. **Request expiry isn't provider-side invalidation**: enforce at request resolution/server callback and explain that a user who has an already-open checkout may still complete it; confirm PayFast provider-supported expiry/cancellation separately.
9. **Tenant scope**: keys and unique constraints must include tenant, target type/id, operation key and gateway reference.
10. **Validation**: committed test suite execution, isolated Postgres concurrency tests, webhook forgery/replay, amount-change race, device testing and staging smoke test required before release.

## Prior live discovery
- Production Café flow: `quick-solution-payfast` v2 and routed `payfast-notify` v62, using `qs_apply_quick_solution_payment`.
- Staging Café flow: `quick-solution-payfast` v12 and dedicated `quick-solution-payfast-notify` v8, using `qs_apply_quick_solution_payfast_payment`.
- Staging already contains `qs_cafe_list_work_queue`; production does not.
- No payment operations or schema writes were performed during this implementation.

**Next action:** design and implement the durable Postgres adapter in a local disposable database with strict auth and ledger boundaries, before any Edge Function or UI wiring. Do not deploy this module as a payment service by itself.

## 9 November follow-up — private PostgreSQL adapter added

Committed:
- `docs/ISSUE_106_QR_PRIVATE_SCHEMA_DRAFT.sql` — private tables for requests and reconciliation exceptions; unique indexes for one active request and provider payment reference; no direct public/authenticated table access.
- `src/server/cafeQr/pgPaymentRequestStore.js` — injected PostgreSQL client transaction wrapper using advisory transaction locks, bound SQL parameters, commit/rollback, and pluggable canonical payable lookup.
- `tests/issue-106-pg-qr-store.test.mjs` — committed mock-DB regression cases.

**Verification actually performed:** 9 JavaScript adapter smoke/textual-schema checks were executed using the exact GitHub source. Verified BEGIN/advisory lock, parameter binding, COMMIT, ROLLBACK, connection release, exception insert conflict behavior, private schema/RLS and unique-active index declaration. **These do NOT constitute a PostgreSQL SQL migration run or a successful PayFast sandbox payment.** The committed Node test suite remains to be run in a checked-out build/CI.

**Blockers before deployment:** validate SQL against disposable Postgres and refine any schema permissions or dependencies; implement canonical resolver (including locked source record and tenant staff auth) and same-transaction ledger reconciliation; verify PayFast callback merchant/signature/request-id verification and request issuance; resolve the already-open PayFast checkout expiry caveat. No staging/production DDL executed. Do not expose or wire payment creation until these gates pass.

## 9 November continuation — gateway settlement boundary hardened

The original settlement routine invoked `tx.getPayable(type,targetId,null)`, which cannot work with either new staff resolver because they require server-authenticated staff identity. It also did not correlate the verified notification to the saved request's tenant and target fields.

**Changes committed:**
- `paymentRequestLifecycle.js` now calls `tx.getSettlementPayable(type,targetId,tenantId)`, a separate privileged settlement authority path, and refuses to settle if it is unavailable.
- The gateway event must supply matching server-validated `requestId`, `tenantId`, `type` and `targetId` in addition to gateway payment ID and exact cents; a mismatch throws `PAYMENT_IDENTITY_MISMATCH` without writing receipts.
- `pgPaymentRequestStore.js` requires a distinct `resolveSettlementPayable` injection and exposes it on the transaction object; staff `resolvePayable` is unchanged.
- The lifecycle and adapter tests were updated; new tests exercise mismatched gateway identity and missing settlement authority.

**Verification actually run:** 14/14 committed lifecycle and adapter test bodies passed in an isolated JavaScript runtime with mocked database calls. This was not the Node test runner or a running PostgreSQL instance. No database migrations or PayFast calls executed.

**Still required before integration:**
1. Implement `resolveSettlementPayable` as a trusted server-only, transaction-locked balance resolver, with explicit same-tenant service-order/invoice scopes. Never expose a browser path that allows callers to set `verified: true` or choose tenant identity.
2. Implement a PayFast notification verifier that derives request ID, order ID, amount and merchant from the signature-checked gateway payload, with a durable correlation from request ID to existing payment intent. Current deployed PayFast functions do not support this new request identity.
3. Use canonical payment writer and request record in an **actually atomic** database transaction, or design a safe idempotent reconciliation/outbox saga. The current callback adapter is unimplemented.
4. Execute disposable PostgreSQL schema/lock/concurrency tests and sandbox gateway payments before enabling any QR UI.

**Live staging and production remain unchanged.**
