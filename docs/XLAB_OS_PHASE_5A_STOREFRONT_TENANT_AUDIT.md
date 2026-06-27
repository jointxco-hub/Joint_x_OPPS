# X LAB OS Phase 5A - Storefront Tenant Model Audit

Date: 2026-06-27

## Status

Audit phase only. No code changes, no migrations, and no real client onboarding in this phase.

This document audits the current X LAB storefront, catalog, checkout, payment, tracking, and OPPS sync assumptions before any managed storefront implementation work begins.

## Context

The managed storefront model plan is committed:

- `e8365b7 Add X LAB OS managed storefront model`

Closed foundations:

- Phase 3 XOS Host Gate
- Phase 2C.1 Private Uploads + Signed URLs
- X LAB bridge mutation recheck
- XOS controlled onboarding readiness plan
- Phase 4A XOS Requests + Files demo
- Phase 4D XOS client request creation

Current XOS loop:

- client logs in
- client sees tenant workspace
- client sees demo orders, requests, and files
- client opens private files through signed links
- client creates a new request for OPPS review

## Executive Summary

The current X LAB storefront is not ready for managed multi-tenant storefronts yet.

The tenant foundations exist in the database:

- `tenant_domains.surface` already supports `storefront`
- `resolve_authenticated_tenant_host(...)` exists for authenticated surfaces
- public tracking is host-aware through `get_public_order_tracking_for_host(...)`
- `products` and `xlab_orders` were included in the multi-tenant backfill list

But the storefront runtime still has hostless assumptions:

- `ClientCatalog` does not resolve tenant from `window.location.hostname`
- catalog reads use the generic `CatalogItem` data client against `products`
- the `products` table still has a broad anonymous public select policy
- order submission creates a generic `ClientOrder` through OPPS data client behavior
- checkout uploads artwork through the shared upload helper, with current behavior depending on OPPS tenant context
- PayFast/order sync is not currently represented as a tenant-aware managed-store flow in the app code reviewed
- storefront copy, brand, hero, footer, discounts, contact details, sizes, colors, and print material defaults are hardcoded for Joint X/X LAB

The safest next implementation is a narrow Phase 5B backend slice:

1. Add a storefront host resolver for active `tenant_domains` rows where `surface = 'storefront'`.
2. Add public storefront-safe catalog RPCs that resolve tenant only from hostname.
3. Harden `products` RLS so anonymous access cannot read all tenants directly.
4. Keep existing `ClientCatalog` behavior untouched until the new host-resolved path is tested.

## Current Route and Component Inventory

| Area | Current files | Classification | Notes |
| --- | --- | --- | --- |
| App host boundary | `src/App.jsx`, `src/lib/xosHost.js` | Needs host resolver | XOS has a hard top-level branch. Storefront has no equivalent branch yet. |
| Route registry | `src/pages.config.js` | Needs host resolver | `ClientCatalog` is registered as an OPPS page route, not a storefront-only host branch. |
| Layout behavior | `src/Layout.jsx` | Should remain Joint X only for MVP | `ClientCatalog` is standalone from layout, but it still lives inside the OPPS app/auth route table. |
| Storefront page | `src/pages/ClientCatalog.jsx` | Needs host resolver, tenant_id, RPC hardening | Reads generic catalog data and submits OPPS orders without host-resolved tenant. |
| Cart panel | `src/components/catalog/FloatingCart.jsx` | Safe as-is for UI only | Cart UI is browser state and can be reused, but checkout must be tenant-aware. |
| Catalog admin | `src/pages/CatalogManagement.jsx`, `src/pages/Inventory.jsx` | Should remain Joint X only for MVP | Internal OPPS catalog management should not become client self-publishing in MVP. |
| Public tracking | `src/pages/TrackOrder.jsx`, `get_public_order_tracking_for_host(...)` | Safe as-is | Already host-aware and minimal. Must stay separate from storefront cart/order flow. |
| XOS workspace | `src/pages/XOSAdminShell.jsx`, `src/lib/xosModules.js` | Safe as-is | XOS is host gated and should remain separate from public storefront. |
| Upload helper | `src/api/dataClient.js` | Needs RPC/function hardening for storefront use | Private uploads require an active tenant from OPPS context; public uploads use `public-assets`. Storefront checkout needs host-derived upload/order flow, not OPPS local tenant cache. |

