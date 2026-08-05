# Disposable Execution Sequence

Prepared only; do not execute against production or a linked project.

## 1. Isolate and verify

1. Clone the repository into a disposable directory outside the production working copy.
2. Remove `.env*`, Supabase access tokens, database URLs, project-link metadata, and production dumps.
3. Confirm Docker/Supabase endpoints are loopback-only.
4. Never run `supabase link`, `db push`, or any command with `--db-url`.

## 2. Start local Supabase and validate bootstrap ownership

Run the bootstrap in one local session after setting:

```sql
set opps.phase0a_disposable_bootstrap = 'approved-local-only';
```

Apply file 02, then run file 05 with validation stage `bootstrap`. It must report no missing relations, exactly 25/33/16 view columns, zero rows in every bootstrap table, and no Inventory Phase 1 objects.

Apply file 06 immediately. Confirm only bootstrap-created relations disappeared and Supabase-owned schemas/extensions remain. Reapply file 02 to prove bootstrap repeatability before continuing.

## 3. Apply checked-in migration baseline

Apply `supabase/migrations` in filename order and stop on the first error. Do not patch around a missing object inside the lab; record it as bootstrap drift.

Before that step, resolve the duplicate migration version prefixes `20260523` and `202606020001` through a separately reviewed disposable-only history/order plan. Do not rename checked-in production migrations as part of this bootstrap task.

Run file 05 with stage `baseline`. Required helpers, the purchasing trigger, storefront RPC, and all three output contracts must exist.

Important: checked-in migrations currently insert synthetic XOS/storefront demo rows and base tenants/products/order stages. This prevents a literal all-table zero-row assertion after the full chain. Until the owner chooses a treatment, prove only that the bootstrap itself was empty and separately inventory every row introduced by checked-in migrations.

## 4. Seed and capture the pre-Phase-0A state

Apply parent file `14_DISPOSABLE_TWO_TENANT_SEED_PROPOSED.sql` only after confirming local endpoints. Capture schema hashes, ACLs, row counts, business-row hashes, and `inventory.current_stock` totals using the procedure in parent file 12.

The current seed may require reconciliation if checked-in demo rows collide with strict expected-count assertions. Do not delete or rewrite them without owner approval.

## 5. Apply and test Phase 0A

1. Apply parent file 11 locally.
2. Run file 05 with stage `phase0a`.
3. Run parent files 06, 07, and 15 plus storefront contract checks.
4. Confirm anonymous access exists only through approved storefront RPCs.
5. Confirm direct helper/internal-view access is denied to unauthorized roles.
6. Confirm Tenant A/B isolation, ordinary operations, unchanged output contracts, and identical pre/post business hashes.

## 6. Roll back and reapply Phase 0A

Apply parent file 08, rerun security-safe rollback checks and hashes, then reapply file 11. Repeat role/RLS/storefront/contract tests and hashes. The second application must produce no grant, object, result-shape, or business-value drift.

File 06 is not the Phase 0A rollback and must not be used after repository migrations exist.

## 7. Destroy the lab

Stop the local stack and remove only the verified disposable clone through the approved workspace-cleanup process. Retain only redacted pass/fail summaries and schema hashes that contain no business-derived values.



