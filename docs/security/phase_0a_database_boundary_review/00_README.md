# OPPS Phase 0A Database Boundary Review

**Status:** Read-only investigation complete; migration, fixtures, tests, rollback, and disposable procedure remain proposed and unexecuted.  
**Prepared:** 2026-07-26  
**Evidence:** `docs/inventory/phase_0_1_sql_review/12_REMOTE_AUDIT_RESULTS_REDACTED.md` and `13_REMOTE_SCHEMA_COMPARISON.md`

This package addresses only the confirmed database-boundary and schema-baseline blockers that must be resolved before Phase 1 inventory work can be finalized. It is not a migration directory and must not be copied into `supabase/migrations/` until the owner approves the evidence, exact migration text, disposable-environment results, and rollback capture.

## Package order

1. `01_CONFIRMED_REMOTE_BOUNDARIES.md` â€” evidence ledger, affected views, functions, roles, and dependency status.
2. `02_VIEW_ACCESS_REMEDIATION_PROPOSED.sql` - superseded view component draft retained for review history.
3. `03_FUNCTION_EXECUTE_REMEDIATION_PROPOSED.sql` - superseded function component draft retained for review history.
4. `04_REMOTE_SCHEMA_BASELINE_PLAN.md` â€” supplier/PO drift and reconciliation plan.
5. `05_ARCHIVED_INVENTORY_REFERENCE_REVIEW.sql` - executed read-only review; redacted result retained in file 13.
6. `06_RLS_AND_ROLE_TESTS_PROPOSED.sql` â€” unexecuted read-only role/RLS test harness for a seeded disposable environment.
7. `07_REGRESSION_TESTS_PROPOSED.md` â€” application contract and no-data-change checks.
8. `08_ROLLBACK_PROPOSED.sql` â€” unexecuted, data-preserving rollback proposal.
9. `09_VALIDATION_CHECKLIST.md` â€” approval gates and required evidence.
10. `10_OPEN_DECISIONS.md` - owner decisions that remain blocking.
11. `11_PHASE_0A_SECURITY_MIGRATION_PROPOSED.sql` - single finalized, unexecuted migration draft.
12. `12_DISPOSABLE_VALIDATION_PROCEDURE.md` - production-isolated reset/test/rollback/reapply procedure.
13. `13_READ_ONLY_INVESTIGATION_RESULTS.md` - redacted final evidence and conclusions.
14. `14_DISPOSABLE_TWO_TENANT_SEED_PROPOSED.sql` - local-only two-tenant fixture.
15. `15_ORDINARY_OPERATIONS_AND_PARENT_GUARD_TEST_PROPOSED.sql` - always-rollback operation/guard test.

## Phase boundary

Included:

- anonymous access removal from three internal views;
- owner-context view hardening;
- least-privilege function execution;
- safe `search_path` review;
- purchasing-parent tenant validation;
- deployed supplier and purchase-order baseline planning;
- read-only investigation of one archived-inventory reference;
- proposed role, RLS, regression, and rollback tests.

Excluded:

- inventory product/variant or legacy-mapping implementation;
- balances, movements, reservations, receiving, picking, or allocations;
- order or production workflow changes;
- UI implementation;
- production data repair.

## Recommended sequence

```text
capture exact remote definitions/grants/dependencies
  -> approve view/function treatment
  -> create reviewed migration copies
  -> apply only to a seeded disposable clone
  -> run role/RLS and application regression tests
  -> exercise security-safe rollback
  -> separately authorize production migration
```

Revoking view grants alone is insufficient: owner-executed views must also become security-invoker, become tenant-validating RPCs, or be removed. Likewise, revoking only from `anon` is insufficient for functions while `PUBLIC` retains default `EXECUTE`.

## Explicit non-actions

Finalization executed only authorized read-only queries and temporarily downloaded deployed Edge Function source for consumer search. It did not execute DDL/DML, alter a view/function/policy/privilege, create a production migration, run a fixture/test/rollback, or modify orders, purchase orders, suppliers, inventory, balances, or workflows. Temporary query/source files were removed.
16. `legacy_schema_bootstrap/` - sanitized, data-free, unexecuted legacy schema package for disposable validation.


