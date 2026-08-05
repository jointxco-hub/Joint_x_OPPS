# OPPS Inventory Phase 0 and Phase 1 Review Plan

**Status:** Planning draft for owner and technical review  
**Date:** 2026-07-26  
**Implementation status:** No migration, schema, RLS policy, view, RPC, application route, or production-data change has been applied.

This plan turns the approved product-identity rules in `OPPS_INVENTORY_AUDIT.md` into a review package. Phase 0 proves the current data and security baseline. Phase 1 introduces understandable internal and supplier identities plus a reviewed legacy mapping workflow. The legacy `public.inventory` table and its `current_stock` remain authoritative throughout these phases.

## 1. Approved rules used by this plan

1. `JET` is a tenant-scoped Joint X product class, not a permanent alias for one supplier garment.
2. `Daniel Slaves 220gsm Tee` is an exact supplier product and remains visible in traceability records.
3. `Black / XL` physical stock belongs to an exact supplier variant, not directly to `JET`.
4. Existing Daniel Slaves 220gsm rows may be suggested as `JET`, but every proposed mapping requires review before migration.
5. Production normally displays the internal identity first and supplier identity second:

   ```text
   JET - Black / XL
   Daniel Slaves 220gsm Tee
   ```

6. Purchasing and receiving lead with supplier identity.
7. Customer documents and storefronts hide supplier identity unless deliberately configured.
8. Internal product codes are unique per tenant and remain stable after supplier discontinuation.
9. Supplier substitution requires explicit approval.
10. Cost and margin reporting uses the exact allocated supplier variant and, when available, its receipt cost.
11. Different supplier garments are not mixed in one production run without approval.
12. A material change in fit, fabric, GSM, or construction creates a new internal version such as `JET V2`.
13. Legacy source names and source-row identity are retained permanently for audit history.

## 2. Confirmed requirement-to-allocation lifecycle

An order requests an internal variant before a supplier choice is made. Physical reservation begins only when an exact supplier variant is allocated.

```text
Order line requests JET / Black / XL
              |
              v
Internal demand reservation
(requested internal variant, quantity, tenant, order line)
              |
              v
Allocation decision
(approved compatibility, supplier consistency, substitution approval)
              |
              v
Exact supplier-variant reservation
(supplier variant, location, quantity, cost/receipt provenance)
              |
              v
Pick -> issue -> release/return
```

The initial internal reservation is a demand commitment, not evidence that a particular physical SKU has been held. It must not directly update a supplier-variant balance. The later allocation is the hard physical hold and must atomically increase `reserved` on the selected supplier-variant/location balance.

Rules for the future Phase 2 reservation implementation:

- The order requirement stores `requested_inventory_variant_id` and requested quantity.
- The internal demand reservation may be `unallocated`, `partially_allocated`, `allocated`, `released`, or `cancelled`.
- One requirement may have multiple allocation rows only for partial fulfillment or an explicitly approved mixed-supplier exception.
- Every allocation stores `inventory_supplier_variant_id`, location, quantity, compatibility status, substitution approval, and allocation actor/time.
- Picking is prohibited until the full picked quantity has an exact supplier-variant allocation.
- Allocation must lock and validate the exact balance row; an internal aggregate must never be decremented as if it were physical stock.
- Releasing an allocation returns the exact supplier-variant hold while leaving or cancelling the internal requirement according to the order action.
- Cost and margin derive from the allocated supplier variant and later receipt/lot evidence, never from the `JET` class alone.
- Phase 1 defines and displays these identities but does not implement reservation, allocation, balance, or movement behavior.

## 3. Phase 0 - data and security gate

### Deliverables

1. Read-only remote schema dump and schema-drift report covering `inventory`, `suppliers`, `purchase_orders`, `orders`, `products`, tenant helpers, grants, triggers, indexes, and policies.
2. Tenant-integrity report for null tenants, cross-tenant references, duplicate SKUs/names, invalid JSON identifiers, negative/null quantities, and archived rows referenced by active work.
3. Legacy inventory export with immutable source identifiers and original text.
4. Documented resolution for the current non-persisted `ClientOrder` path and catalog tenant-context defect. These are gates; they are not inventory naming changes.
5. Proposed SQL files, rollback notes, and test scripts reviewed without execution.
6. Feature-flag and grant plan that keeps all Phase 1 objects inaccessible to the production UI until approval.

