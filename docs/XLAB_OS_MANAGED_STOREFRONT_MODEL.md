# X LAB OS Managed Storefront Model

Date: 2026-06-27

## Purpose

Define how Joint X will create, manage, and operate ecommerce storefronts for client brands using XOS, OPPS, and X LAB OS.

This is a planning document only. Do not onboard real clients yet.

## Current Foundation

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

## 1. Store Ownership Model

Every managed client store should map to a tenant. A tenant represents the client brand workspace, store data, customer orders, files, requests, and future settings.

Joint X remains the operator/admin organization. OPPS stays the internal Joint X command center at `ops.jointx.co.za`. Client-facing XOS stays separate at `client.xos.jointx.co.za` or a custom XOS host later.

Recommended ownership split:

- Client tenant owns storefront data, customer-facing orders, product catalog records, store settings, requests, and files.
- Joint X owns OPPS operations, production workflow, internal staff tasks, suppliers, purchasing, finance internals, production notes, and platform administration.
- XOS gives the client a tenant-gated workspace for visibility and request workflows.
- X LAB OS storefront gives public shoppers a tenant-scoped ecommerce surface.

Client can control or request:

- brand profile and copy
- product content requests
- storefront content requests
- file uploads or approvals when enabled
- order/status visibility through XOS
- store setting change requests

Joint X controls:

- tenant creation and host mappings
- OPPS production workflow
- product publish approval
- pricing, production feasibility, blanks/materials, and stock rules
- payment configuration
- fulfillment and delivery operations
- private file access and signed URL policy

## 2. Domain Model

Supported domain patterns:

- Storefront subdomain: `client.xlab.jointx.co.za`
- XOS admin/workspace host: `client.xos.jointx.co.za`
- Custom storefront domain: `clientbrand.co.za`
- Public tracking host: mapped through `tenant_domains` with `surface = public_tracking`

Host routing requirements:

- Hostname must decide tenant.
- Query params, local storage, cached tenant slugs, or browser-provided tenant IDs must never select the tenant.
- Storefront hosts must resolve only active tenant domain rows for the storefront surface.
- XOS hosts must resolve only active tenant domain rows for the `xos_admin` surface.
- Public tracking hosts must resolve only active tenant domain rows for the `public_tracking` surface.
- Unknown, malformed, path-like, port-included, trailing-dot, pending, or disabled hosts must not resolve a tenant.

Recommended mapping examples:

- `demo.xlab.jointx.co.za` -> tenant `demo-xos`, surface `storefront`
- `demo.xos.jointx.co.za` -> tenant `demo-xos`, surface `xos_admin`
- `demo-track.xlab.jointx.co.za` or client storefront host -> tenant `demo-xos`, surface `public_tracking`
- `clientbrand.co.za` -> tenant `client-brand`, surface `storefront`

## 3. Product and Catalog Model

Products must be tenant-aware.

Core product concepts:

- product
- variant
- size
- color
- print options
- production method
- blanks/materials
- base cost and price rules
- stock visibility
- publish status
- collection/category
- storefront SEO metadata

Shared vs tenant-specific:

- Joint X inventory can define reusable blanks, materials, production methods, and internal stock/availability.
- Client tenant products should reference approved Joint X production capabilities without exposing supplier costs or internal stock details.
- Client-specific products should belong to the client tenant.
- Shared templates can exist, but storefront-facing products must resolve through tenant-scoped records.

Client can request/edit through XOS:

- product name/copy changes
- images or artwork uploads
- collection placement requests
- storefront visibility requests
- size/color preference requests

Joint X controls:

- final publish state
- pricing approval
- production method validation
- blanks/material availability
- internal costs/margins
- supplier and purchasing data
- inventory truth and production feasibility

## 4. Storefront CMS Model

Tenant-aware storefront CMS fields should include:

- logo
- hero title/copy/media
- brand colors
- product collections
- about/brand story
- policies
- delivery info
- homepage sections
- SEO title/description
- social preview image
- contact/support display details

Client can request or edit, depending on phase:

- brand story
- hero text
- brand colors
- collection descriptions
- policy copy
- delivery information
- product content change requests

MVP should not allow direct self-publishing. Client edits should become XOS requests for Joint X review, then Joint X publishes through an internal workflow.

## 5. Orders Flow

Target flow:

1. Customer places order on client storefront.
2. Storefront resolves tenant from host.
3. Cart and checkout create tenant-scoped order intent.
4. Payment starts.
5. Payment confirms.
6. Confirmed order enters OPPS under the tenant.
7. Production readiness/task records are created for Joint X operations.
8. Client views order status in XOS.
9. Customer receives a public tracking link.
10. Joint X handles production, QC, packing, and delivery.

Order data boundaries:

- Customer-facing storefront sees only checkout/order details needed for the purchase.
- Client XOS sees client-safe order status, stage, dates, totals where approved, item count, and tracking references.
- OPPS sees internal production, staff, supplier, purchasing, and finance workflow.
- Public tracking remains one-order minimal payload only.

## 6. Payment Model

### Option A: Joint X Collects Through PayFast

Joint X uses its PayFast account for the managed storefront.

Pros:

- fastest to launch
- least client setup friction
- Joint X controls reconciliation
- easier to debug first pilot
- payment webhooks stay under one operational model

Cons:

- Joint X must settle client portion manually or monthly
- accounting and reporting must be clear
- client trust and statements matter

### Option B: Client PayFast Merchant Account

Each client uses their own PayFast merchant account.

Pros:

- client receives funds directly
- cleaner ownership for established brands
- less settlement burden on Joint X

Cons:

