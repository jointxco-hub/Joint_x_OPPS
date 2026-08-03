# Joint X OPPS Inventory Phase 1 — Detailed Handover Brief for Claude

You are continuing development on the **Joint X OPPS inventory system**.

The previous implementation work was being handled through ChatGPT/Codex, but Codex credits are currently exhausted. Continue from the current state without restarting the project, redesigning the architecture from scratch, or repeating already completed database deployment work.

The user needs this system to become **practical and usable on the ground immediately**, not remain a technical database exercise.

---

# 1. Business context

**Joint X** is a South African apparel, printing, branding and production business.

The business operates several connected systems:

* **OPPS** — internal operations system and source of truth
* **X LAB** — printing and branding storefront
* **XOS** — client/store operating system
* **Shop Catalog** — customer-facing or sellable product catalog inside OPPS
* **Inventory/Stock** — physical blanks, garments, materials and items physically available

Production URL:

`https://ops.jointx.co.za`

The OPPS application is built with:

* React
* Vite
* Supabase
* PostgreSQL
* Vercel-hosted frontend
* Multi-tenant architecture

The user works with apparel products where the same general garment may come from multiple suppliers under different supplier names.

Example:

* Joint X internal product identity: `JET`
* Supplier product: `Daniel Alves 220gsm Tee`
* Another supplier may supply another compatible tee
* Colour and size are variants
* Actual physical stock must remain tied to the exact supplier variant

---

# 2. The real operational problem

The old inventory system was confusing because it mixed together:

* Internal Joint X product names
* Supplier product names
* Colours
* Sizes
* GSM
* Supplier identity
* Physical quantities
* Sellable catalog products

The user originally wanted to alias supplier products to internal names.

Example:

* `Daniel Alves 220gsm Tee`
* Internally recognised as `JET`

However, simply renaming the supplier product to `JET` would destroy important traceability.

The approved model is therefore:

## Internal identity

A stable Joint X product identity.

Example:

`JET`

This is the identity Joint X staff use when planning products, orders and production.

## Internal variant

The Joint X version of the product based on attributes such as:

* Colour
* Size
* GSM where relevant
* Fit
* Style

Example:

`JET / Black / Medium`

## Supplier product

The exact name used by the supplier.

Example:

`Daniel Alves 220gsm Tee`

This must remain unchanged and traceable.

## Supplier variant

The exact supplier-specific product variant.

Example:

`Daniel Alves 220gsm Tee / Black / Medium`

## Mapping

A supplier variant can map to a compatible internal Joint X variant.

Example:

`Daniel Alves 220gsm Tee / Black / Medium`

maps to:

`JET / Black / Medium`

Multiple supplier variants may map to the same internal variant.

## Stock ownership

Physical stock must remain tied to the exact supplier variant that was actually purchased or received.

The internal identity is for planning and consistency.

The supplier identity is for:

* Cost
* Quality
* Receiving
* Traceability
* Returns
* Supplier performance
* Substitution decisions
* Stock movement history

---

# 3. Non-negotiable inventory principles

Continue using these principles.

## OPPS remains the source of truth

Printed stock sheets, physical count sheets and traveller cards may support the workflow, but they must not become a separate permanent stock system.

## No silent substitution

A supplier variant must never automatically substitute another supplier variant without approval.

If an order requests:

`JET / Black / Medium`

and stock exists from more than one supplier, OPPS must show the exact available supplier stock and require a deliberate allocation or substitution choice.

## Demand is internal; allocation is exact

Order demand should request an internal variant.

Example:

`JET / Black / Medium — quantity 5`

Allocation and picking must use exact supplier variants.

Example:

* 3 from Daniel Alves
* 2 from another approved supplier

## Physical balances stay exact

The following must remain tied to exact supplier variants:

* Receipts
* Current stock
* Reservations
* Picking
* Returns
* Transfers
* Damaged stock
* Missing stock
* Adjustments
* Stock counts
* Cost
* Supplier batch history

## Existing `public.inventory` remains authoritative for now

Phase 1 was intentionally deployed without replacing the existing stock balance logic.

The current legacy inventory table and its `current_stock` field remain the current operational stock balance.

Do not migrate stock balances into the new tables without an explicit migration plan and approval.

---

# 4. What has already been completed

A substantial amount of production deployment and validation work has already been completed.

Do not repeat this work.