### Phase 0 preflight queries

The review package should include read-only queries for:

- row counts and `current_stock` totals per tenant;
- null or inaccessible `tenant_id` values;
- duplicate non-null SKU values per tenant and globally;
- names likely containing colour, size, GSM, or supplier tokens;
- supplier references that are missing or cross-tenant;
- order and PO JSON lines whose `inventory_item_id` is missing, malformed, archived, or cross-tenant;
- legacy rows with active order/PO references;
- current RLS policies, grants, functions, triggers, and view ownership;
- differences between the checked-in schema and the remote schema.

All exported review data must be read-only, access-controlled, and excluded from Git when it contains production information.

### Phase 0 acceptance gate

- The remote schema can be reproduced or every drift item is documented.
- All inventory source rows have a tenant and immutable source identity, or are explicitly quarantined for owner resolution.
- Baseline per-tenant row counts and quantity totals are signed off.
- No proposed object permits cross-tenant access.
- The SQL, rollback, RLS tests, and two-tenant tests described below have been reviewed.
- No migration is applied merely because Phase 0 documentation is complete.

## 4. Proposed migration package - review only

The names are placeholders for future approved migration files. No file under `supabase/migrations` should be created until the package is reviewed.

### Migration A - inventory identity foundation

Proposed objects:

| Object | Purpose | Required safeguards |
| --- | --- | --- |
| `inventory_products` | Stable Joint X product class such as `JET` | `tenant_id NOT NULL`; case-insensitive unique internal code per tenant; version and active fields; no physical balance columns |
| `inventory_variants` | Canonical internal colour/size requirement such as `JET / Black / XL` | Tenant-safe FK to product; unique internal SKU per tenant; canonical and display values kept separately |
| `inventory_supplier_products` | Exact commercial supplier product such as Daniel Slaves 220gsm Tee | Tenant-safe FKs to supplier and internal product; official name/code retained; compatibility and approval metadata |
| `inventory_supplier_variants` | Exact supplier colour/size/SKU mapped to an internal variant | Tenant-safe FKs; supplier SKU uniqueness scoped correctly; no pooled balance on the internal variant |

All parent/child tenant matches must be enforced in the database, not trusted to the browser. The SQL review must choose either composite tenant-aware foreign keys or constraint triggers/functions with equivalent guarantees.

### Migration B - reviewed legacy mapping workspace

Proposed `inventory_legacy_mappings` fields:

- `id`, `tenant_id`, and immutable `legacy_inventory_id`;
- immutable snapshots of original name, SKU, category, supplier, size/colour arrays, free-text location, unit, and recorded quantity;
- proposed internal product/variant and supplier product/variant IDs;
- parser version, confidence, matched evidence, ambiguity codes, and duplicate-group key;
- review state: `suggested`, `approved`, `rejected`, or `deferred`;
- reviewer ID/email, reviewed timestamp, reviewer note, and mapping version;
- created/updated timestamps and optional batch ID.

Constraints:

- one active mapping record per tenant/source row/mapping version;
- approval requires the necessary internal and supplier identities;
- a rejected or deferred row cannot be treated as migrated;
- source snapshots are immutable after creation;
- changing an approved mapping creates a new review version rather than erasing history.

This migration does not copy or post stock. Opening balances and the physical ledger belong to Phase 2 after identity mappings are approved.

### Migration C - Phase 1 read models and search

Proposed views or security-invoker query functions:

| Read model | Purpose |
| --- | --- |
| `inventory_identity_v` | One row per internal product/variant with internal display names and mapping completeness |
| `inventory_supplier_mapping_v` | Supplier-product and supplier-variant drill-down with approval and compatibility state |
| `inventory_legacy_mapping_review_v` | Review queue combining immutable source snapshots, suggestions, references, and decisions |
| `inventory_phase1_search_v` | Tenant-scoped normalized search across internal codes/names/SKUs, supplier names/codes/SKUs, GSM, colour, and size |
| `inventory_legacy_compat_v` | Read-only legacy-shaped projection with additive identity IDs and labels for comparison/export |