## Current Product and Catalog Data Sources

Current data source:

- `dataClient.entities.CatalogItem`
- table: `public.products`
- frontend page: `src/pages/ClientCatalog.jsx`
- management pages: `src/pages/CatalogManagement.jsx`, `src/pages/Inventory.jsx`

Observed schema and policies:

- `202605150001_create_products_table.sql` created `products`
- RLS is enabled
- authenticated users can select/insert/update/delete all products through broad policies
- `202605220002_allow_public_product_reads.sql` grants anonymous select using `(true)`
- `202605220003_extend_products_store_options.sql` adds `code`, `gsm`, `material`, `videos`, `addons`, `print_options`, and `store_visible`
- `202606200001_multi_tenant_foundation.sql` adds `tenant_id` to `products` and backfills null rows to `joint-x`

Current storefront behavior:

- `ClientCatalog` loads `CatalogItem.list('name', 200)`
- it filters products client-side by `is_active`, `is_archived`, `status !== 'draft'`, and `store_visible !== false`
- it groups by `category`
- it deduplicates by product name
- it exposes product price, image, images, gsm, material, print options, add-ons, and fallback images

Classification:

- Needs tenant_id: `products` already has `tenant_id`, but storefront reads do not enforce host-resolved tenant.
- Needs host resolver: catalog must load by storefront host only.
- Needs RLS/policy: anonymous `products` select using `(true)` is not safe for managed storefronts.
- Needs RPC/function hardening: public catalog reads should use a security-definer RPC returning only storefront-safe fields for the resolved host.
- Should remain Joint X only for MVP: `CatalogManagement` and `Inventory` editing/publishing.

## Current CMS and Store Config Data Sources

No dedicated tenant-aware storefront CMS data source was found in the audited storefront path.

Current CMS-like values are hardcoded in `ClientCatalog`:

- header brand: `Joint X`
- subtitle: `Apparel & Print`
- hero: `Premium Apparel & Print`
- support copy: `Quality blanks. Expert branding. Nationwide delivery.`
- discount badges
- contact phone and email
- footer company/contact/location text
- default colors/sizes
- default print material options and pricing formula
- Unsplash fallback images

Classification:

- Needs tenant_id: future CMS/store settings table.
- Needs host resolver: storefront config must resolve by host.
- Needs RPC/function hardening: public config RPC should return only public-safe CMS fields.
- Should remain Joint X only for MVP: publishing CMS changes.
- Must not be exposed to clients: internal pricing/cost/margin logic behind print materials and production feasibility.

## Current Cart and Checkout Flow

Current files:

- `src/pages/ClientCatalog.jsx`
- `src/components/catalog/FloatingCart.jsx`

Current behavior:

- cart is React state only
- product selection creates cart items per size/color
- add-ons and print options are copied into cart items
- discounts are calculated client-side
- checkout collects customer name, phone, email, company, special instructions, notes, and artwork/design files
- `handleSubmitOrder` creates a `ClientOrder` through `dataClient.entities.ClientOrder.create(...)`

Current submitted order fields include:

- `order_number`
- `tracking_code`
- customer/contact fields
- `company_name`
- `items`
- `subtotal`
- `discount`
- `total`
- `notes`
- `special_instructions`
- `design_files`
- `status = 'pending'`

Classification:

- Needs host resolver: checkout must derive tenant from storefront host, not OPPS active tenant/local storage.
- Needs tenant_id: order creation must insert into the resolved tenant only.
- Needs RPC/function hardening: public checkout/order-intent RPC should validate and sanitize cart/customer fields server-side.
- Needs RLS/policy: direct anonymous insert into OPPS `orders` or tenant tables should be avoided.
- Must not be exposed to clients: OPPS internal order fields, staff assignment, production hold notes, supplier costs, margins, purchase data, staff tasks.

## Current Upload Flow

