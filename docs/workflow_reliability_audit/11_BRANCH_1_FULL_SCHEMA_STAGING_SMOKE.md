# Branch 1 — Full-Schema Staging Smoke

## Verdict

The staging check requested in `10_BRANCH_1_STAGING_VERIFICATION.md` — repeating the reliability guarantee against the complete historical OPPS schema rather than a minimal synthetic one — is functionally complete.

> A failed invoice load or failed invoice update did not erase previously saved invoice line items, and this now holds against the full 66-migration production-shaped schema, not only the minimal disposable schema used in the prior verification.

Branch: `fix/invoice-item-reliability`

Recommendation: unchanged from `10_BRANCH_1_STAGING_VERIFICATION.md` — merge is recommended for the Branch 1 scope after normal code review, and the additive RPC migration (`202608020001_invoice_item_atomic_persistence.sql`) must be applied to a real staging/production-equivalent project before the client is deployed. No merge, deployment, or production operation occurred while producing or completing this report.

## Why a second staging pass was needed

`10_BRANCH_1_STAGING_VERIFICATION.md` intentionally used a minimal disposable schema containing only the tables the RPC touches directly. That proved the transaction, RLS, and authorization logic in isolation, but it could not prove that the RPC still behaves correctly once every historical migration, trigger, legacy constraint, and policy in the real chain is present — including constraints the RPC does not own and cannot assume are identical across environments.

This pass reconstructs the full migration history (all 66 files under `supabase/migrations/`, ending with the Branch 1 additive migration) in a disposable local Postgres/Supabase stack and repeats the reliability checks against that reconstructed schema, plus a real-browser pass against the same stack.

## Reusable artifacts produced

- `supabase/tests/invoice_item_full_schema_staging_smoke.sql` — SQL smoke test that seeds two tenants, a pre-Branch-1 invoice with two items, an approved invoice, a template, a linked order, and a Tenant B invoice directly against the full reconstructed schema, then exercises the RPC and RLS through it. Ends with `rollback;`, so it leaves no residue when run against a disposable database.
- `supabase/tests/invoice_reliability_browser_full_schema_seed.sql` — seed used to give a real local-Supabase-Auth browser user a draft invoice with two items under the full schema, for the browser pass.
- `docs/workflow_reliability_audit/evidence/full_schema_staging/*.png` — five screenshots from the browser pass against the full-schema stack (see below).

Both SQL files are additive fixtures only; neither was left applied to any persistent database.

## What the full-schema SQL smoke proves

`invoice_item_full_schema_staging_smoke.sql` runs as one transaction, rolled back at the end, and covers:

| Check | Result |
| --- | --- |
| A pre-existing (pre-migration) draft invoice with two items remains fully readable after the migration | Verified |
| Saving that invoice with unchanged items leaves totals, the linked template's active state, item-version history, and activity history byte-for-byte unchanged | Verified |
| Creating a new invoice from an order preserves `source_order_id` and both order-derived lines after a simulated reopen | Verified |
| A line with quantity `0` is rejected (`23514`/constraint-shaped failure) and leaves the existing header and items completely unchanged | Verified |
| Attempting to update an approved invoice is rejected with `INVOICE_NOT_EDITABLE` | Verified |
| Tenant A can read Tenant A's rows and cannot see any Tenant B row | Verified |
| Tenant B can read Tenant B's rows and cannot see any Tenant A row | Verified |
| A staff user without finance/admin authorization is rejected with `INVOICE_ACCESS_DENIED` when attempting to save | Verified |
| `EXECUTE` on `save_opps_invoice_with_items` is present for `authenticated` only, and absent for `public`, `anon`, and `service_role` | Verified |

Final statement returned: `ALL_FULL_SCHEMA_STAGING_SMOKE_TESTS_PASSED`.

## Defect found and fixed during this pass

**Missing RPC-side validation for zero quantities under the full schema.**

The minimal schema used in `10_BRANCH_1_STAGING_VERIFICATION.md` happened to reject a zero-quantity line through a legacy table constraint, so the RPC itself did not need its own check to pass that test. Against the full historical schema, that legacy constraint's shape could not be relied on to be identical in every environment. `save_opps_invoice_with_items` now enforces the line invariants itself before writing, independent of the legacy table constraint:

