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
