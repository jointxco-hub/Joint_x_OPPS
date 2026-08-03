# Phase 0A Disposable Validation Procedure

This procedure is prepared but unexecuted. It is local-Docker only and must never receive production project references, database URLs, passwords, access tokens, backups, or row data.

## Blocking prerequisite: offline schema-only legacy baseline

The repository migrations do not create several legacy tables, including suppliers, clients, and projects. A clean `supabase db reset` cannot be treated as authoritative until this gap is reconciled.

Provide an owner-reviewed, data-free SQL artifact at:

```text
C:\phase0a_inputs\opps_legacy_schema_only.sql
```

It must contain only the missing pre-migration legacy schema and the confirmed supplier/PO structural drift required by current migrations and Phase 0A tests. It must contain no inserts, sequences advanced from production, ownership credentials, UUIDs, customer text, quantities, or business values. Produce it outside this procedure through an approved schema-baseline process; do not connect this lab to production.

## 1. Create an isolated local lab

From PowerShell, substitute the repository path once:

```powershell
$phase0aRepo = 'C:\path\to\Joint_x_OPPS'
$phase0aLab = Join-Path $env:TEMP 'opps-phase0a-lab'
$phase0aInput = 'C:\phase0a_inputs\opps_legacy_schema_only.sql'

if (Test-Path -LiteralPath $phase0aLab) { throw 'Choose a new empty Phase 0A lab path.' }
if (-not (Test-Path -LiteralPath $phase0aInput)) { throw 'Reviewed schema-only input is missing.' }

git clone --no-hardlinks $phase0aRepo $phase0aLab
New-Item -ItemType Directory -Path (Join-Path $phase0aLab 'docs\security') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $phase0aRepo 'docs\security\phase_0a_database_boundary_review') `
  -Destination (Join-Path $phase0aLab 'docs\security\phase_0a_database_boundary_review') -Recurse
Set-Location -LiteralPath $phase0aLab
```

Clear remote-capable environment variables in the lab shell:

```powershell
Remove-Item Env:SUPABASE_ACCESS_TOKEN -ErrorAction SilentlyContinue
Remove-Item Env:SUPABASE_DB_URL -ErrorAction SilentlyContinue
Remove-Item Env:SUPABASE_PROJECT_REF -ErrorAction SilentlyContinue
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
```

Do not run `supabase link`, `--linked`, or `--db-url` anywhere in this procedure.

## 2. Install only the test-only schema bootstrap

These copies exist only in the disposable clone:

```powershell
Copy-Item -LiteralPath $phase0aInput `
  -Destination 'supabase\migrations\202604010000_phase0a_legacy_schema_test_only.sql'

```

The early schema-only file lets the current repository migration chain run against the legacy objects it assumes. Do not copy migration 11 into `supabase/migrations` yet; the first reset must represent the pre-Phase-0A state.

## 3. Provision/reset local Supabase

```powershell
supabase start
supabase status
supabase db reset --local
```

Stop immediately unless `supabase status` reports loopback/local Docker endpoints. A reset failure is a baseline defect; update the reviewed schema-only artifact rather than editing migrations ad hoc.

## 4. Seed two tenants and required roles

```powershell
supabase db query --local `
  --file 'docs\security\phase_0a_database_boundary_review\14_DISPOSABLE_TWO_TENANT_SEED_PROPOSED.sql' `
  --output json
```

The seed uses fixed `.test` identities and `92...` UUIDs only. Verify the target is local before running it.

## 5. Capture the pre-migration baseline

Save the following local-only query output as `pre.json`. Keep this same seeded database for the post-migration capture so fixture timestamps remain identical.

Use a local-only hash query for each state:

```sql
select source_table, row_count,
       encode(digest(coalesce(row_fingerprint, ''), 'sha256'), 'hex') as data_hash
from (
  select 'orders'::text as source_table, count(*) as row_count,
         string_agg(md5(to_jsonb(t)::text), '' order by t.id::text) as row_fingerprint
  from public.orders t
  union all
  select 'inventory', count(*), string_agg(md5(to_jsonb(t)::text), '' order by t.id::text)
  from public.inventory t
  union all
  select 'purchase_orders', count(*), string_agg(md5(to_jsonb(t)::text), '' order by t.id::text)
  from public.purchase_orders t
  union all
  select 'suppliers', count(*), string_agg(md5(to_jsonb(t)::text), '' order by t.id::text)
  from public.suppliers t
) baseline;
```

