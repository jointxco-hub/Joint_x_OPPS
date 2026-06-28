# X LAB OS Phase 5B - Tenant Storefront Catalog Backend

Date: 2026-06-28

## Status

Backend implementation completed and verified. No storefront UI switch, checkout work, PayFast work, custom domains, analytics, client self-publishing, or real client onboarding was done.

## Scope

Phase 5B makes public storefront catalog reads tenant-safe by hostname.

Migration:

- `supabase/migrations/202606270008_tenant_storefront_catalog_backend.sql`

SQL assertions:

- `supabase/tests/storefront_host_resolver.sql`
- `supabase/tests/storefront_catalog_tenant_scope.sql`

## Backend Additions

Added public storefront host resolver:

- `resolve_public_storefront_tenant(p_hostname)`

Behavior:

- uses existing `normalize_tenant_hostname`
- resolves only active `tenant_domains` rows where `surface = 'storefront'`
- requires the tenant to be active
- rejects unknown, malformed, path-like, port-included, trailing-dot, pending, and disabled hosts
- returns only `tenant_slug`, `tenant_name`, and `hostname`
- does not expose `tenant_id`

Added host-aware catalog RPC:

- `get_storefront_catalog_for_host(p_hostname, p_limit)`

Behavior:

- resolves tenant only from hostname
- searches only inside the resolved tenant
- returns only active or published, non-archived, store-visible products
- clamps result limit to `1..100`
- returns allowlisted storefront-safe fields only

Allowed catalog fields:

- `id`
- `name`
- `description`
- `category`
- `price`
- `image_url`
- `images`
- `code`
- `gsm`
- `material`
- `videos`
- `addons`
- `print_options`
- `display_order`

Intentionally hidden:

- `tenant_id`
- supplier costs
- margins
- purchase data
- private file paths
- internal inventory data
- OPPS notes
- internal production fields

Private upload refs and signed private Storage paths are filtered out of product image fields.

## Product Access Hardening

The migration removes direct anonymous public access to `products`:

- dropped `Public can select products`

It also replaces the original broad authenticated product policies with:

- `tenant_manage_products`

Authenticated OPPS product management remains available only when the user is:

- an app admin, or
- an active member of the product row's tenant

Public storefront catalog reads must now go through `get_storefront_catalog_for_host(...)`.

## Demo Storefront Data

Added disposable demo storefront mapping:

- tenant: `demo-xos`
- host: `demo.xlab.jointx.co.za`
- surface: `storefront`

Seeded obvious demo products only:

- `DEMO-XOS Launch Tee`
- `DEMO-XOS Studio Hoodie`
- `DEMO-XOS Campaign Cap`
- `DEMO-XOS Event Tote`

No real client products were added.

## Verification

Migration applied to the linked DB via controlled direct SQL:

- `202606270008_tenant_storefront_catalog_backend.sql`

Passed SQL assertions:

- `supabase/tests/storefront_host_resolver.sql`
- `supabase/tests/storefront_catalog_tenant_scope.sql`
- `supabase/tests/host_aware_public_tracking.sql`

Passed app checks:

- `npm.cmd run check:xos-boundary`
- `npm.cmd run build`

Build emitted only existing dependency freshness warnings for browser baseline/caniuse data.

## Remaining Limitations

The backend catalog path is tenant-safe, but the UI has not been switched yet.

Still untouched:

- `ClientCatalog` UI integration
- checkout
- PayFast
- custom domains
- analytics
- client self-publishing
- real client onboarding

Before a managed-store pilot, later phases still need:

- storefront-only public host branch or route behavior
- `ClientCatalog` data loading through `get_storefront_catalog_for_host(...)`
- tenant-aware CMS/store config
- tenant-scoped checkout/order intent
- PayFast tenant binding and callback hardening
- browser verification against disposable demo storefront data

## Decision

Phase 5B closes the backend catalog safety slice. Proceed next with a narrow Phase 5C storefront public host/catalog UI integration, while keeping checkout, PayFast, analytics, custom domains, client self-publishing, and real client onboarding paused.
