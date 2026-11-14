# OPPS-106 staging verification — 2026-11-14

Branch: `feature/106-cafe-visibility-qr` · PR #108
Scope: `20261114223600_opps106_paid_invoice_order_projection.sql`
Database: Joint X XOS Staging (`tijiamrfnxrbitafiflj`)

## Executed checks

The full proposed migration was executed inside a single SQL
`BEGIN ... ROLLBACK` transaction, then its new projection function was
invoked against existing staging orders with all modifications rolled back.

- PASS — migration compiled inside a staging rollback transaction.
- PASS — an order with R350 completed Finance income covering R350 total
  moved from `pending` to `paid`.
- PASS — invoking the projection twice was idempotent.
- PASS — a pending R2 order with no completed income stayed `pending`.
- PASS — increasing the order total above completed income did not mark it paid.
- PASS — setting the order total to zero did not mark it paid.
- PASS — restoring the covered total allowed `pending -> paid`.
- PASS — Finance transaction row count was unchanged.
- PASS — post-rollback query verified original staging records/statuses were
  unchanged.

Staging fixtures were `QS-261022-8E83` and `QS-260928-A0BA`.
No PayFast sandbox checkout was executed here.

## Production read-only validation

Two historical orders matched the safe repair predicate:
- `ORD-Q-FC291AB8AD` — invoice and completed Finance ledger both R129.
- `ORD-Q-C317A1DC0F` — invoice and completed Finance ledger both R2,967.

No production mutations have been performed.

## Release blocker — payment writer permissions

Production's `enforce_workspace_order_update_scope()` currently lacks
staging's narrowly scoped `finance.write` + ledger-proven
`pending -> paid` allowance. The proposed after-transaction trigger
would attempt that update and can raise SQLSTATE 42501 for a finance-only
user, potentially rolling back an otherwise valid payment write.

Before merge:
1. Bring the production permission gate up to staging's audited and
   ledger-proven invariant in a separate reviewed migration, **or** ensure
   this projector never causes payment writes to fail and clearly define
   how reconciliation happens for finance-only staff.
2. Verify real actor-role tests (`finance.write` without `orders.write`,
   and a role with neither permission), including successful and rejected
   writes. Tests run via privileged SQL sessions are not role authorization
   verification.
3. Validate the historical backfill against the production permission
   guard under a controlled deployment role.
4. Exercise PayFast sandbox / QR checkout and public tracking separately.

**Status: staging function tests passed; NOT cleared for merge or deployment.**

## Follow-up: finance-only permission compatibility — 2026-11-14

Added migration `20261114223000_opps106_finance_paid_scope_guard.sql`,
ordered before the payment projection migration. It pins the reviewed
production guard definition and refuses to overwrite a drifted guard. On
staging's newer audited guard, it leaves the function unchanged. The narrow
exception requires a finance permission AND a completed, same-tenant Finance
ledger that covers the positive order total; no other order field can change.

Tests executed in the staging database inside explicit rollback transactions:

- PASS: both migrations apply together with existing canonical staging
  projection trigger; no duplicate trigger is installed.
- PASS: temporarily replace staging's guard with the reviewed production
  version, then install the compatibility migration. New narrow guard present.
- PASS: simulate a finance-only actor (no orders.write) and update a fully
  covered pending order to paid.
- PASS: finance-only actor is denied when completed income does not cover
  order total (SQLSTATE 42501).
- PASS: actor without finance.write or orders.write is denied paid transition.
- PASS: simulate production's missing canonical projection trigger: new
  OPPS-106 trigger is installed.
- PASS: all rollback tests restore staging's original canonical trigger,
  staff membership, and helper state.
- PASS: one-time backfill now uses service-role claims scoped to the migration
  block, restoring the previous claim afterward; ordinary staff never inherit
  the privilege.

**Remaining release checks:** exercise a real finance payment write through
the transaction trigger (not just the paid-status update), confirm expected
audit/authorization behavior under the deployed role model, review deploy
diff, and test PayFast QR sandbox + public tracking. Production not altered.

- PASS: under the simulated production guard/trigger layout, a finance-only
  actor's completed Finance transaction UPDATE fired the new projection,
  advanced the covered order to paid, and replay left transaction count
  unchanged. This exercises the trigger path but is not a signed client
  JWT / live PayFast checkout test.