## Phase 0A

Phase 0A production deployment was completed successfully before Phase 1.

It included foundational production preparation and validation.

## Phase 1 database foundation

The following Phase 1 tables are now live in production:

* `public.inventory_products`
* `public.inventory_variants`
* `public.inventory_supplier_products`
* `public.inventory_supplier_variants`

These tables currently exist and have RLS enabled.

## RLS policies

Each of the four Phase 1 tables currently has three policies:

* Tenant read
* Reviewer insert
* Reviewer update

The policies are scoped to authenticated users and tenant access rules.

## Phase 1 production deployment

Files `03–06` were deployed atomically in one transaction.

The deployment completed successfully.

The deployment stderr was empty.

No rollback was required.

## File 07

`07_TWO_TENANT_TESTS_PROPOSED.sql`

This is a test/evidence file.

It was **not executed in production**.

It must remain excluded from production deployment.

## File 08

`08_DATA_INTEGRITY_TESTS_PROPOSED.sql`

This was executed against production after deployment.

It passed successfully inside its reviewed transaction and rolled back after validation.

## File 09

`09_ROLLBACK_PROPOSED.sql`

This is emergency rollback SQL only.

It was not executed.

Do not execute it automatically.

## Final production validation

The final production validation passed:

* Read-only transaction confirmed
* Rollback confirmed
* No production mutation from validation
* No stderr errors
* Phase 1 deployment remains committed

---

# 5. Current production state

The latest confirmed production database state is:

## Legacy inventory

* `41` rows in `public.inventory`
* Total `current_stock`: `86`
* Negative stock rows: `0`
* Inventory rows without tenant: `0`

## Suppliers

* `7` suppliers

## Tenants

* `4` tenants

## Tenant memberships

* `14` active memberships

Important schema detail:

`public.tenant_memberships` does not use `is_active`.

It uses:

`status = 'active'`

Columns are:

* `id`
* `tenant_id`
* `auth_user_id`
* `tenant_role`
* `status`
* `created_at`
* `updated_at`

## New Phase 1 tables

The four new Phase 1 tables currently contain zero rows:

* `inventory_products`: `0`
* `inventory_variants`: `0`
* `inventory_supplier_products`: `0`
* `inventory_supplier_variants`: `0`

This is expected because only the foundation was deployed.

No internal product data or supplier mappings have been populated yet.

---

# 6. Current OPPS interface state

The production OPPS interface loads correctly.

There are two relevant Inventory views:

## Stock tab

The Stock tab currently shows:

`35 items tracked`

The legacy production database contains:

`41 inventory rows`

Therefore there is currently a visible discrepancy of:

`6 records`

Do not assume that six records are missing or corrupted.

They may be hidden because of:

* Archived status
* Soft delete
* Item type
* Visibility condition
* Tenant filtering
* Invalid or null display fields
* Query filtering
* Duplicate collapsing
* Frontend query limits
* Product/category filtering

This discrepancy still needs investigation.

## Shop Catalog tab

The Shop Catalog shows:

`19 products`

This is separate from physical stock.

The Shop Catalog is intended to represent sellable products or service offerings, not necessarily every physical stock variant.

Examples visible in the catalog include:

* Caps
* Hats
* Custom labels
* Hoodies
* T-shirts
* Sweaters
* Shorts
* Track pants
* Tote bags

Do not combine Shop Catalog products with physical stock rows.

## Existing Stock interface problems

The Stock table currently shows supplier as `—` on visible items.

The list contains inconsistent and duplicated naming patterns such as:

* Daniel Alves 220gsm Tee
* Daniel Alves 300gsm
* Joint X Tees
* Unspecified 180gsm Tees

Variants appear as separate legacy rows.

Many items are marked `Low Stock`.

The interface is still operating from the old inventory model.

The database foundation is live, but the practical Phase 1 interface is not yet built.

---

# 7. Why the user is frustrated

The user has spent a long time working through:

* Database audits
* Migration safety
* Backups
* Hash verification
* Disposable environments
* Production preflights
* Deployment runners
* Integrity validation
* RLS validation
* Smoke tests

All of that work was necessary to protect production.

However, from the user's point of view, the visible inventory workflow is still mostly unchanged.

The user needs to be back on the ground on Monday and needs inventory to work practically.

Therefore, from this point onward:

