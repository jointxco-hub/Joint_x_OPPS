# OPPS Canonical Price Resolution — V1

## Status

**REHEARSED — not yet applied to production**

## Date

2026-10-03

## References

| | |
|---|---|
| Migration (prepared, not yet applied) | `20261003090000_canonical_price_resolution_v1` |
| Rehearsal script | `supabase/tests/canonical_price_resolution_v1_rehearsal.sql` |
| Production project | `slhcvyeuqsduaglddqdb` |
| Prior work this builds on | "Canonical Product & Pricing Audit" and "Canonical Price Resolution V1 — Design" (published artifacts; local copies in `App Development/canonical_product_pricing_audit.html` and `resolver_v1_design.html`, outside this repo) |
| Function this slice's auth mirrors exactly | `admin_get_client_product_price_composition` |
| Function this slice reuses (not duplicates) for component arithmetic | `_xos_freeze_client_product_price_breakdown` |

This is a completion record for the rehearsal/validation stage only. The migration has not been applied to production — see Status above.

## Background

Three (occasionally four, via a separate `commerce` schema bridge) product catalogs and up to three different price-resolution behaviors coexist across OPPS/X LAB today — see the audit above for the full map. The one, well-scoped first step this slice implements is a single **read-only, diagnostic** RPC that reports what an order-add *would* charge today, without changing what anything actually charges.

Authorization is **not** a new invention. `is_opps_staff()` alone is confirmed (by reading its live source) not tenant-scoped — it is true for e.g. any active joint-x member regardless of which tenant's `client_product` is in question. The existing precedent, `admin_get_client_product_price_composition`, already closes this gap correctly with an explicit `can_access_tenant(cp.tenant_id)` check on top. This resolver copies that exact two-part gate. `can_access_tenant()` itself has no app-admin bypass (confirmed by reading its source, which delegates to pure active-membership lookup) — this resolver does not add one either.

## What changed (on apply — not yet live)

- Adds `public.resolve_client_product_price(p_client_product_id uuid, p_quantity numeric default 1, p_override_unit_price numeric default null)`, `STABLE SECURITY DEFINER`, granted to `authenticated, service_role` only (never `anon`/`public`).
- Auth: `is_opps_staff()` AND `can_access_tenant(client_product.tenant_id)` — copied verbatim from `admin_get_client_product_price_composition`'s precedent. No app-admin cross-tenant bypass.
- Effective-price precedence: `override → client_products.client_price (agreed) → 0 (default_zero)` — matches `xos_add_composed_client_product_to_order`'s live `coalesce(p_unit_price, cp.client_price, 0)` rule exactly. Computed component price is diagnostic only in this slice; it never becomes the effective/commercial price.
- `client_price = 0` and `override = 0` are both valid, real values (read via `is not null`, not `> 0`) — not treated as unset.
- Negative override is rejected. Quantity must be a positive, finite number — explicit `NULL`/`0`/negative/`NaN` is rejected outright, never silently coalesced (the default of `1` applies only when the argument is omitted, via ordinary Postgres default-parameter semantics).
- `requires_quote` is returned diagnostically, verbatim from `client_products.requires_quote` — never derived, never suppresses the rest of the output, never creates or modifies anything.
- `computed_unit_price` is derived algebraically from `_xos_freeze_client_product_price_breakdown`'s own output, **not duplicated**: that function computes `difference := effective_unit_price − computed_component_sum`, so `computed_unit_price := effective_unit_price − difference`. This is an exact identity (the component sum depends only on `product_components`, never on which price is passed in), proved from source and verified empirically against two real production rows before this migration was written (see rehearsal/shadow results below).
- Out of scope for this slice, deliberately: `garment_variants.price_override`, `treatments.surcharge`, `material`/`packaging`/`labour`/`other` component pricing, any artwork/placement/production-geometry/print-prep field, and any canonical order-total field.
- No table is altered. No existing function, policy, or grant is changed — confirmed by direct inspection: the migration contains exactly one `CREATE OR REPLACE FUNCTION` and references the eight related existing functions only in comments or as a single read-only call (`_xos_freeze_client_product_price_breakdown`), never a redefinition.
- Frontend: none. No file in `src/` depends on this RPC existing yet.

## Production validation

