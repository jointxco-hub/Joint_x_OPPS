# OPPS-106 — 18 November 2026 staging finance reconciliation

## Scope
**Staging project ONLY**: `tijiamrfnxrbitafiflj`. QR issuance controls remain OFF, no production migration or application merge.

Source paid Café order `QS-261118-98C6`:
- `commerce.service_orders.id = 7334c164-8294-4ef2-a9bd-9b87b4ee9e27`
- OPPS order `public.orders.id = 7a07d35e-1d51-4588-b9ce-12549d94266a`
- Finance record `public.transactions.id = ea34f46f-f757-4596-99bc-6f4fd7bc750d`
- One original completed PayFast payment `3526444`, R60, verified sandbox ITN
- Handoff status `sent`, exactly one OPPS order, R60 deposit, status paid

## Root cause
The canonical `commerce.qs_project_manual_receipt` maps all providers outside cash/card/EFT to `other`, and `public.transactions.transactions_payment_method_check` did not allow `payfast`. The projection also omitted the sandbox/test/reporting flags. The OPPS handoff inserts `public.orders` with default live classification.

## Changes actually applied directly to staging DB
The following staging migration names are recorded in Supabase migration history:
1. `opps106_staging_payfast_receipt_classification` extends the Finance method check to include `payfast`; implements provider-backed receipt method/reference and sandbox flags for verified R60 canary PayFast QR. Not a production-ready environment derivation.
2. `opps106_staging_preserve_workspace_order_guard`: restored order mutation scope after a guarded test rejection.
3. `opps106_staging_projection_classification_only_authorized`: same-value Finance classification refresh no longer touches ledger amount/order ID; OPPS order payment projection updates only when balance/status actually change.

Existing R60 transaction was refreshed through `commerce.qs_project_manual_receipt`. Verified:
- amount R60.00; method `payfast`; reference `3526444`;
- `is_test=true` and `excluded_from_reports=true`.
No new receipt or second Finance transaction was created.

## Remaining blockers
- **Existing OPPS order** still has `payment_method=NULL`, `payment_environment='live'`, `is_test=false`, `excluded_from_reports=false`. Workspace update trigger correctly refused direct updates, including a no-op status update. Do NOT bypass that trigger or set request JWT claims to service_role to force a write.
- Existing staff-authorized UI: Orders -> matching order -> QA & reporting -> **Test / QA order** and **Exclude from reports & operations**. These use `set_order_test_classification` with staff authorization and audit event. This is necessary for the existing order until a narrowly-scoped authorized reconciliation action exists.
- The `payment_environment` field and `payment_method` on the OPPS order need a separate **server-authorized** reconciliation that verifies sandbox gateway provenance, logs an audit trail and preserves workspace permissions.
- For **future** handoffs, propagate an explicit trusted gateway environment from the validated payment service into the OPPS order insert, not from merchant-ref `JXQR-` prefix or a browser-provided flag. The current staging-only projection must **not** be promoted as a generic production migration.
- QR payments for ordinary/non-sandbox tenants must never be reclassified on the basis of the merchant reference. Confirm all related report filters and cross-app projections before release.
- Restore production-safe database function definition and test migration as reviewed branch SQL before staging-to-production promotion. Do not assume this live staging patch is version-controlled in application migrations.

No production deployment or payment was initiated in this correction.
