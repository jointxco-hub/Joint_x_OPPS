# Schema Provenance

## Confirmed remote/catalog facts

- The three view definitions, dependency tables, column order, and column counts come from the finalized read-only catalog audit.
- `suppliers` has UUID identity, required `name` and `type`, JSON contacts/products, purchasing metadata, archive metadata, timestamps, and later tenant ownership.
- `purchase_orders` has `supplier_ids`, `supplier_id`, `tax`, amount/date variants, project/order relationships, globally unique `po_number`, archive metadata, and later tenant ownership.
- `inventory` has a preferred-supplier relationship and later tenant ownership; Phase 0A requires only the legacy row shape used by its prepared seed/test.
- PostgreSQL 17.6 supports security-invoker views.

Sources: files 01, 04, 11, and 13 in the parent Phase 0A package.

## Checked-in SQL facts

The remaining table names and referenced columns are taken from SQL under `supabase/migrations`. The bootstrap does not reproduce objects that those migrations create completely. It supplies only tables/columns referenced before any authoritative create exists.

Key references include the finance upgrade, client/request/readiness functions, tenant foundation and ownership migrations, storefront backend, XOS functions, expense capture, and the prepared Phase 0A seed/tests.

The finance budget/buying definitions are copied from the checked-in finance upgrade because the finance RLS filename sorts earlier and requires those relations first.

## Inferred minimum definitions

Exact remote definitions were not captured for `users`, `clients`, `projects`, `orders`, `transactions`, task/file metadata tables, order-support tables, money-model snapshots, or the client request/readiness support tables. Their nullable columns, defaults, and limited foreign keys in file 02 are inferred solely to compile the checked-in chain and tests.

The following types are inferred and require disposable validation before approval: `orders.file_urls` JSONB, `orders.assigned_team` JSONB, numeric inventory stock, free-text supplier metadata, and generic JSON snapshot storage.

No inferred definition is represented as an exact deployed fact. A future authorized schema-only catalog capture may replace these definitions after redaction and review.

## Intentional purchase-order overlap

The repository does create `purchase_orders`, but its definition is insufficient for the confirmed remote/Phase 0A contract. The bootstrap pre-creates the minimum superset so the later `CREATE TABLE IF NOT EXISTS` and additive patches remain idempotent. This is a disposable compatibility technique, not a proposed production reconciliation.


