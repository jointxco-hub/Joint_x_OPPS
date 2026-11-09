# Issue #106 — trusted gateway settlement payable resolver checkpoint (9 Nov 2026)

**Implemented:** `src/server/cafeQr/resolveTrustedQrSettlementPayable.js`
**Tests:** `tests/issue-106-trusted-qr-settlement-resolver.test.mjs`

## Why this component exists

`recordVerifiedSettlement` uses `tx.getSettlementPayable`, not a staff-token resolver. Staff membership checks cannot be used when a valid PayFast notification arrives asynchronously, because the gateway is not a Café staff member.

This trusted resolver:
- Allows `opps_invoice` only. `cafe_order` is deliberately rejected until the PayFast intent and `commerce.qs_apply_payfast_payment` receipt semantics can be bound safely to a QR request ID.
- Requires canonical UUID request identity and tenant ID and reads the invoice with `WHERE id=$1 AND tenant_id=$2 FOR UPDATE`. Only an active Quick Solution tenant is eligible.
- Recomputes cents via `public.invoice_balance_due` **after** acquiring the invoice lock.
- Fails closed for already-paid/void/draft/unapproved/currency-mismatch/invalid-amount invoices.
- Does not mutate database state, issue checkout links, or claim to authenticate incoming webhooks.

## Important limitations

1. This resolver is an internal adapter. Its `tenantId` input is trustworthy **only** when taken from the locked server-issued request record, not the HTTP body.
2. It must be called only after **actual PayFast signature and merchant validation, request-ID correlation and amount verification** by a dedicated trusted notification handler. A JavaScript object that says `verified:true` is not sufficient.
3. The current `applyCanonicalReceipt` remains unimplemented and has not been demonstrated atomically with the request record in PostgreSQL. The existing invoice PayFast RPC uses its own transaction; do not call it as a second transaction while claiming atomicity.
4. The PayFast notification path's existing contract has not yet been extended with QR payment-request identity. Do not wire this into the live notification route prematurely.
5. The existing Café order PayFast function charges `total_amount` and has its own pending intent and receipt reconciliation. A separate counter settlement adapter and exact intent linkage are required.
6. No real PostgreSQL server was available in this workspace, and neither a disposable SQL schema test nor sandbox payment was performed.

## Verification

Four grouped resolver tests passed against exact connected GitHub code in an isolated JavaScript execution harness with fake DB responses:
- locked, tenant-scoped invoice and canonical balance read;
- rejection of unsupported Café target;
- invalid/missing/cross-tenant identity rejection;
- blocked settled, draft, void, foreign-currency and malformed-balance invoices.

**Next gate:** establish real disposable PostgreSQL and run the private schema + concurrency tests; design verified webhook correlation with a durable request ID; then implement atomic receipt handling. No staging or production changes were made.
