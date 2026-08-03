# OPPS Inventory Phase 0/1 SQL Review Package

**Status:** Proposed, unexecuted SQL for review only  
**Prepared:** 2026-07-26  
**Source documents:** `../OPPS_INVENTORY_AUDIT.md` and `../OPPS_INVENTORY_PHASE_0_1_PLAN.md`

Nothing in this directory is an executable migration in the repository migration path. Do not copy these files into `supabase/migrations`, run them against a database, or expose their proposed objects to the application until the review checklist is complete and the owner separately authorizes migration creation and execution.

## Package order

1. `01_REMOTE_SCHEMA_AUDIT.sql` - read-only catalog report for the actual remote database.
2. `02_DATA_QUALITY_AUDIT.sql` - read-only legacy-data reports.
3. `03_IDENTITY_FOUNDATION_PROPOSED.sql` - proposed internal and supplier identity DDL.
4. `04_LEGACY_MAPPING_WORKSPACE_PROPOSED.sql` - proposed immutable, versioned review workspace and staging function.
5. `05_PHASE1_READ_MODELS_PROPOSED.sql` - proposed tenant-safe hierarchy, drill-down, review, search, and compatibility models.
6. `06_RLS_AND_GRANTS_PROPOSED.sql` - proposed RLS, reviewer authorization, decision function, and grants.
7. `07_TWO_TENANT_TESTS_PROPOSED.sql` - executable but unrun isolation tests for a disposable database.
8. `08_DATA_INTEGRITY_TESTS_PROPOSED.sql` - executable but unrun structural/integrity tests.
9. `09_ROLLBACK_PROPOSED.sql` - recovery choices and guarded inverse SQL.
10. `10_VALIDATION_CHECKLIST.md` - required review and authorization sequence.
11. `11_OPEN_DECISIONS.md` - unresolved assumptions that block production migration finalization.
12. `12_REMOTE_AUDIT_RESULTS_REDACTED.md` - redacted results from the authorized read-only remote audit.
13. `13_REMOTE_SCHEMA_COMPARISON.md` - confirmed remote-versus-checked-in schema drift and required package changes.

## Phase boundary

Phase 1 adds identity and reviewed mappings only. It does not add balances, stock movements, opening balances, reservations, allocations, receiving, picking, or production mutations. `public.inventory` and `public.inventory.current_stock` remain untouched and authoritative.

The future lifecycle is documented but not implemented:

```text
order requests internal variant -> internal demand commitment
                                    -> approved exact supplier allocation
                                    -> future hard physical reservation
```

An internal product such as `JET` never owns a physical balance. The exact supplier variant is the future traceable stock unit.

## Checked-in compatibility findings

- `public.inventory` is defined in `src/api/supabase/schema.sql` with one mutable `current_stock` and a globally unique `sku`.
- `202606210004_tenant_purchasing_inventory.sql` later adds tenant ownership/RLS to inventory, suppliers, and purchase orders.
- The repository has no baseline `CREATE TABLE public.suppliers`; `202605260002_supplier_products.sql` and later code assume the remote table already exists.
- Existing tenant access uses `public.can_access_tenant(uuid)`. Existing `public.is_app_admin()` can grant global app authority, so this proposal deliberately requires app admins to also have access to the explicitly supplied operational tenant.
- Existing SQL tests use disposable tenants/auth users, JWT claim switching with `set_config`, `DO` assertions, and explicit cleanup. The proposed tests use the same pattern but wrap fixtures in a transaction that is always rolled back.
- The authorized remote audit confirmed PostgreSQL 17.6, `pgcrypto` 1.3, and support for security-invoker views.
- The existing `active_orders`, `v_orders`, and `v_purchase_orders` views are owner-executed, lack `security_invoker`, and are selectable by `anon`; this is a critical Phase 0 remediation blocker outside this proposal.
- Internal helper functions inherit executable access through `PUBLIC`; the final review must revoke `PUBLIC` and assert that `anon` cannot execute internal functions.

## Review assumptions

- `pgcrypto` 1.3 and `gen_random_uuid()` are available remotely.
- `public.tenants`, `public.tenant_memberships`, `public.can_access_tenant(uuid)`, `public.current_user_tenant_ids()`, and `public.is_app_admin()` exist remotely.
- Remote `public.suppliers` has required `id`, `name`, and `type` fields; `tenant_id` is nullable. Its full deployed shape is not reproducibly defined in the checked-in schema.
- The deployed PostgreSQL version supports `NULLS NOT DISTINCT` only if the final DDL chooses to use it; this draft avoids requiring it.
- The eventual migration timestamp/names will be chosen only after review.

## Explicit non-actions

Package preparation and the separately authorized remote audit executed only read-only catalog/data-quality queries through the linked Management API. They did not apply a migration; execute proposed DDL, RLS, grants, rollback, or fixtures; change application code; modify `public.inventory` or `current_stock`; or touch unrelated working-tree changes.