`inventory_legacy_compat_v` must not replace or rename `public.inventory` in Phase 1. Existing application reads and writes continue to use the legacy table. The compatibility view exists for comparison, mapping-screen context, and controlled adapter development only.

If PostgreSQL/view behavior cannot guarantee invoker RLS in the deployed version, use tenant-validating query functions with fixed `search_path`, explicit membership checks, and narrow execute grants instead of granting direct view access.

### Migration D - RLS and grants

Every new table must enable RLS. Proposed policy baseline:

- authenticated reads require `public.can_access_tenant(tenant_id)`;
- mapping decisions additionally require an approved inventory-admin role or existing app-admin authority;
- ordinary clients cannot insert or edit immutable source snapshots;
- no `anon` grants;
- no public access through storefront RPCs;
- service-role/import functions require explicit tenant, batch, source identity, and idempotency validation;
- grants are applied only after RLS and two-tenant tests pass.

The final SQL review must not assume that an authenticated user may manage every row merely because they can read the tenant. The exact operator/admin role mapping remains an owner decision.

## 5. Compatibility strategy

Phase 1 uses parallel reads, not cutover:

| Consumer | Phase 1 behavior |
| --- | --- |
| Existing Inventory page | Continues reading/writing `public.inventory`; clearly treated as the legacy recorded quantity path |
| Reviewed mapping screen | Reads new mapping/search views; may save review decisions only after authorization is approved |
| Production screens | No workflow change; future display contract is documented only |
| Purchasing/receiving | No workflow change; future supplier-first display contract is documented only |
| Orders/catalog | No inventory reservation behavior; future requests target internal variants after a later approved adapter |
| Storefront/invoices | No supplier identity exposure |

Comparison reports must prove that each legacy row appears exactly once and that no row, name, or recorded quantity disappears. Grouped internal totals are informational in Phase 1 and must be expandable to every contributing legacy row and supplier mapping.

## 6. Reviewed legacy mapping screen

### Primary layout

- Tenant-scoped review queue with tabs/counts for `Unreviewed`, `Ambiguous`, `Approved`, `Rejected`, and `Deferred`.
- Search across legacy text, internal code/name/SKU, supplier identity/SKU, GSM, colour, size, PO, and active order reference.
- Source panel showing immutable original values exactly as stored.
- Proposal panel showing internal product, internal variant, supplier product, supplier variant, confidence, and reasons.
- Reference panel showing active orders, POs, supplier catalog evidence, duplicates, and conflicting specifications.
- Audit panel showing reviewer, timestamp, note, previous mapping versions, and parser version.

### Review actions

- Approve the proposal.
- Edit the proposal and approve.
- Link to an existing internal product or variant.
- Create a proposed internal product/variant for later approval.
- Link or propose the exact supplier product/variant.
- Reject a false match.
- Defer an ambiguous row with a required reason.

Bulk approval is permitted only for an explicitly selected, identical evidence group and must show every affected source row before confirmation. `Daniel Slaves` text alone is never sufficient to bulk-map rows to `JET`; GSM, construction/style, colour, size, supplier evidence, and conflicts must be visible.

### JET review example

```text
Original source
  Daniel Slaves 220gms Tees Black XL
  Original SKU: DS220-BLK-XL
  Recorded quantity: 18 pieces

Suggested internal identity
  JET - Joint X Essential Tee
  Black / XL

Suggested supplier identity
  Daniel Slaves 220gsm Tee
  Black / XL - DS220-BLK-XL

Decision
  Pending owner review
```

Approving this mapping records identity only. It does not move, merge, reserve, receive, or rewrite the 18-piece legacy balance.

## 7. UI display contract for later implementation

