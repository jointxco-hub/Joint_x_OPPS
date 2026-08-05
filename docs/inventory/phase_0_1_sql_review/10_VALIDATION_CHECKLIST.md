# Phase 0/1 SQL Review and Validation Checklist

No step authorizes the next step implicitly. Creating migration files and applying them require separate explicit approvals.

## A. Static package review

- [ ] Confirm every file remains under `docs/inventory/phase_0_1_sql_review/`.
- [ ] Confirm no similarly named file exists under `supabase/migrations/`.
- [ ] Confirm the proposal never alters, updates, renames, replaces, or adds triggers to `public.inventory`.
- [ ] Confirm no balance, movement, reservation, allocation, receipt, pick, or issue table/function exists in the package.
- [ ] Confirm internal product and internal variant tables contain no physical quantity fields.
- [ ] Confirm supplier identity is absent from public storefront RPCs and grants.

## B. Required review sequence

1. [x] Run and review `01_REMOTE_SCHEMA_AUDIT.sql` under separately authorized read-only access.
2. [x] Compare the remote report with checked-in schema/migrations, documenting confirmed drift in `12_REMOTE_AUDIT_RESULTS_REDACTED.md` and `13_REMOTE_SCHEMA_COMPARISON.md`.
3. [x] Run and review `02_DATA_QUALITY_AUDIT.sql` under separately authorized read-only access; treat blank optional inventory references separately from malformed nonblank UUIDs.
4. [x] Save redacted per-tenant row counts and one-way quantity-total baseline hashes; retain exact totals only in the controlled audit output.
5. [ ] Review `03_IDENTITY_FOUNDATION_PROPOSED.sql`, including names, fields, constraints, indexes, and trigger safety.
6. [ ] Review `04_LEGACY_MAPPING_WORKSPACE_PROPOSED.sql`, source immutability, version history, staging validation, and absence of legacy writes.
7. [ ] Review `05_PHASE1_READ_MODELS_PROPOSED.sql`, PostgreSQL view compatibility, matched-field search output, and storefront isolation.
8. [ ] Review every tenant relationship and supplier-tenant validation path.
9. [ ] Review `06_RLS_AND_GRANTS_PROPOSED.sql`, including app-admin operational tenant context and reviewer-role semantics.
10. [ ] Review `07_TWO_TENANT_TESTS_PROPOSED.sql` and confirm its supplier fixture matches the actual remote supplier schema.
11. [ ] Review `08_DATA_INTEGRITY_TESTS_PROPOSED.sql` and all structural assertions.
12. [ ] Review `09_ROLLBACK_PROPOSED.sql`, backup/recovery point, feature flag, and mapping-history preservation.
13. [ ] Resolve or explicitly defer every item in `11_OPEN_DECISIONS.md`.
14. [ ] Review and separately authorize remediation for anonymous access to owner-executed `active_orders`, `v_orders`, and `v_purchase_orders`; do not bundle an unreviewed fix into Phase 1.
15. [ ] Review and separately authorize revoking default `PUBLIC` execution from internal helper functions, while retaining intentional storefront access.
16. [ ] Add a reproducible checked-in baseline for the confirmed remote supplier and purchase-order schema before migration finalization.

## C. Disposable-environment validation only

- [ ] Obtain owner authorization to create temporary migration copies outside production.
- [ ] Restore or create a disposable Supabase environment matching the audited remote PostgreSQL version/extensions.
- [ ] Capture the disposable legacy row-count and quantity baseline.
- [ ] Apply proposed files 03 through 06 only in the disposable environment.
- [ ] Execute `07_TWO_TENANT_TESTS_PROPOSED.sql`; retain complete output.
- [ ] Execute `08_DATA_INTEGRITY_TESTS_PROPOSED.sql`; retain complete output.
- [ ] Run search cases for `JET`, `Joint X Essential Tee`, `Daniel Slaves`, `Daniel Slaves 220gsm`, internal SKU, supplier SKU, GSM, colour, and size; verify `matched_field`.
- [ ] Verify anonymous direct access and anonymous function execution fail.
- [ ] Verify a normal member cannot approve or revise a mapping.
- [ ] Verify a tenant owner/admin can act only inside an accessible tenant.
- [ ] Verify an app admin without membership/access to the requested operational tenant cannot act.
- [ ] Re-run legacy row counts and `current_stock` totals; compare exactly with baseline.
- [ ] Confirm every existing application route still uses only its pre-existing objects.
- [ ] Exercise `09_ROLLBACK_PROPOSED.sql` on an empty fixture and on a fixture containing reviewed history; verify history is retained in the latter case.

## D. Migration-creation authorization gate

- [ ] Owner approves the final SQL text, resolved assumptions, test evidence, and rollback evidence.
- [ ] Owner explicitly authorizes creating actual timestamped files under `supabase/migrations/`.
- [ ] The migration PR contains only reviewed inventory files and intentional dependencies.
- [ ] CI/disposable tests pass from a clean database and an audited upgrade snapshot.

## E. Migration-application authorization gate

- [ ] Owner separately authorizes applying the reviewed migration.
- [ ] Backup/recovery point is confirmed.
- [ ] Feature flag remains off and new grants/routes have no unintended consumer.
- [ ] Deployment operator records target project, migration hash, start/end time, and result.
- [ ] Post-apply RLS, two-tenant, row-count, and quantity-total validation passes.

## F. Phase 2 boundary

Separate approval is still required for opening balances, supplier-variant physical balances, demand reservations, allocations, movements, receiving, picking, issuing, returns, counts, transfers, and any production workflow integration.
