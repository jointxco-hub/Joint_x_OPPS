# Issue #106 — QR payment MVP implementation contract (9 Nov 2026)

**Status:** design / implementation gate only. No QR issuance, gateway requests, migrations or money movement implemented by this document. Do not release or merge until the checks below pass.

## Existing baseline (do not bypass)

- The Café Work Queue is currently **read-only**. Its API calls `qs_cafe_list_work_queue(p_cursor,p_limit)`; it is not a payment authority. It is on the feature branch, with a locally tested migration **not deployed remotely**.
- Existing staff Cash/EFT recording uses `qs_opps_record_staff_payment`, state uses `qs_opps_staff_payment_state`, and invoice projection uses `qs_reconcile_invoice_receipts`. Preserve these canonical records.
- Existing PayFast checkout / signed ITN confirmation and the currently deployed Café counter flow must be located and compared against the live version **before** touching payment code.
- Never re-charge or alter paid invoice `OPPS-INV-2026-0002`; it is not an acceptance-test fixture.

## MVP scope

1. **Counter first:** a persisted Café order with a final, positive payable balance can request a short-lived checkout URL; counter presents that URL as a QR.
2. **OPPS invoice second:** once counter flow is validated, an authorized operator can request a QR for an approved, outstanding OPPS invoice. Standalone invoices must not require creating fake counter orders.
3. One canonical transaction identity, tenant identity and receipt/ledger path. The QR is a transport for a URL, **not** a source of truth for price, paid status or permissions.
4. No QR issued from basket-only or unsaved work cards. Do not add a charge button to the read-only Work Queue as a shortcut.

## Proposed server contract (subject to gateway discovery)

`create_payment_request(target_type, target_id, operation_key)` runs server-side, resolves authenticated staff/counter capability and tenant from trusted data, locks or otherwise serializes the canonical payable record, computes remaining balance in minor currency units and checks that the target is not void/closed/settled/review-required. The server reuses the same operation key idempotently.

Return a minimal response:
```json
{
  "paymentRequestId": "opaque-id",
  "status": "active",
  "checkoutUrl": "https://<approved-payfast-checkout-host>/...",
  "expiresAt": "server-timestamp",
  "amountCents": 14500,
  "currency": "ZAR"
}
```
The URL/host is illustrative, not a real integration endpoint. No access token, merchant secret or signed amount is embedded in browser-generated QR data. Implement a **server-maintained payment-request record** before enabling UI. For the initial MVP, one active request per target and balance version; retries return the same request. Do not assume PayFast supports Apple Pay.

`get_payment_request_status(payment_request_id)` must return authorized, tenant-scoped, read-only status. A verified PayFast callback is authoritative for completion, not the browser visiting a success page. Reconcile through the existing canonical receipt path, once.

## Required state transitions

| Current state | Event | Result |
| --- | --- | --- |
| none | eligible target, valid request | active |
| active | identical idempotency key, same balance | same active request |
| active | balance/amount/version changes | revoke existing request; new request only after fresh server calculation |
| active | expiry | expired, not payable |
| active | target voided/closed/review-blocked | revoked |
| active | verified gateway settlement | settled and one canonical receipt |
| settled | replayed callback | no additional receipt or finance entry |
| expired/revoked | old QR accessed or callback arrives | no new charge; reconcile any genuine externally captured money for staff review |
| any | unauthenticated or other-tenant request | denied without exposing target data |

**Concurrency rule:** a simultaneous staff Cash/EFT receipt and PayFast settlement must not overpay the invoice or create two canonical receipts against the same captured money. A gateway capture that arrives after a local balance change needs an exception/reconciliation path, not silently dropped money.

## Release test matrix (no live card charges)

- Staff signed in with correct Café capability; unauthorized user; anon; cross-tenant direct API attempts; operator revoked mid-session.
- Persisted order versus unsaved basket; approved outstanding invoice versus draft, void, paid, partial-paid, missing balance, negative balance, review-required, missing source order.
- ZAR amount precision: R0, R0.01, R145.00 and large valid totals. Never accept client-supplied totals.
- Same request retried, two devices requesting together, refreshed screen, expired request, amount edited after issue.
- Verified signed PayFast callback, invalid signature, mismatched merchant/order/amount, duplicate and out-of-order callback, user closes checkout, user visits success URL without payment.
- Concurrent Cash/EFT entry and webhook; receipt projection to Café + OPPS exactly once; order status and balance refresh.
- Check QR scan on customer mobile and iMin D4, link expiry UI, error/timeout/retry feedback.
- Verify previous Cash/EFT and existing counter PayFast flows still function.

## Immediate next gate

1. Identify actual PayFast Edge Function sources and deployment versions for staging/production.
2. Trace current PayFast payment metadata, callback verification, receipt idempotency and settlement reconciliation; document authoritative table/keys.
3. Run the Work Queue RPC and UI on staging with **authorized** approval; verify staff role and no duplicate cards.
4. Implement server request/state contract and isolated tests first, then thin UI QR rendering; stage end-to-end before any release.

**Release guard:** no production migration, gateway request or payment testing without explicit authorization and verified restore/reconciliation plan.