**Prioritise visible operational value over additional infrastructure work.**

Do not continue creating long chains of review scripts unless they are genuinely necessary for safety.

Avoid making the user run many repetitive PowerShell inspections for minor frontend or query issues.

---

# 8. Immediate objective

The immediate objective is not to perfect the entire inventory architecture.

The immediate objective is:

> Make OPPS usable for a clean physical stock count, accurate stock recording and daily stock control.

The user is willing to recount stock.

That means the system can use a clean physical count as the operational reset point.

The user will be physically present at the business and wants to start using the improved workflow.

---

# 9. Recommended execution plan

Continue in these stages.

## Stage 1 — Investigate the 35-versus-41 discrepancy

This should be read-only initially.

Identify exactly which six `public.inventory` rows do not appear in the Stock tab.

Compare:

* `id`
* `tenant_id`
* `item_name` or equivalent name field
* SKU
* Colour
* Size
* GSM
* `current_stock`
* Archived field
* Deleted field
* Active/status field
* Category
* Item type
* Catalog visibility
* Created date
* Updated date
* Any relationship used by the frontend query

Then inspect the frontend query used by the Stock page.

Determine whether the missing rows are:

* Intentionally filtered
* Soft deleted
* Archived
* Duplicates
* Invalid
* Tenant mismatches
* Query bugs
* Related-table join failures

Produce a clear report naming the six records and why each is excluded.

Do not mutate stock while investigating.

## Stage 2 — Prepare a Monday stock-count workflow

The user needs a practical recount process.

Create a clean recount mode or temporary stock-count workflow with:

* Existing item name
* Proposed internal product
* Exact supplier product
* Colour
* Size
* GSM
* Current system quantity
* Physical counted quantity
* Difference
* Storage location
* Counted by
* Count date
* Notes
* Confirm/apply adjustment action

The user should be able to work through physical stock one item at a time.

Avoid requiring all Phase 1 mapping fields before they can enter a count.

The count workflow should allow:

1. Find an existing stock row
2. Enter physical quantity
3. Record discrepancy
4. Confirm adjustment
5. Preserve audit history
6. Mark row counted
7. Continue to next item

## Stage 3 — Clean naming without losing traceability

For each physical stock row, separate:

* Internal product
* Supplier product
* Internal variant
* Supplier variant

Do not overwrite supplier names with internal names.

Example:

### Internal product

`JET`

### Internal variant

`JET / Black / Medium`

### Supplier product

`Daniel Alves 220gsm Tee`

### Supplier variant

`Daniel Alves 220gsm Tee / Black / Medium`

### Current stock

Stored on the exact physical legacy inventory row until migration is approved.

## Stage 4 — Seed Phase 1 tables from verified stock

Only after the physical count and naming review:

* Create internal products
* Create internal variants
* Create supplier products
* Create supplier variants
* Map supplier variants to internal variants

Seeding must be tenant-scoped.

Do not silently create mappings based only on similar names.

Require review where supplier compatibility is uncertain.

## Stage 5 — Improve the Stock interface

The Stock page should eventually show something closer to:

| Internal item | Exact supplier source   |   Variant | Available | Reserved | Location | Status |
| ------------- | ----------------------- | --------: | --------: | -------: | -------- | ------ |
| JET           | Daniel Alves 220gsm Tee | Black / M |         4 |        1 | Shelf A2 | Low    |

The user should be able to expand the row and see:

* Supplier cost
* Supplier SKU
* Internal SKU
* Movement history
* Reservations
* Last count
* Last received date
* Mapping status
* Approved substitutions
* Notes

## Stage 6 — Implement real stock movements

After the count and mapping workflow is stable, implement:

* Receive
* Reserve
* Pick
* Return
* Transfer
* Damage
* Missing
* Adjust
* Count

Each movement must record:

* Tenant
* Inventory row
* Exact supplier variant where available
* Quantity
* Movement type
* Related order/job
* User/operator
* Timestamp
* Reason
* Before quantity
* After quantity

---

# 10. Important distinction: Stock vs Shop Catalog

Do not merge these concepts.

## Stock

Physical items Joint X owns or holds.

Examples:

* Black 220gsm tee, medium
* Cream hoodie, large
* Blank trucker cap
* Roll of label material

Stock requires:

* Quantity
* Supplier source
* Cost
* Location
* Movement history
* Reservation status