| Context | Primary label | Secondary detail |
| --- | --- | --- |
| Production | `JET - Black / XL` | `Daniel Slaves 220gsm Tee`; substitution/mix warning when relevant |
| Purchasing | `Daniel Slaves 220gsm Tee - Black / XL` | Supplier SKU, mapped `JET` variant |
| Receiving | Supplier product/variant and SKU | PO, receipt, mapped `JET` variant |
| Internal inventory matrix | `JET` product and internal colour/size | Exact supplier breakdown on drill-down |
| Customer storefront/invoice | Configured customer-facing product | No supplier brand unless explicitly enabled |

## 8. RLS and two-tenant review tests

The future SQL test package must create Tenant A and Tenant B, one ordinary member for each, one authorized inventory reviewer, and one unauthorized authenticated user.

Required cases:

1. Tenant A can read only Tenant A internal and supplier identities.
2. Tenant A cannot infer Tenant B rows through search, counts, views, errors, or IDs.
3. Tenant A cannot create a child row using Tenant B parent IDs.
4. Tenant A cannot map a Tenant A legacy row to Tenant B product, variant, or supplier records.
5. Case-insensitive `JET` uniqueness is enforced within one tenant but `JET` may independently exist in both tenants.
6. Supplier SKUs obey the reviewed tenant/supplier uniqueness rule without leaking conflict details across tenants.
7. An ordinary reader cannot approve, reject, or rewrite mappings.
8. An authorized reviewer can decide mappings only for an accessible tenant.
9. Source snapshots cannot be updated after insertion by normal roles.
10. Compatibility and search reads enforce the same tenant boundary as base tables.
11. Anonymous users receive no inventory identity or supplier data.
12. Service/import paths reject missing tenant, mismatched parents, duplicate source/idempotency keys, and unauthorized batches.

The tests must run with actual authenticated claims or the repository's established Supabase test pattern; service-role-only tests are insufficient evidence for RLS.

## 9. Rollback and recovery plan

Before any future migration:

- capture the remote schema and policy definitions;
- record per-tenant legacy counts and quantity totals;
- confirm a database backup/recovery point;
- ensure the new UI is feature-flagged off;
- review forward and inverse SQL in the same change set.

If an identity migration has been applied but not used:

1. Revoke new grants and disable the feature flag.
2. Remove dependent read views/functions in reverse order.
3. Drop new tables only when they are proven empty and no production reference exists.

If review decisions or mappings exist:

1. Revoke writes and return all consumers to `public.inventory`.
2. Preserve/export mapping history and source snapshots.
3. Mark the migration batch inactive; do not delete approved history as routine rollback.
4. Correct forward with a reviewed migration unless legal/security recovery requires restoration.

Because Phase 1 never transfers stock authority, rollback does not need to reverse balances or movements. The legacy table remains the source of recorded quantity.

## 10. Review checkpoints and acceptance

### SQL review checkpoint

- Exact DDL, constraints, indexes, triggers/functions, grants, and policies are present.
- Tenant matching is database-enforced for every relationship.
- No table gives `JET` or an internal variant a physical balance.
- No executable reservation or allocation behavior is included in Phase 1.

### Mapping review checkpoint

- Original text and source IDs are immutable and visible.
- Every proposed mapping has confidence and evidence.
- Ambiguity stays pending; no similar-name auto-merge exists.
- JET/Daniel Slaves examples satisfy the approved display and identity rules.

### Test review checkpoint

- RLS and two-tenant tests cover tables, views/functions, search, decisions, and cross-parent writes.
- Rollback has been rehearsed in a disposable environment.
- Baseline and post-migration comparison queries produce identical legacy row counts and quantities.

### Authorization checkpoint

Only after all three review checkpoints pass should the owner explicitly authorize creating or applying migration files. Phase 2 reservations, allocations, supplier-variant balances, movements, receipts, and opening-balance posting require a separate approval.

## 11. Explicitly out of scope

- Applying database migrations or modifying production data.
- Replacing or renaming `public.inventory`.
- Posting opening balances or creating a movement ledger.
- Implementing reservations, allocations, receiving, picking, or production issues.
- Changing broad `orders.status`, `pipeline_stage`, or production-detail fields.
- Changing the service worker, notifications, PayFast, X LAB sync, or payment flows.
- Exposing supplier identity to customers.