- more onboarding friction
- harder support/configuration
- webhook routing and credential isolation become critical
- each client account needs operational readiness

### Option C: Hybrid Later

Start with Joint X collection for managed pilots, then support client-owned merchant accounts for mature clients.

Recommendation for Phase 1:

- Use Option A: Joint X collects through PayFast and settles client portions manually/monthly.
- Keep settlement reporting explicit.
- Do not build automated payouts in MVP.

## 7. Revenue Model

Possible packages:

- setup fee for store creation, branding, catalog setup, and launch QA
- monthly management/subscription for hosting, support, updates, and operational management
- production margin on products
- transaction/admin fee per order
- optional content/design support package
- optional stock-holding fee for client-specific blanks or inventory
- optional rush support or campaign management fee

Phase 1 recommendation:

- setup fee
- monthly management fee
- production margin
- simple transaction/admin fee
- optional content/design add-on

Avoid complex automated revenue share until payment and reporting are proven.

## 8. Data Isolation and Security

Rules:

- no cross-tenant product leaks
- no cross-tenant order leaks
- no cross-tenant file leaks
- no client access to OPPS internals
- no raw private Storage URLs
- signed URLs only after tenant membership/host checks
- RLS remains the final boundary
- host decides tenant, not query params, local storage, cached tenant slug, or browser-supplied tenant IDs
- XOS must never mount OPPS layout/sidebar/routes
- storefront public APIs must return only public storefront-safe fields
- public tracking must remain minimal and one-order-only

Sensitive data that must remain OPPS/internal:

- supplier costs
- margins/profit
- purchase orders
- staff tasks
- internal production notes
- finance internals
- private files outside the resolved tenant
- invoice sequence data
- internal mapping data

## 9. MVP Scope

Smallest managed-store pilot:

- one demo managed store
- one tenant
- one storefront domain
- one XOS admin host
- 3 to 5 products
- PayFast using Joint X account initially
- orders sync to OPPS
- production readiness created in OPPS
- client XOS view for orders, requests, and files
- public tracking remains host-aware and minimal
- no client self-editing products yet
- client requests edits through XOS

Pilot product scope:

- simple merch products
- limited variants
- clear pricing
- no complex stock reservations
- no supplier portal
- no automated payouts

## 10. Not In MVP

Explicitly excluded:

- full Shopify-like builder
- multi-currency
- automated payouts
- supplier portal
- full analytics
- client product self-publishing
- advanced inventory syncing
- public marketplace
- client-controlled payment credentials
- client-managed product publish workflow
- complex promotions engine
- subscriptions or recurring customer billing

## 11. Phase Plan

### Phase 5A: Storefront Tenant Model Audit

- audit current X LAB storefront/CMS/catalog/payment architecture
- identify tenant-unsafe assumptions
- map current product/order/payment tables to tenant boundaries
- produce migration/test plan

### Phase 5B: Tenant-Aware Products/Catalog

- add or harden tenant-scoped product/catalog tables
- define variants, sizes, colors, print options, collections, and publish state
- add SQL tests for cross-tenant denial
- keep client self-publishing disabled

### Phase 5C: Managed Storefront Public Host

- add storefront host resolver for `surface = storefront`
- make storefront load tenant by hostname only
- support `client.xlab.jointx.co.za` and later custom domains
- verify unknown/malformed hosts do not resolve

### Phase 5D: PayFast/Order Sync Per Tenant

- tenant-scope checkout/order intent
- confirm PayFast callback/webhook tenant resolution
- create confirmed OPPS orders under resolved tenant
- preserve public tracking and production workflow boundaries

### Phase 5E: XOS Store Settings/Request-Edit Workflow

- add XOS store settings view
- client submits product/CMS/edit requests
- Joint X reviews and applies changes internally
- no direct client publish in this phase

### Phase 5F: First Controlled Managed-Store Pilot

- launch one demo or controlled client pilot
- use Joint X PayFast account
- run full order lifecycle
- verify rollback, monitoring, and support process
- only then decide real client onboarding readiness

## 12. Go/No-Go Checklist

Go before first real managed store only if:

- storefront tenant resolver is tested
- XOS host gate remains hard-separated from OPPS
- tenant-aware product/catalog SQL tests pass
- checkout/order sync creates orders only in resolved tenant
- PayFast callbacks cannot cross tenants
- public tracking remains one-order minimal payload
- private files use signed URLs only
- client cannot access OPPS sidebar/dashboard/routes
- client cannot see supplier, finance, staff task, or internal production data
- rollback steps are documented and tested
- support owner and escalation path are assigned

Rollback plan:

- disable storefront `tenant_domains` row
- disable XOS `tenant_domains` row if needed
- unpublish tenant products
- pause PayFast checkout for the tenant
- revert frontend deploy if needed
- preserve OPPS order records for audit
- remove demo/pilot data only when explicitly approved

Monitoring plan:

- monitor storefront 200/500 responses
- monitor checkout/payment callback failures
- monitor order sync failures
- monitor XOS access denied/site not configured rates
- monitor signed URL failures
- monitor public tracking payload shape
- keep a manual launch-day verification checklist

Support process:

- Joint X owns first-line support for managed storefront operations
- client submits changes/issues through XOS Requests
- urgent production/payment issues route to OPPS internal owner
- all client-facing changes should be logged as tenant-scoped requests
- no direct database edits for client requests unless documented as controlled support action

## Decision

Proceed next with Phase 5A: storefront tenant model audit. Do not onboard real clients or alter the X LAB storefront/CMS/catalog/payment architecture until the audit identifies the smallest safe implementation path.