Current helper:

- `dataClient.integrations.Core.UploadFile(...)`

Current behavior:

- `visibility = 'public'` uploads to `public-assets` and returns a raw public URL
- default/private uploads use `uploads`
- private storage paths are prefixed with `getCurrentTenantId()`
- `ClientCatalog` checkout artwork upload calls `UploadFile({ file })` without explicit public visibility
- `CatalogManagement` image uploads call `UploadFile({ file, visibility: 'public' })`

Classification:

- Safe as-is for OPPS/XOS private files: private uploads have already been hardened for tenant-prefixed paths and signed links.
- Needs host resolver for public storefront checkout: anonymous or public shoppers cannot rely on OPPS active tenant context.
- Needs RPC/function hardening: managed-store checkout uploads need a dedicated flow, likely pre-create tenant-scoped upload intent or store public-safe assets separately.
- Should remain Joint X only for MVP: public catalog/profile assets in `public-assets`.
- Must not be exposed to clients: raw private upload refs and permanent private storage URLs.

## Current PayFast Init/Notify Flow

The audited frontend path does not currently show a managed storefront PayFast init flow in `ClientCatalog`.

Observed references:

- `supabase/migrations/202606020001_xlab_order_payment_health_columns.sql` adds payment health columns to `xlab_orders`
- OPPS dashboard/order health references PayFast review states
- no active `ClientCatalog` PayFast submit/init/notify code was found in the storefront page audit

Classification:

- Needs tenant_id: payment intents and confirmed orders must carry tenant identity.
- Needs host resolver: payment init should be created from a host-resolved storefront tenant.
- Needs RPC/function hardening: PayFast notify/callback must bind to a server-created tenant-scoped order/payment intent and must not trust browser-supplied tenant fields.
- Needs RLS/policy: payment records and `xlab_orders` must be tenant protected.
- Should remain Joint X only for MVP: PayFast account/credential management and reconciliation.
- Must not be exposed to clients: PayFast secrets, internal payment reconciliation notes, settlement/margin data.

## Current Order Creation and Sync-to-OPPS Flow

Current storefront order creation:

- `ClientCatalog` submits through `dataClient.entities.ClientOrder.create(...)`
- `dataClient` maps `ClientOrder` to the internal `orders` table
- `Order` is marked `tenantScoped: true`
- `dataClient.create(...)` injects `tenant_id` from `getCurrentTenantId()` when an entity is tenant-scoped

Risk:

- `getCurrentTenantId()` is acceptable inside OPPS after membership checks.
- It is not acceptable for public managed storefront tenant selection.
- A public storefront host must not use local storage, query params, or cached OPPS tenant context to choose the tenant.

Classification:

- Needs host resolver: public storefront order creation.
- Needs tenant_id: order records already have tenant_id, but the source must be host-resolved.
- Needs RPC/function hardening: create a dedicated storefront order-intent/checkout RPC that returns a minimal customer-facing result.
- Should remain Joint X only for MVP: OPPS production readiness/task creation and internal workflow.
- Must not be exposed to clients: internal OPPS order mutation APIs and full `orders` table fields.

## Current Analytics, Session, and Cart Events

No dedicated tenant-aware storefront analytics/session/cart-event model was found in the audited storefront code path.

Current behavior:

- cart state is in React component memory
- OPPS app has generic session/auth/local-storage behavior through `dataClient`, auth, and tenant context
- no managed-store analytics event capture was observed in `ClientCatalog`

Classification:

- Safe as-is for MVP if excluded.
- Needs tenant_id before use: cart sessions, storefront analytics, conversion events, abandoned cart, customer sessions.
- Needs host resolver before use: anonymous storefront analytics must be tenant-scoped by host.
- Not in MVP: full analytics, customer accounts, abandoned cart automation.

## Current Public Tracking Relationship

Current files/functions:

- `src/pages/TrackOrder.jsx`
- `resolve_public_tracking_tenant(p_hostname)`
- `get_public_order_tracking_for_host(p_lookup, p_hostname)`

Current behavior:

