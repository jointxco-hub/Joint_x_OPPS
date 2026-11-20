# OPPS-106 — Invoice-origin payment reconciliation gate (15 Nov 2026)

**Environment:** Supabase staging `tijiamrfnxrbitafiflj`.
**Status:** Database audit complete; invoice-origin end-to-end operator/PayFast scenario not yet complete.
**Scope:** Read-only investigation and a `BEGIN/ROLLBACK` projection check. No payment or order was mutated.

## Verified records

| Invoice | Amount shown paid | Related order | Order paid status | Completed same-tenant Finance receipts |
|---|---:|---|---|---:|
| OPPS-INV-2026-0004 | R350 | QS-261018-76C0 | paid | R350 |
| OPPS-INV-2026-0005 | R810 | QS-261018-BB9C | paid | R810 |
| OPPS-INV-2026-0008 | R790 | ORD-Q-E37552BC4D | **pending** | **R0** |

Invoice 0008:
- Invoice `12ab0a30-0f2c-4e79-b5e4-de68d079d795`, tenant `aaaaaaaa-0000-0000-0000-00000000000a` (`joint-x`).
- Order `938fa410-660c-4e50-8e8d-ed53e4218b65` linked in both directions; amount R790.
- One `public.invoice_payments` manual EFT R790 receipt ID `0dcd982b-de50-46d4-a0f4-ea4af053f6bc`.
- The invoice receipt has `order_id=null`, `source=manual`, `reference=null`; there was no corresponding completed `public.transactions` Finance row linked by order, linked invoice or invoice/order number.
- Running the **installed** `public._recompute_order_payment_projection(order_id)` inside a rollback transaction preserved `payment_status='pending'`.
- The proposed OPPS-106 projection migration helper is **not installed** on staging. Staging already has canonical `trg_transactions_project_order_payment_status`. OPPS-106 migration itself was previously tested only inside rollback (see `OPPS106_STAGING_PAYMENT_PROJECTION_VERIFICATION_20261114.md`).

Invoice 0004/0005 both also contain historical standalone manual invoice receipt rows **in addition to** Café-projected order-linked receipt rows. Therefore **do not blindly sum every invoice receipt or copy them to Finance**. Review source-specific canonical transactions and historical duplicate/overpayment behavior first.

## What this proves

- **Positive existing examples:** an invoice-origin linked order can show `paid` when an independently posted, same-tenant completed Finance income entry covers the total.
- **Negative example:** an invoice marked paid based on an invoice-only manual receipt does not automatically mark the order paid. This is the intended conservative behavior of the Finance-ledger projection; it may also be a UX/integration gap if staff expect invoice-only manual EFT to populate the linked order.
- **Not proved yet:** a fresh authenticated quote → approved invoice → staff EFT/PayFast record → create order scenario; invoice QR capture; concurrent payments; genuine staff permission tests for the current invoice UI.
- **Do not** auto-create a Finance receipt for invoice 0008, force its order paid, re-charge it, or use it as a destructive acceptance fixture.

## Invoice → Finance bridge requirements before implementation

1. Review canonical manual invoice payment command and current invoice/accounting policy; decide whether standalone invoice receipts should create a Finance transaction on entry.
2. Preserve unique source receipt identity, tenant, source invoice, linked order and the exact paid amount. One source capture must not create multiple completed Finance rows.
3. Separate invoice metadata projection from independently confirmed payment. Full payment can be recognized on the order **only** when verified completed Finance receipts cover its positive total.
4. Compare existing manual and Café-synced rows, including source-specific amounts and historical overlaps, before any backfill; require staff review for ambiguous/overpaid items.
5. Ensure partial/void/closed invoices, wrong tenant, zero/negative totals and replay cannot generate or duplicate an income row.
6. Stage complete rollback/idempotency/permission tests before applying any migration.

## QR implementation gate

The QR contract at `docs/ISSUE_106_QR_PAYMENT_MVP_CONTRACT.md` remains a draft:
- `paymentRequestLifecycle.js` is server-only and **not wired to an endpoint**.
- `resolveCafeCounterPayable.js` explicitly blocks a partial-paid counter order, and the existing PayFast initiation charges **total_amount**, not balance due.
- `resolveCafeInvoicePayable.js` is a server-only Café-tenant OPPS-invoice resolver. Do not repurpose the Joint X invoice 0008 as a Café QR target.
- Staging has no invoice or counter QR payment request table deployed from this feature.
- Before a scan test, implement durable, tenant-locked payment-request and callback correlation, secure authorized issue and status endpoints, and QR URL rendering. The QR is transport; it never sets amount or paid status.

**Release decision:** continue implementing isolated QR adapters and tests, but **do not enable QR issuance or production settlement** until the manual-invoice Finance mapping and backend gateway callback controls are reviewed.
