# Issue #106 — Counter QR payment authority checkpoint (9 Nov 2026)

**Changes in branch only:** `src/server/cafeQr/resolveCafeCounterPayable.js` and `tests/issue-106-counter-payable-resolver.test.mjs`. Neither file is attached to an exposed server route, deployed function, or browser payment control.

## Read-only staging findings
- `public.qs_staff_payment_state(uuid)` calculates paid receipts from `commerce.service_order_payments` with `status='completed'`; it checks linked OPPS transaction totals and invoice projection and returns `reviewRequired`, `closed`, and `balanceDue`. It requires authenticated Café staff. 
- `commerce.qs_begin_payfast_payment(uuid,text)` locks the service-order row but currently returns and uses **`total_amount`**, not `total - confirmed receipts`. It also reuses pending PayFast intents for 20 minutes. **This function must not be used unchanged for an invoice balance or partially paid counter QR.**
- Staging counter-channel grouped status counts during read-only inspection: 5 `accepted/paid`, 1 `cancelled/unpaid`; **no eligible unpaid counter-channel order** was available for live acceptance testing. Other channels included unpaid orders but are excluded from the counter-only initial gate.
- Staff operation capability `cafe.counter.operate` and tenant membership are used in the existing work queue. The new resolver directly checks active membership and `quick_solution` enablement, and expects an actor authenticated independently by the server.
- Other counter-channel and linked OPPS-order reconciliation is deliberately out of scope until its shared payment projection is integrated.

## Implemented safe first-pass resolver
- `resolveCafeCounterPayable` is read-only and runs on the **same database connection and transaction** as the proposed Postgres store. It locks the actual `commerce.service_orders` row before computing the balance from completed Café receipts. No browser amount or paid flag is trusted.
- Disallows non-counter, linked OPPS orders, partial payments, pending payment intents, failed/refunded/paid statuses, closed/draft orders, delivery-fee pending, quote-required, gateway projection review, missing product configurations, products not allowed for PayFast, and below-minimum balances.
- It purposely restricts the initial work to *fully unpaid, unlinked counter orders*; adding linked orders or partial payments needs a validated reconciliation and gateway amount contract.
- Requires server-verified staff identity, active same-tenant membership, and Café capability enabled. No generalized ability to debit arbitrary orders is granted.

## Verification, limits and next gate
- 26 isolated JS mock-DB checks executed successfully against the committed resolver. The committed node:test file still needs execution in the actual repository checkout or CI.
- No real disposable PostgreSQL server was available in this session. The SQL schema draft and rollback smoke script are **not yet proven against PostgreSQL**.
- Current `createPgQrPaymentStore` is a proposed abstraction, not a running durable service. It needs a dedicated backend DB role and reviewed RLS/permissions. No browser/Edge Function should call it yet.
- **Critical:** `recordVerifiedSettlement` currently takes an injected canonical receipt adapter, and the new resolvers require an authenticated actor. It is **not yet wired to a verified webhook** and cannot safely settle a payment as implemented. The callback and invoice/Café reconciliation transaction model must be explicitly redesigned before gateway integration.
- Expiring the internal request does not automatically cancel a previously opened PayFast checkout; captured late payments need durable finance exception handling.

**Next:** run SQL and actual concurrent transactions in a disposable PostgreSQL database; implement an authenticated request gateway + verified PayFast notification adapter with durable correlation, exact amount matching and canonical receipt reconciliation; then test PayFast sandbox. No staging/production writes or live payment requests made.