```sql
-- Mirror the editor's required line invariants here instead of relying on
-- legacy table constraints, which vary between full-schema installations.
if exists (
  select 1
  from jsonb_array_elements(v_items) as item_rows(source_item)
  where nullif(pg_catalog.btrim(source_item->>'item_name'), '') is null
    or coalesce(nullif(source_item->>'quantity', '')::numeric, 0) <= 0
    or coalesce(nullif(source_item->>'rate', '')::numeric, 0) < 0
) then
  raise exception using errcode = '23514', message = 'INVOICE_ITEM_INVALID_VALUES';
end if;
```

This is in `supabase/migrations/202608020001_invoice_item_atomic_persistence.sql` and is exercised by the zero-quantity case in the full-schema SQL smoke above. It does not change behavior against the minimal schema — it makes the same guarantee schema-independent.

## Browser pass against the full schema

The real OPPS application was run against the reconstructed full-schema stack with a real local-Supabase-Auth browser user and the seed above.

| Screenshot | Shows |
| --- | --- |
| [invoice-reliability-list.png](evidence/full_schema_staging/invoice-reliability-list.png) | Invoice list rendering `TEST-A-DRAFT` from the full-schema stack |
| [invoice-reliability-detail-two-items.png](evidence/full_schema_staging/invoice-reliability-detail-two-items.png) | Invoice detail opened with both seeded items visible |
| [invoice-reliability-save-success.png](evidence/full_schema_staging/invoice-reliability-save-success.png) | Quantity edited and saved; server-confirmed quantity and `Invoice saved` toast |
| [invoice-reliability-protected-load-failure.png](evidence/full_schema_staging/invoice-reliability-protected-load-failure.png) | Forced detail-load failure; protected read-only view with Retry/Open read-only summary/Close, no edit or save exposed |
| [invoice-reliability-transaction-failure.png](evidence/full_schema_staging/invoice-reliability-transaction-failure.png) | Invalid line (quantity/amount) rejected from the create-flow Finish step with actionable toast; editor stays open with entered values retained |

These five screenshots reproduce the same guarantees as the browser section of `10_BRANCH_1_STAGING_VERIFICATION.md`, this time against the full schema and, for the failure case, through the multi-step create-flow wizard rather than only the detail drawer.

## Fresh checks rerun for this report

The two checks Codex could not finish before its execution quota was exhausted were rerun directly against the current worktree state (`fix/invoice-item-reliability`, HEAD `daba509` plus the uncommitted Branch 1 changes) with no database or browser dependency:

```text
npm run test:invoice-reliability
13 tests passed, 0 failed

npm run build
exit code 0 (only pre-existing dependency-age notices for
baseline-browser-mapping and Browserslist data, unrelated to this branch)
```

Both match the results already recorded in `09_BRANCH_1_INVOICE_ITEM_RELIABILITY_IMPLEMENTATION.md` and `10_BRANCH_1_STAGING_VERIFICATION.md`.

## Disposable environment status

At the time this report was written, Docker Desktop's service (`com.docker.service`) was stopped and no `supabase status` connection was available. No disposable container, disposable Supabase stack, or browser-automation process tied to this work was found running. The "stop the disposable local processes and Supabase stack" cleanup step from the interrupted session therefore required no action — there was nothing left running to stop.

## Regression scope and limitations

Same limitations as `10_BRANCH_1_STAGING_VERIFICATION.md` section "Regression scope and limitations" continue to apply: opening the generated PDF in a second browser target, production-equivalent template/catalog *data volumes* (as opposed to schema), and a real linked-order invoice summary beyond the synthetic order used here were not exercised.

Additionally specific to this pass: the exact disposable-stack identifiers (container name, local Supabase project ref, port bindings) used during the original full-schema run were not preserved outside the prior session, so they are not restated here. The SQL and seed fixtures above are reusable and were written to be rerun against a fresh disposable stack without needing those identifiers.

## Production rollout recommendation

Unchanged from `10_BRANCH_1_STAGING_VERIFICATION.md`:

1. Review and merge the branch through the normal process.
2. Apply the additive RPC migration to a full-schema staging project before deploying the client.
3. Repeat the short two-item happy path, forced constraint failure, approved-invoice read, and two-tenant rejection checks in that staging project.
4. Confirm the staging function metadata/ACL matches the reports in this folder.
5. Deploy the client only after the RPC is available.
6. Monitor `[invoice-reliability]` events for load failures, blocked saves, transaction failures, and count mismatches.

Production was not contacted or modified while producing this report. No remote migration, merge, deployment, or destructive table rollback occurred.
