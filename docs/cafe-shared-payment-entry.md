# Shared Café payments in OPPS

Café-originated orders now use the same original Cash/EFT receipt service from either staff app. OPPS resolves the Café order from the authorized OPPS order ID; the browser never supplies a trusted tenant or paid flag. Tenant `payments.manage` allows the OPPS action; existing Café operations permissions remain accepted by the shared service.

The database changes live in quick-solution-cafe PR24, following its shared-payment migrations. They are applied only to staging `tijiamrfnxrbitafiflj`. This OPPS branch depends on those migrations. Production is unchanged.

## Staging verification, 15 October 2026

- 63 focused component, document and existing invoice-payment tests passed; Vite build passed.
- Bounded, rollback-only SQL verified authenticated OPPS Cash/EFT writes, equal Café/OPPS balances, exactly one Finance row, a retry through the other app reusing the receipt, duplicate rejection, missing EFT reference, unauthorized reads/replays, function grants, price drift and invoice-reconciliation guards.
- An independent direct Finance income insert for a Café order was rejected.
- Existing receipt edits/deletes are removed from the Café order UI. The database trigger also checks old/new managed and legacy Café payment rows. The combined test containing edit/delete cases stalled at the connector and was replaced with the bounded checks above; those two DML cases are not claimed as executed in this checkpoint.
- Supabase security advisor flags authenticated SECURITY DEFINER access. This is intentional for the tenant-authorized receipt endpoints with fixed empty search paths; anonymous execution and internal-helper access are revoked. The direct-write assertion exposes no financial data and only rejects unsafe independent writes.

## Operator test

1. In the Café staging app create an unpaid scan/print job and send it to OPPS. Use a new test job without a linked invoice or pending online payment.
2. In this OPPS preview open the order and choose Add Payment. Payments should show the outstanding balance from the shared record.
3. Record Cash, confirm actual receipt, then submit once. Confirm Received equals the order total and Outstanding is zero.
4. Re-check the same order in Café. It must show the same received amount and zero outstanding.
5. Confirm Finance has one income entry. Refresh both apps: neither should offer another payment for the settled order.
6. Repeat with a second unpaid order using EFT. A bank reference and confirmation that funds arrived are required. Use staging test data only.

## Remaining release gates

This slice handles the full outstanding balance. Linked invoices and legacy discrepancies stay blocked for reconciliation; partial receipts, audited corrections/reversals, gateway concurrency integration and customer accounts remain separate milestones. Device acceptance is pending. Do not promote the broader OPPS feature branch as part of this slice.

## Invoice-linked receipts — 16 October 2026

Requires the three Café staging migrations named `cafe_invoice_shared_receipts`,
`cafe_invoice_receipt_context_guards`, and `cafe_invoice_legacy_identity_guard`.
Shared payment entry now refreshes invoice readers as well as orders/Finance. Invoice
entry refreshes the shared order payment reader. A missing invoice projection offers
**Sync existing invoice receipts** only when no other reconciliation issue exists.
This links existing money; it never records a new receipt.

Device checks: create an unpaid staging Café order, send it to OPPS and create/approve
one linked ZAR invoice with the exact same total. Record full Cash/EFT through either
payment entry point; Café, OPPS and invoice must show zero outstanding, with one Finance
income. EFT needs a verified bank reference. For receipt-before-invoice, record first,
then create/approve the invoice and use Sync existing invoice receipts from the order's
Payments tab. Repeat sync: no second income or receipt should appear. Do not make a real
transfer for staging tests. Invoice entry currently records money received today; historical
Café receipt entry requires review. Ordinary invoice partials are unchanged.

Backend rollback checks cover identity, balances, replay, missing EFT reference, conflicts,
legacy identity, unauthorized synchronization and ordinary invoice regression. Customer device
and multi-session concurrency acceptance are pending; this remains a draft staging change.

## Scoped release checkpoint, 18 October 2026

This release branch starts from main 079c1b03 and includes only the payment UI changes.
It excludes the unrelated pricing, RBAC and readiness feature branch. It requires the
nine new payment migrations in the companion Café `release/cafe-shared-payments` branch,
including gateway/counter adapters and captured-receipt review visibility.

Desktop invoice-first EFT and receipt-first Cash/sync passed user acceptance. A real
simultaneous staging Cash-versus-invoice-EFT test left exactly one original receipt,
one Finance row and one invoice projection; the losing writer waited and was rejected.
The companion Café release document records timestamps and backend IDs.

Isolated OPPS validation: build passed, 37 shared-entry/reliability/order-sync tests
and 92 manual-payment/proof/gateway tests passed. Linked-invoice mobile acceptance
is not claimed. Production deployment remains blocked by Vercel team access (403);
no production schema, payments or aliases were changed. Do not promote a staging
build that uses staging database configuration.
