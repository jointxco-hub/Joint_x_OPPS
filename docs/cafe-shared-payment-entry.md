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