Also capture `sum(current_stock)` separately and keep all artifacts outside Git.

## 6. Apply the proposed migration locally

```powershell
supabase db query --local `
  --file 'docs\security\phase_0a_database_boundary_review\11_PHASE_0A_SECURITY_MIGRATION_PROPOSED.sql' `
  --output json
```

Immediately rerun the hash query as `post.json`. Pre/post row counts, hashes, and `current_stock` totals must match exactly.

## 7. Run structural, RLS, role, and storefront tests

```powershell
supabase db query --local `
  --file 'docs\security\phase_0a_database_boundary_review\06_RLS_AND_ROLE_TESTS_PROPOSED.sql' `
  --output json

supabase db query --local `
  --file 'supabase\tests\storefront_catalog_tenant_scope.sql' `
  --output json

supabase db query --local `
  --file 'supabase\tests\xos_admin_gate.sql' `
  --output json

supabase db query --local `
  --file 'docs\security\phase_0a_database_boundary_review\15_ORDINARY_OPERATIONS_AND_PARENT_GUARD_TEST_PROPOSED.sql' `
  --output json
```

Expected outcomes:

- `anon` cannot select internal views or execute internal/tenant RPCs.
- Tenant A direct views and RPCs contain only Tenant A rows; Tenant B is symmetric.
- App admin access still requires membership in the explicit operational tenant.
- authenticated RLS helpers work after PUBLIC is removed.
- authenticated users cannot directly execute the purchasing trigger helper.
- the public storefront RPC remains callable and tenant-host scoped.
- all three view column contracts remain unchanged.
- ordinary supplier, inventory, PO, and order reads/writes for the correct tenant pass.
- cross-tenant or missing purchasing parents fail with the same generic message.

Run the UI/application checks in `07_REGRESSION_TESTS_PROPOSED.md`, including order, PO, supplier, inventory, and storefront screens. Do not change broad order statuses or production detail fields as part of validation.

## 8. Confirm no business rows changed

Re-run the hash query from step 5 after all read-only tests. Compare row counts, row hashes, and `current_stock` totals byte-for-byte with the seeded post-migration baseline. The only permitted differences are catalog definitions/options/ACLs introduced by the migration.

## 9. Apply security-safe rollback

```powershell
supabase db query --local `
  --file 'docs\security\phase_0a_database_boundary_review\08_ROLLBACK_PROPOSED.sql' `
  --output json
```

Re-run anonymous-denial checks, storefront tests, direct authenticated view checks, and data hashes. Rollback fails if it restores anonymous/PUBLIC exposure or changes any row.

## 10. Reapply and prove repeatability

```powershell
supabase db query --local `
  --file 'docs\security\phase_0a_database_boundary_review\11_PHASE_0A_SECURITY_MIGRATION_PROPOSED.sql' `
  --output json

supabase db query --local `
  --file 'docs\security\phase_0a_database_boundary_review\06_RLS_AND_ROLE_TESTS_PROPOSED.sql' `
  --output json
```

Re-run hashes and storefront tests. The second apply must succeed without new objects, grant drift, output-contract drift, or row changes.

Finally prove clean migration ordering in the disposable clone:

```powershell
Copy-Item -LiteralPath 'docs\security\phase_0a_database_boundary_review\11_PHASE_0A_SECURITY_MIGRATION_PROPOSED.sql' `
  -Destination 'supabase\migrations\209901010000_phase_0a_database_boundary_security.sql'
supabase db reset --local
supabase db query --local --file 'docs\security\phase_0a_database_boundary_review\14_DISPOSABLE_TWO_TENANT_SEED_PROPOSED.sql' --output json
supabase db query --local --file 'docs\security\phase_0a_database_boundary_review\06_RLS_AND_ROLE_TESTS_PROPOSED.sql' --output json
```
## 11. Prove migration-chain reset, preserve evidence, and destroy the lab

Retain only redacted test summaries, migration hashes, and pass/fail results. Do not commit fixture database files or local secrets. Stop the local stack, then remove the exact lab directory through the approved recoverable workspace-cleanup process.