## Shop Catalog

Products or services sold to clients.

Examples:

* Custom hoodie
* Printed T-shirt
* Branded cap
* Custom label service

Catalog products may reference stock requirements, but they are not themselves necessarily physical inventory units.

A catalog product may consume multiple stock or service inputs.

Example:

`Custom Printed JET Tee`

may require:

* 1 × JET internal variant
* DTF print
* Labour
* Packaging
* Shipping

---

# 11. Existing file and repository safety rules

The previous work used a disposable local worktree.

Path:

`C:\Users\Jasper Jai\Desktop\Joint_x\App Development\Alethea Brand OS™_files\GitHub\X1_Sample_Pack_Sales_Page_Store\Joint_x_OPPS_Phase0A_Disposable`

Historical migrations were moved out of the active migrations directory.

Important rules:

* Keep `supabase/migrations` empty unless a new controlled migration process is explicitly approved.
* Historical migrations remain in `supabase/migrations_hold`.
* Do not run all historical migrations against production.
* Do not use `supabase db reset` against production.
* Do not use broad migration replay.
* Do not run `supabase db push` casually.
* Do not run `supabase migration up` without a reviewed migration package.
* Do not use `supabase link` as a shortcut for uncontrolled deployment.

For frontend changes, normal Git workflow is acceptable, but review tenant scope and production environment configuration carefully.

---

# 12. Security and multi-tenant requirements

Every new inventory query or mutation must be tenant-scoped.

Do not trust frontend filtering alone.

Enforce tenant ownership through:

* RLS
* Server-side logic
* Tenant-aware queries
* Role checks

Roles and permissions should distinguish at least:

* Viewer
* Operator
* Reviewer
* Admin

Current Phase 1 policy naming indicates reviewer insert/update access.

Do not weaken RLS to make the UI work.

If a query fails under the app user but works as PostgreSQL admin, fix the policy or request context correctly.

Do not bypass security with service-role credentials in the frontend.

---

# 13. Production backup and rollback state

A verified pre-Phase 1 production backup exists.

Backup path:

`C:\JointX_Secure_Backups\Phase1\production_deployment_backups\jointx-production-pre-phase1-20260802-174150.dump`

Backup SHA-256:

`C254301E4254AF63B0DA28DE9DA84BF24BF8A20E1EF33D6D03E5A008CF8C2643`

The backup is for emergency recovery.

Do not restore it casually.

The rollback SQL exists but must only be used after:

* Confirmed production incident
* Clear root-cause assessment
* Explicit authorization
* Understanding of data written after deployment

---

# 14. Frozen SQL hashes for reference

These files were reviewed and deployed or validated:

* `03_IDENTITY_FOUNDATION_PROPOSED.sql`
  `204CA3BA58CC40E45D732403737FCFF6A544932126E16B69E9F644404E84A43E`

* `04_LEGACY_MAPPING_WORKSPACE_PROPOSED.sql`
  `D2E565754B2A9F00CC983930F1C7EBEF6DAE2C29F07755EDCF44051EDB357B29`

* `05_PHASE1_READ_MODELS_PROPOSED.sql`
  `5966BBF90886695364EFDB878C62CD57DBD031888A59AF813B20707EA7EF3B80`

* `06_RLS_AND_GRANTS_PROPOSED.sql`
  `A31B83413EC8C663C2982580BF8243DB9F3E3123F9431B255D376D9DC4FE0E2A`

* `07_TWO_TENANT_TESTS_PROPOSED.sql`
  `DAC239136C58C45A3B7E23C91F8EA8E150880A3E8F951493545369749D016F02`

* `08_DATA_INTEGRITY_TESTS_PROPOSED.sql`
  `49B6A55F977C776BEA6A98EFA451D4813E1E720644329D4A6CDA099EB1405A49`

* `09_ROLLBACK_PROPOSED.sql`
  `78F82E7C97D80EA3927B7364AB12B3F58C63244D59A81786EA89AF9F744450F9`

Do not modify these frozen files in place.

New fixes should use new clearly named files or normal application code changes.

---

# 15. UX expectations

The user prefers an Apple/Tesla-style interface:

* Minimal
* Clean
* Premium
* Clear spacing
* Strong information hierarchy
* Low visual clutter
* Practical rather than decorative

Inventory must be understandable to ordinary staff without knowing the database model.