- tracking resolves tenant from active `tenant_domains` rows with `surface = 'public_tracking'`
- malformed/path/port/trailing-dot hosts resolve to nothing
- public tracking returns one minimal order payload
- legacy `get_public_order_tracking(...)` is pinned to `ops.jointx.co.za`

Classification:

- Safe as-is.
- Must remain separate from storefront checkout.
- Public tracking host may be the same custom domain or a separate tracking host later, but it must continue to resolve through `surface = 'public_tracking'`.

## Hardcoded Joint X / X LAB Assumptions

Current hardcoded storefront assumptions:

- brand name: Joint X
- brand category: Apparel & Print
- phone: `+27 75 453 4646`
- email: `jointx.co@gmail.com`
- location: JHB / nationwide delivery
- product categories and fallback product imagery
- sizes and colors
- print materials and cost/markup formula
- discount thresholds and labels
- order number prefix `CLT-`
- tracking code generated in browser
- checkout copy says 50 percent deposit required
- product import/admin copy refers to XLab shop products

Classification:

- Needs tenant-aware CMS/store config before managed client storefronts.
- Should remain Joint X only for MVP until public tenant storefront config is added.
- Must not expose internal cost formulas as a client-editable or public source of truth.

## Table, Function, and API Inventory

| Object | Current role | Phase 5A classification |
| --- | --- | --- |
| `public.tenant_domains` | Host mapping with `ops`, `xos_admin`, `public_tracking`, `storefront` surfaces | Safe foundation; needs storefront resolver use. |
| `public.normalize_tenant_hostname(text)` | Host normalization and validation | Safe as-is. |
| `public.resolve_public_tracking_tenant(text)` | Public tracking route resolver | Safe as-is; not storefront catalog resolver. |
| `public.resolve_authenticated_tenant_host(text,text)` | Authenticated host resolver | Safe for XOS; storefront public resolver should be separate. |
| `public.products` | Catalog products | Needs tenant-scoped public read model and policy hardening. |
| `public.orders` | OPPS orders and current `ClientOrder` target | Needs dedicated storefront order-intent/checkout RPC. |
| `public.xlab_orders` | X LAB order/payment health table if present | Needs tenant-aware payment/order-sync audit before use. |
| `public.client_file_links` / `client_file_folders` | XOS files | Safe as-is for XOS; do not expose through public storefront. |
| `public.client_quote_requests` / messages/profile requests | XOS request loop | Safe as-is for XOS; not public storefront checkout. |
| `dataClient.entities.CatalogItem` | Generic product CRUD | Should remain OPPS/internal for management; public storefront should use RPC. |
| `dataClient.entities.ClientOrder` | Generic OPPS order creation | Should remain OPPS/internal; public storefront should use RPC. |
| `dataClient.integrations.Core.UploadFile` | Public/private uploads | OPPS/XOS safe; public storefront needs dedicated tenant host upload path. |
| `ClientCatalog` | Current storefront/catalog page | Needs host-resolved storefront model before pilot. |
| `CatalogManagement` / `Inventory` | Product management | Joint X only for MVP. |

## Risk Matrix

| Risk | Severity | Likelihood | Current state | Required control |
| --- | --- | --- | --- | --- |
| Anonymous user reads all tenant products | High | High once multiple tenants have products | `products` public select policy uses `(true)` | Replace direct public reads with host-resolved catalog RPC and tighten RLS. |
| Storefront creates order under wrong tenant | Critical | Medium | Current order creation uses OPPS data client tenant context | Dedicated checkout RPC resolving tenant by storefront host only. |
| Browser/query/local storage selects storefront tenant | Critical | Medium | No storefront host branch exists yet | Storefront tenant must come only from `window.location.hostname` passed to server resolver. |
| Client sees internal product cost/margin/supplier data | High | Medium | Product model mixes print options and pricing assumptions | Public catalog RPC returns allowlisted fields only. |
| Checkout artwork uploads become public or wrong-tenant | High | Medium | Checkout uses generic upload helper | Dedicated storefront upload/attachment model with tenant-resolved paths. |
| PayFast callback crosses tenants | Critical | Medium | Managed-store PayFast flow not yet tenant-modeled | Server-created tenant-scoped payment intent and callback verification. |
| Storefront host mounts OPPS internals | High | Medium | `ClientCatalog` lives in OPPS route table | Add storefront-only host branch before OPPS layout/routes for storefront hosts. |
| Public tracking regresses or exposes tenant/private fields | High | Low | Tracking is already host-aware and minimal | Keep tracking RPC separate and covered by regression tests. |
| Client self-publishes unsafe products/CMS | Medium | Medium | Catalog management exists in OPPS | Keep self-publishing out of MVP; XOS requests only. |

