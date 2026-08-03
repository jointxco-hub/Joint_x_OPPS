# Remote Supplier and Purchase-Order Baseline Plan

## Confirmed deployed supplier structure

The remote `public.suppliers` table has RLS enabled and includes:

- `id uuid NOT NULL`, primary key;
- `name text NOT NULL`;
- `type text NOT NULL`;
- nullable location/address, contact, delivery/cost, lead-time, payment, archive, timestamp, and `tenant_id` fields;
- `contacts jsonb` and `products jsonb`;
- tenant foreign key and tenant index;
- type and payment-term checks;
- tenant-assignment trigger and authenticated tenant policy.

The repository has no authoritative `CREATE TABLE public.suppliers`. Later migrations and `dataClient.js` assume it exists. The serializer writes `name`, contact fields, `type`, location/address, JSON contacts/products, payment terms, lead-time/cost fields, preferred/archive fields, category, and notes; it aliases `name` to `vendor` when reading.

Exact deployed column defaults, constraint expressions/names, indexes, trigger definitions, policies, and grants must be attached from a separately authorized schema-only/catalog capture. This package does not reconstruct missing details from application guesses.

## Confirmed deployed purchase-order structure

Remote `public.purchase_orders` materially exceeds the checked-in create/patch migrations. Confirmed drift includes:

- `supplier_ids uuid[]` in addition to supplier linkage;
- `tax` and additional monetary/date fields;
- supplier, project, linked-order relationships;
- globally unique `po_number`;
- tenant ownership, tenant trigger/index, RLS, and authenticated tenant policy.

The checked-in serializer reads/writes `po_number`, supplier ID/name, project/order links, status, JSON items, notes, subtotal/total variants, order/expected/received dates, comments, and archive fields. It normalizes `expected_date`/`expected_delivery`, `linked_order_id`/`order_id`, and `total`/`total_amount`; line serialization permits an absent `inventory_item_id`.

## Reconciliation recommendation

1. Capture a schema-only remote manifest containing columns, defaults, identity, constraints, indexes, triggers, RLS flags, policies, grants, and dependent views/functions. Redact role/project identifiers where necessary.
2. Commit human-readable baseline documentation before writing reconciliation DDL.
3. Create an additive reconciliation migration only for repository environments missing confirmed deployed fields. It must use preflight assertions and must not rewrite production tables.
4. Update serializers only where a confirmed deployed field has an intentional application contract. Do not serialize every remote column automatically.
5. Update disposable test fixtures to satisfy deployed non-null/check constraints.
6. Generate a clean database from repository migrations and compare it structurally with a schema-only production snapshot.

Recommended outcome: baseline documentation plus an additive reconciliation migration and fixture updates. A destructive table recreation is not acceptable.

## Phase 1 inventory changes required by drift

- `07_TWO_TENANT_TESTS_PROPOSED.sql` now supplies the required supplier `type`; validate that `blanks` is accepted by the deployed check before executing the fixture.
- `inventory_supplier_products.supplier_id` cannot safely use a composite foreign key until a reviewed unique `(tenant_id, id)` key exists on suppliers. Keep the validation trigger for now or add that key in a separately approved additive baseline migration.
- `inventory_phase1_validate_supplier_product()` currently distinguishes a missing supplier and includes its identifier in an error. Change it to one generic missing/cross-tenant error before Phase 1 approval.
- Legacy mapping reads must continue joining suppliers by both `id` and `tenant_id`; nullable remote supplier tenant IDs are not valid Phase 1 parents.
- Inventory preflight/rollback must account for the deployed preferred-supplier FK with `ON DELETE SET NULL` and its index; Phase 1 must neither recreate nor drop them.
- PO audit code must recognize deployed `supplier_ids`, tax/amount/date variants, and global `po_number` uniqueness. Phase 1 must not infer the remote PO shape from the incomplete checked migration.
- Blank order/PO line `inventory_item_id` values remain absent optional links. Only nonblank invalid UUID text is malformed.

## Baseline acceptance criteria

- Clean-build and deployed schemas differ only by documented, intentional data-state details.
- No reconciliation step updates existing supplier, PO, order, or inventory rows.
- Existing supplier, inventory, purchasing, and order screens pass their field-contract tests.
- Tenant triggers reject cross-tenant or unresolved parents with the same generic error.
- No new anonymous relation or function privilege is introduced.
