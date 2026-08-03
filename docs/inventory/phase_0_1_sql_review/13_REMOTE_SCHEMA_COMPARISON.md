# Remote vs Checked-in Schema Comparison

**Comparison date:** 2026-07-26  
**Source:** Redacted results in `12_REMOTE_AUDIT_RESULTS_REDACTED.md`, checked-in SQL, and the Phase 0/1 proposal.  
**Status:** Review findings only; no remediation applied.

## Confirmed matches

| Area | Remote result | Checked-in/proposal conclusion |
| --- | --- | --- |
| Legacy inventory shape | Flat product/variant text, one nullable `current_stock`, arrays, supplier ID, free-text location | Audit diagnosis confirmed. Keep legacy authoritative through Phase 1. |
| Inventory RLS | Enabled with `tenant_manage_inventory` using `can_access_tenant(tenant_id)` | Tenant policy migration is present remotely. Do not weaken it. |
| Inventory triggers | Tenant assignment plus updated-at | Proposal correctly avoids adding a trigger to `public.inventory`. |
| Global legacy SKU | Remote `UNIQUE (sku)` | Audit finding confirmed; new internal/supplier SKU indexes must be separate and tenant-scoped. |
| Supplier JSON catalog | `suppliers.products jsonb` exists | It is not an exact normalized supplier-product identity. |
| Tenant helpers | `current_user_tenant_ids`, `can_access_tenant`, and `is_app_admin` exist | Proposal may depend on them but must retain explicit operational-tenant checks. |
| PostgreSQL support | PostgreSQL 17.6 | Proposed security-invoker views are supported. |
| Proposed objects | None exists remotely | Additive names do not currently collide. |

## Confirmed schema drift or missing repository baseline

### 1. Suppliers table baseline is absent from migrations

Remote `suppliers` is confirmed with:

- `id uuid NOT NULL`
- `name text NOT NULL`
- `type text NOT NULL`
- nullable `location`, `address`, delivery/cost metadata, `contacts`, `products`, payment terms, archive fields, timestamps, and `tenant_id`
- primary key, tenant FK, type/payment-term checks, RLS, tenant trigger, and tenant index

No checked-in migration creates this baseline table. The proposal's `(id, tenant_id, name)` test assumption was incomplete because `type` is also required.

**Required package change:** test fixtures must insert a valid supplier `type`; the remote supplier schema must be captured in a future baseline migration before production Phase 1 migration creation.

### 2. Inventory FK/index drift

Remote inventory has:

- `inventory_preferred_supplier_id_fkey` with `ON DELETE SET NULL`;
- `idx_inventory_preferred_supplier_id`;
- tenant FK/index and global SKU uniqueness.

The preferred-supplier FK/index are not reproducible from checked-in SQL located during comparison.

**Required package change:** treat the remote FK as an existing dependency in preflight and rollback documentation. Do not recreate or drop it in Phase 1.

### 3. Purchase-order drift

Remote purchase orders include `supplier_ids uuid[]`, `tax`, additional dates/amount fields, supplier/project/order links, and a globally unique `po_number`. The checked-in creation/patch migration does not fully reproduce that remote shape.

**Required package change:** Phase 1 audit/mapping queries must use runtime column discovery or the confirmed remote shape and must not assume the checked-in PO DDL is complete.

### 4. Unreproducible legacy views

`v_orders` and `v_purchase_orders` are present remotely but were not located in checked-in SQL. `active_orders` is checked in without tenant-safe security-invoker configuration. All three currently have broad anonymous grants remotely.

**Required package change:** add a Phase 0 blocker requiring a separate security review and remediation before any new inventory read models are exposed. New Phase 1 views must retain `security_invoker = true` and explicit no-anon grants.

### 5. Function grant hardening is incomplete

Checked-in migrations revoke execute from `anon` on tenant helpers but do not revoke the default execute privilege from `PUBLIC`. Remote privilege checks confirm anonymous execute remains effective.

**Required package change:** retain `REVOKE ... FROM PUBLIC, anon` in proposed Phase 1 SQL and add structural tests for both. Existing helper remediation is a separate Phase 0 security change.

### 6. Tenant columns remain nullable

Remote `inventory`, `suppliers`, `purchase_orders`, `orders`, and `products` have nullable `tenant_id`, although the audited inventory rows currently contain no null tenants.

**Required package change:** all new Phase 1 tables keep `tenant_id NOT NULL`. Do not tighten legacy tables within this Phase 1 identity migration.

## Data-driven proposal changes

1. Treat blank JSON `inventory_item_id` values as absent optional links, not malformed identifiers.
2. Preserve a separate defect for the one active order referencing archived inventory.
3. Require review for every legacy supplier mapping because all 41 rows lack `preferred_supplier_id`.
4. Do not auto-create structured locations; every row lacks structured evidence.
5. Do not infer missing costs for 22 rows.
6. Do not bulk-change the 38 reorder-point-10 rows during identity migration.
7. Preserve the 5 exact and 6 near-duplicate name groups as review queues.
8. Retain all raw legacy names/SKUs because naming variation is confirmed.

## Required approval sequence change

Before disposable-environment execution of proposed files 03-06:

1. Review the legacy-view anonymous exposure and approve a separate remediation plan.
2. Review `PUBLIC` execute hardening for internal tenant helpers.
3. Baseline the remote suppliers and purchase-order schemas in a reproducible migration plan.
4. Correct the proposed test fixture and data-audit blank-reference classification.
5. Re-run static review of the amended package.

These findings do not authorize any security, schema, grant, data, or application change.