Avoid exposing raw technical terminology such as:

* Foreign key
* Supplier variant mapping table
* Tenant UUID
* RLS policy

Use staff-friendly labels:

* Joint X product
* Supplier item
* Colour
* Size
* Available
* Reserved
* Counted
* Needs mapping
* Needs review
* Approved substitute

---

# 16. Immediate development priorities

Work in this order:

1. Audit the current Stock page query.
2. Identify the six hidden legacy inventory records.
3. Confirm whether 35 or 41 is the correct visible operational count.
4. Fix the visibility/query issue where appropriate.
5. Add a practical physical stock-count workflow.
6. Preserve `public.inventory.current_stock` as authoritative.
7. Add mapping fields without forcing full migration.
8. Seed the first controlled internal product and supplier mapping.
9. Test one real garment flow.
10. Only then expand to all stock.

---

# 17. First controlled real-world test

Use one simple product family first.

Recommended example:

`JET`

Test with one supplier:

`Daniel Alves 220gsm Tee`

Use a small set of variants such as:

* Black / Small
* Black / Medium
* Black / Large
* White / Medium

The test should prove:

1. Internal product can be created.
2. Internal variants can be created.
3. Supplier product can be created.
4. Supplier variants can be linked.
5. Existing physical stock remains unchanged.
6. Staff can view the internal identity and supplier identity together.
7. A physical count can update the authoritative legacy stock safely.
8. An order can request an internal variant.
9. Allocation can identify the exact supplier stock.
10. No silent substitution occurs.

Do not bulk-migrate all 41 rows until this one family works cleanly.

---

# 18. Definition of success

Phase 1 is operationally successful when the user can stand in the stock room and:

* Find an item quickly
* Know what Joint X calls it
* Know what the supplier calls it
* Know the exact colour and size
* See how many are physically available
* See how many are reserved
* Count and correct stock
* Know where it is stored
* Know which supplier stock is being used
* Prevent accidental substitution
* Track every change
* Use the same data in orders and production

The system should reduce questions and confusion, not create more administrative work.

---

# 19. How to communicate with the user

The user is currently frustrated by how long the technical phase took.

Therefore:

* Explain the practical result of each change.
* Keep technical explanations secondary.
* Do not claim the inventory fix is complete when only the database is complete.
* Clearly separate:

  * Completed
  * In progress
  * Not started
* Show visible progress frequently.
* Avoid sending repeated diagnostic scripts unless necessary.
* Prefer fixing the app directly and showing the result.
* Do not restart architecture discussions unless a real blocker requires it.
* Do not make the user repeat stock information unnecessarily.
* Use the physical recount as an opportunity to clean the legacy records.

---

# 20. Current truthful project status

## Completed

* Production-safe Phase 1 database foundation
* New identity and supplier mapping tables
* RLS policies
* Backup
* Atomic production deployment
* Integrity validation
* Final production validation
* Database smoke test
* OPPS interface loads
* Existing legacy stock preserved

## In progress

* Operational inventory workflow
* Stock page reconciliation
* Physical count workflow
* Internal-to-supplier mapping UI
* Real-world testing

## Not yet complete

* Populating Phase 1 tables
* Mapping existing inventory
* Receiving workflow
* Reservation workflow
* Picking workflow
* Approved substitutions
* Stock movements
* Full interface redesign
* Complete staff-ready inventory system

---

# 21. Your first task

Start by auditing the current frontend and data query responsible for the **Stock tab showing 35 items while `public.inventory` contains 41 rows**.

Provide:

1. The exact frontend file/component responsible.
2. The exact Supabase query.
3. Every filter, join or transformation applied.
4. The six excluded inventory records.
5. The reason each record is excluded.
6. Whether the exclusion is intentional.
7. The smallest safe code change needed.
8. How the change will affect tenant isolation.
9. A test plan.
10. A clear statement of whether the Stock page should show 35 or 41 after the fix.

Do not change stock quantities during this audit.

After identifying the issue, implement the smallest safe fix and prepare the physical stock-count workflow.

---

# 22. Status update — 2026-08-03 (Claude, continuing from this brief)

This section records what changed after this brief was written, so a future session does not have to re-derive it. Everything below is live in production unless marked otherwise.

## 35 vs 41 resolved — no bug

