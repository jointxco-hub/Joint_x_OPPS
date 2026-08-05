# Phase 0A Regression Tests - Proposed, Unexecuted

## Database security tests

- Run `06_RLS_AND_ROLE_TESTS_PROPOSED.sql` against the schema-matched, seeded disposable clone.
- Confirm `anon` cannot query any internal view or explicit-tenant RPC.
- Confirm Tenant A direct views/RPCs contain only Tenant A rows; repeat for Tenant B.
- Confirm an app admin without requested-tenant membership receives no rows.
- Confirm RLS policies still evaluate required helpers after `PUBLIC` execution is removed.
- Confirm authenticated clients cannot directly execute `assign_purchasing_tenant`.
- Confirm the hostname-bound storefront RPC remains executable by `anon` and passes existing storefront tests.
- Run file 15 and require one generic error for missing/cross-tenant supplier/order parents while ordinary same-tenant operations succeed and roll back.

## View/RPC output contracts

- `active_orders` and `get_active_orders_for_tenant` retain the approved 25-column contract.
- `v_orders` and `get_orders_for_tenant` retain the approved 33-column contract.
- `v_purchase_orders` and `get_purchase_orders_for_tenant` retain the approved 16-column contract.
- Direct authenticated SELECT remains temporarily for unidentified consumer compatibility, but each view enforces tenant membership and `anon` has no access.
- No client response acquires a new tenant, supplier, inventory, or internal-note field.

## OPPS application contracts

- Orders list/drawer: order identity, client identity, broad `status`, `pipeline_stage`, production detail fields, dates, totals, products, assignments, files, and archive behavior.
- Purchase Orders: number, supplier, project/order links, status, items, total variants, dates, comments, and archive fields.
- Suppliers: required name/type, contacts, location/address, payment/lead-time/cost metadata, products, preferred/archive fields, category, and notes.
- Inventory: preferred supplier, archive state, cost/location, quantities, and selection behavior.
- Client catalog: intentionally public storefront fields only; no internal supplier or stock identity.

Do not alter broad order statuses, production stages/methods/details, client-facing updates, or internal hold-up notes.

## Archived inventory reference

The authorized read-only review is complete: archive occurred after order creation, the order is no longer operationally active, historical name/size/colour/quantity are present, and no exception marker exists. Preserve the historical reference, block only new selection, and do not add an exception or alter the row.

## No-data-change and rollback proof

- Compare orders, inventory, suppliers, and purchase-order row counts and cryptographic hashes before/after migration.
- Compare `current_stock` totals exactly.
- Confirm no status, pipeline, production, line, archive, cost, tenant, or business value changes.
- Exercise file 08; rollback fails if it restores `anon`/`PUBLIC` exposure or weakens the retained tenant predicate.
- Reapply file 11 and repeat tests/hashes to prove idempotent deployment.