*Every step below was run directly against production (project `slhcvyeuqsduaglddqdb`), inside `BEGIN … ROLLBACK` — nothing was committed.*

### Pre-flight (confirmed unchanged from the reviewed design)

Captured live hashes for all 8 related functions (`_xos_freeze_client_product_price_breakdown`, `admin_get_client_product_price_composition`, `xos_add_composed_client_product_to_order`, `save_opps_quote_with_items`, `save_opps_invoice_with_items`, `convert_quote_to_invoice`, `convert_quote_to_order`, `create_checkout_order`); confirmed `resolve_client_product_price` did not yet exist; confirmed no bookkeeping row for `20261003090000`; captured baseline counts for `client_products` (39), `product_components` (40), `clients` (65), `orders` (141), `opps_quotes` (15), `opps_invoices` (87), `tenant_memberships` (18), `auth.users` (26), `public.users` (14).

### Rehearsal result: 24/24 passed

All 24 cases from the reviewed test matrix passed on the third attempt. Two bugs were found and fixed in the tracked rehearsal file during the first two attempts (not in the migration itself):

1. `client_products.client_id` has a `NOT NULL` foreign key to `clients.id` — the first draft used a bare `gen_random_uuid()`. Fixed by inserting one disposable `clients` row, referenced by every disposable `client_product` fixture.
2. The membership-integrity check's expected `tenant_memberships` delta was off by one: inserting the disposable app-admin identity's `public.users` row (`role='admin'`) auto-enrolls it into the real joint-x tenant via `add_internal_user_to_joint_x_team()` — the same trigger side-effect encountered during the RBAC Slice 1 and Slice 2 rehearsals. Fixed the expected delta from `+2` to `+3`.

### Shadow comparison: 39/39 real client_products resolved

Run inside the same transaction, after the rehearsal passed and before `ROLLBACK`, under a disposable identity given real membership on both tenants that own live `client_products` (`joint-x`, `gsb`) — no real user's own membership was touched. Classification:

| Classification | Count |
|---|---|
| MATCHES_CURRENT_BEHAVIOR | 21 |
| EXPECTED_DIVERGENCE | 7 |
| DATA_QUALITY_ISSUE | 11 |
| AMBIGUOUS_PRODUCT_DECISION | 0 |

Zero resolver errors on any real row. No tenant-isolation failure (also separately proven by the rehearsal's own cases 18/20). No resolver arithmetic contradicted the existing primitive. No precedence deviation from the approved compatibility rule.

**Notable findings, reported as-is, not corrected:**

- `client_product_id ad8b43b1-31d3-4370-ada3-431238a6a59e` ("JET T-Shirt"): `client_price = 0`, component sum = 393 → resolver reports `reconciliation_status: "diverged"`, `agreed_unit_price: 0`, `effective_unit_price: 0`, `price_source: "agreed"`, `computed_unit_price: 393` — exactly the live inconsistency the design doc flagged (a $0 agreed price sitting on top of a real, nonzero component breakdown), surfaced faithfully, not resolved.
- 11 of 39 real `client_products` have at least one component with no price set (`unresolved_components` populated).
- `"ZZ-DISPOSABLE-PHASE2A-VERIFICATION-DO-NOT-USE"` is confirmed pre-existing stale test data from earlier work, not a real product. **Not cleaned up in this slice** — out of scope, a data-hygiene task, not a resolver concern.

### Post-rollback verification

All 8 existing functions' full-definition hashes restored exactly to their pre-flight values. All row counts (`client_products`, `product_components`, `clients`, `orders`, `opps_quotes`, `opps_invoices`, `tenant_memberships`, `auth.users`, `public.users`) restored exactly. `resolve_client_product_price` confirmed absent. No bookkeeping row for `20261003090000`. Zero residue across every disposable identity/tenant/client/client_product created during the rehearsal and shadow comparison.

**No permanent write occurred at any point.**

## What this slice deliberately does not do

- Does not change what any existing order/quote/invoice/checkout path actually charges.
- Does not persist `computed_unit_price`/`price_reconciled` as real columns — the resolver computes them on demand.
- Does not normalize `component_role` or wire up `price_override`/`surcharge` — tracked as separate, later decisions.
- Does not touch X LAB's legacy checkout path.