## Recommended Smallest Phase 5B Implementation Path

Phase 5B should be backend-first and conservative.

1. Add a public storefront resolver.
   - Example: `resolve_public_storefront_tenant(p_hostname)`.
   - It should use `normalize_tenant_hostname`.
   - It should resolve only active `tenant_domains` rows where `surface = 'storefront'`.
   - It should expose only `tenant_slug`, `hostname`, and public display fields needed by the storefront.
   - It should reject unknown, malformed, path-like, port-included, trailing-dot, pending, and disabled hosts.

2. Add host-aware public catalog RPCs.
   - Example: `get_storefront_catalog_for_host(p_hostname, p_limit)`.
   - Resolve tenant by storefront host.
   - Return only active/published/store-visible products for that tenant.
   - Return allowlisted product fields only.
   - Do not return `tenant_id`, internal costs, supplier data, margins, inventory internals, private file paths, or OPPS-only fields.

3. Harden direct `products` public access.
   - Remove or replace anonymous `(true)` public select after RPC coverage exists.
   - Ensure authenticated management remains membership/RLS protected.
   - Add tests proving Tenant A/B products cannot cross-return by host.

4. Keep existing storefront UI unchanged until SQL assertions pass.
   - Do not switch `ClientCatalog` to managed-store mode until backend resolver and catalog tests pass.
   - Do not touch PayFast in Phase 5B.
   - Do not add custom domains yet.

5. Add a demo storefront host mapping only.
   - Use disposable `demo.xlab.jointx.co.za` or equivalent demo host.
   - Do not onboard real clients.
   - Seed 3 to 5 obvious `DEMO-XOS` products only.

## Proposed Migration and Test Plan

Suggested migrations:

- `202606270008_storefront_host_resolver.sql`
- `202606270009_tenant_storefront_catalog.sql`

Suggested SQL tests:

- `supabase/tests/storefront_host_resolver.sql`
- `supabase/tests/storefront_catalog_tenant_scope.sql`

Required assertions:

- active `storefront` host resolves the correct tenant
- unknown host resolves no tenant
- malformed/path/port/trailing-dot hosts resolve no tenant
- pending/disabled hosts resolve no tenant
- `xos_admin` host cannot be used as `storefront`
- `public_tracking` host cannot be used as `storefront`
- Tenant A storefront cannot read Tenant B products
- same product name in two tenants resolves according to host
- query params/local storage/browser tenant slug cannot override host
- RPC payload contains only storefront-safe fields
- RPC payload does not expose `tenant_id`, supplier costs, margins, purchase data, private paths, internal inventory, or OPPS notes
- existing `get_public_order_tracking_for_host(...)` tests still pass

## No-Go Items Before Managed-Store Pilot

No managed-store pilot until all of these are true:

- storefront public catalog is host-resolved
- anonymous direct `products` reads cannot leak all tenants
- checkout/order creation is tenant-scoped by host
- PayFast init/callback tenant binding is designed and tested
- XOS host gate remains hard-separated from OPPS
- public tracking remains one-order minimal payload
- private files still use signed URLs only
- catalog management remains Joint X internal
- client product/CMS self-publishing remains disabled
- rollback can disable the storefront host quickly

## Phase 5B Decision

Proceed next with Phase 5B as a narrow tenant-aware products/catalog backend slice.

Do not start checkout, PayFast, custom domains, analytics, client self-publishing, or real client onboarding until the storefront host resolver and public catalog RPCs pass SQL assertions and browser verification on disposable demo data.
