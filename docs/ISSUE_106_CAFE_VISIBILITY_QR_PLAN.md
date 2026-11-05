# Issue #106 — Café visibility and shared QR payments: implementation gate

Branch: `feature/106-cafe-visibility-qr`
Base: `a16d80fd37ef9607945048011abf7737d09c4832`
Scope: design and tests only until the deployed Café RPC, existing invoice authorization, and payment gateway paths are identified.

## Verified OPPS code paths
- `src/api/cafePayments.js`: `qs_opps_staff_payment_state`, `qs_opps_record_staff_payment`, and `qs_reconcile_invoice_receipts`.
- `src/components/orders/drawer/CafeOrderPayments.jsx`: shared payment state, paid/review/closed guards, Cash/EFT entry, original receipts, invoice reconciliation, and query invalidation.
- `src/api/invoices.js` and `src/features/invoices/InvoicePaymentModal.jsx`: existing invoice payments and operation-key retry logic.
- Existing Café counter presenter `src/lib/counterOrders.js` reads only the server-selected counter-channel orders for the Johannesburg business day; it is **not** an all-invoice query.
- Current OPPS production alias `ops.jointx.co.za` resolves to Git deployment `dpl_5t5cfgDhKwRwUxJHEhb4re8MH3XF`, commit `a16d80f`. Recheck this before any release.

## Phase 1 contract: separate fulfilment work queue
1. Keep Today's Counter Orders unchanged. Add an explicit, tenant-authorized **Café Work Queue** for eligible OPPS-created Café orders and standalone invoices.
2. Server must derive the tenant and staff access from authenticated identity. Never trust browser-supplied tenant IDs, paid flags or balances.
3. Display the original OPPS order/invoice IDs, canonical totals and payment state. A work-queue item is a *reference*, not a copy of an invoice, order, receipt or Finance transaction.
4. `Send to Café Counter` (if required for production/collection) must be idempotent, authorization-checked, audited and preserve original identity. Read-only preview is a separate permission from sending/fulfilling.
5. Work items must support unpaid, paid, partial, approved/draft invoice, missing/changed order, and review-required states without offering unauthorized money actions.
6. Any cross-tenant request must be denied on the server, including direct RPC requests and retries. Never rely on UI hiding.

## Phase 2 QR gate — not yet implemented
- Only generate a payable request after a persisted transaction and server-computed final outstanding balance exist.
- Reuse PayFast's existing verified checkout/callback and the canonical receipt/ledger path; QR encodes a short-lived server-controlled payment URL, **not** an unsigned client-provided amount or credentials.
- Expire or invalidate QR requests when balances change, transaction is paid/void/revoked or expiry elapses. Callback/retry concurrency must be idempotent.
- Do not assume Apple Pay availability, nor call real PayFast in automated tests.

## Tests to complete before feature release
- Tenant/staff: authorized Café operator; other tenant denied; unauthenticated denied; read vs send permissions.
- Visibility: approved standalone invoice, unpaid invoice, paid invoice, OPPS-created order, missing order, pagination and real-time refresh.
- Identity: sending same item twice creates one work reference, no duplicate orders, invoice payments, receipts or Finance entries.
- Payment: paid item has no payable QR; canonical outstanding balance; expiry, replay, concurrent Cash/EFT vs gateway payment and partial balance change.
- Regression: existing counter channel list, shared Café Cash/EFT, invoice reconciliation, legacy review-blocks, OPPS invoices, cross-app payment projections.
- Validate in isolated test database / staging with no real transfers and no changes to paid test invoice `OPPS-INV-2026-0002`.

## Outstanding discovery (blocking implementation)
- Locate the defining SQL and authorization for `list_quick_solution_counter_orders_today`.
- Locate Café's actual deployed gateway Edge Function sources and contract, plus current production vs staging function version.
- Identify OPPS invoices list/get permissions and source-order linkage and any existing counter dispatch route.
- Confirm desired work-queue access roles, stage/status mapping, and read-only vs fulfilment operations.

## Release constraints
No staging/production mutation or payment traffic during discovery. Do not deploy this branch or merge into main until bounded tests, reconciliation and operator/device acceptance pass.