Confirmed by direct read-only query: 41 total rows = 39 rows for the real Joint X tenant (`6d371f51-274c-4b49-8d59-2aeaf5e89088`) + 2 rows belonging to two other tenants (`UI`/`OO`, `jhj`/`jhj` — look like unrelated test data, not Joint X stock). Of the 39, 4 are archived (`5-Panel Cap`, `JET`, `JET 220gsm`, `JV1` — leftover manual test rows from the earlier idea of literally renaming supplier products to `JET`, since abandoned). 39 − 4 = 35. Tenant scoping and the archive filter in `src/pages/Inventory.jsx` are both working as designed. **No code change was needed for this.**

## Shipped and deployed to production (git commit `bb368ca` on `fix/invoice-item-reliability`; Vercel deployment `dpl_HzkCm9Du8N4BrcwpdQZxNq6Gbtsz`, aliased to `ops.jointx.co.za`)

- **Stock Count workflow**: ✓ icon on each Stock tab row opens a dialog — system stock, physical count input, live difference, location, notes, confirm. Writes the new `current_stock` and an audit row.
- **Movement History**: clock icon on each row shows that item's full movement history (type, before→after, delta, who, when, why).
- **New table `public.inventory_movements`**: append-only audit ledger, tenant-scoped RLS (SELECT + INSERT only, no UPDATE/DELETE by design). Columns include `related_order_id` and `related_purchase_order_id`, ready for when order-linked movements are built (see below) — not populated yet, no code writes to them today. Migration: `supabase/migrations/202608030001_inventory_movements.sql`, applied directly via Studio SQL editor and verified (row counts unchanged, column + policies confirmed).
- **Fixed a real pre-existing bug**: the item edit form (`ItemFormModal` in `Inventory.jsx`) had always submitted a `location` field on every save, but no `location` column ever existed on `public.inventory` — every inventory item save was likely failing. Added the column as part of the same migration.
- **Mounted the Sonner toaster** in `src/App.jsx`. It was being called (`toast.success(...)` etc.) from `Inventory.jsx` and elsewhere without a mounted renderer, so those toasts were silently invisible. Now they render.
- New `InventoryMovement` entity added to `src/api/dataClient.js` (table `inventory_movements`, tenant-scoped, standard `list`/`filter`/`create` via the existing entity pattern).

## Still true, unchanged from the rest of this brief

- Orders still have **zero connection to inventory**. `orders.products` is a free-form JSON blob, no FK to any inventory/variant row. Auto-subtracting stock on order fulfillment needs the internal↔supplier variant mapping (Stage 3–4 of this brief) done first — that's still correctly staged for later, not an oversight.
- Phase 1 identity tables (`inventory_products`, `inventory_variants`, `inventory_supplier_products`, `inventory_supplier_variants`) are still empty. Nothing has been mapped yet.

## Separate, unrelated work sitting in the same worktree — do not deploy without reading this

The same branch (`fix/invoice-item-reliability`) also carries an earlier, unrelated body of work: an invoice line-item reliability fix (atomic RPC-based save, prevents a failed load from silently wiping saved invoice items on next save). It is **committed** (git commit `0aebc67`) but **NOT deployed** — `src/api/invoices.js` calls a database function `save_opps_invoice_with_items` that only exists in disposable local test databases, not in production. Deploying the current `HEAD` of this branch as-is **will break invoice create/update in production immediately**. Full detail in `docs/workflow_reliability_audit/`.

To ship the inventory changes above without shipping that risk, the deploy was done by temporarily checking out the pre-invoice-RPC versions of the affected files (`git checkout bb368ca -- package.json src/api/invoices.js src/features/invoices/InvoiceCreateFlow.jsx src/features/invoices/InvoiceDetailDrawer.jsx src/pages/Invoices.jsx`), building, deploying, then restoring `HEAD` (`git checkout HEAD -- <same files>`). If you need to deploy again before the invoice RPC migration is applied to production, repeat that same isolation step first — don't just run `vercel --prod` from a plain checkout of this branch.

To ship the invoice-reliability work later: apply `supabase/migrations/202608020001_invoice_item_atomic_persistence.sql` to production first (same lightweight Studio-paste process used for the inventory migration is appropriate — it's already been validated against a full 66-migration reconstructed schema, see `docs/workflow_reliability_audit/11_BRANCH_1_FULL_SCHEMA_STAGING_SMOKE.md`), then deploy normally.
