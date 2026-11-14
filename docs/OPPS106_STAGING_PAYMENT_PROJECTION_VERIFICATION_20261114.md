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
