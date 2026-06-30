# X LAB OS Phase 5C - Storefront Host Catalog UI

Date: 2026-06-30

## Status

Frontend integration completed for controlled deployment verification. This phase switches storefront catalog loading to the tenant-aware backend from Phase 5B.

No checkout, PayFast, custom domain, analytics, client self-publishing, or real client onboarding work was done.

## Scope

Phase 5C keeps the original storefront UI/customer experience and changes only the host routing needed for storefront domains plus the catalog data source.

Changed files:

- `src/lib/storefrontHost.js`
- `src/App.jsx`
- `src/pages/ClientCatalog.jsx`

## Correction Note

After initial production review, Phase 5C was narrowed so xlab.jointx.co.za keeps the original ClientCatalog storefront experience. The retained change is the backend-safe host/catalog integration; storefront layout, hero, branding, cart UX, product cards, checkout UI, copy, and PayFast behavior remain unchanged.

## What Changed

### Storefront Host Detection

Added `src/lib/storefrontHost.js`.

Behavior:

- reads `window.location.hostname`
- lowercases and trims hostname
- strips a port suffix
- strips a trailing dot
- treats `xlab.jointx.co.za` and `*.xlab.jointx.co.za` as storefront hosts
- does not use query params, local storage, cached tenant slugs, or manual tenant selection

### Storefront Public Route Branch

`src/App.jsx` checks storefront hosts before mounting the OPPS app, but still renders the existing `ClientCatalog` page rather than a separate storefront experience.

On storefront hosts:

- routes `/` and `/ClientCatalog` to the existing `ClientCatalog` page
- does not mount OPPS layout/sidebar/routes
- does not run OPPS auth redirect logic
- does not change `ClientCatalog` layout, hero, branding, cart UX, product cards, checkout UI, or copy

Tracking routes are preserved inside the storefront branch:

- `/track`
- `/TrackOrder`

Those routes continue to render `TrackOrder` so `https://xlab.jointx.co.za/track` remains a public tracking route.

### Tenant-Aware Catalog UI

`src/pages/ClientCatalog.jsx` no longer reads `products` through `dataClient.entities.CatalogItem.list(...)`.

It now uses:

- `resolve_public_storefront_tenant(p_hostname)`
- `get_storefront_catalog_for_host(p_hostname, p_limit)`

The hostname is passed from the browser hostname only after local normalization. The frontend does not send tenant IDs, tenant slugs, query params, or local-storage values.

If the host is unknown or not mapped to an active storefront tenant, the page shows:

- `Storefront not configured`

There is no fallback to global products.

## Expected Demo Host Behavior

`https://demo.xlab.jointx.co.za` should load the same X LAB storefront UI/customer experience and request catalog data through the host-scoped RPC.

If DNS/domain wiring is configured, the visible catalog should contain only the seeded `DEMO-XOS` products from Phase 5B:

- `DEMO-XOS Launch Tee`
- `DEMO-XOS Studio Hoodie`
- `DEMO-XOS Campaign Cap`
- `DEMO-XOS Event Tote`

No tenant ID, private file path, supplier cost, margin, purchase data, internal inventory field, OPPS note, or internal production field should appear in the catalog payload or UI.

## Expected Joint X Storefront Behavior

`https://xlab.jointx.co.za` should keep the previous X LAB storefront look and customer experience while loading catalog data through the host-scoped RPC.

`https://xlab.jointx.co.za/track` and `https://xlab.jointx.co.za/TrackOrder` should continue to render the public tracking page, not the catalog.

## Verification Checklist

Local checks:

- `npm.cmd run build`
- `npm.cmd run check:xos-boundary`

Live checks after deploy:

- `https://xlab.jointx.co.za` returns 200 and visually matches the previous X LAB storefront experience
- `https://xlab.jointx.co.za/track` returns 200 and public tracking still works
- `https://demo.xlab.jointx.co.za` returns 200 if DNS/domain is configured
- `https://demo.xlab.jointx.co.za` shows only `DEMO-XOS` catalog products if configured
- unknown storefront host shows `Storefront not configured`
- `https://ops.jointx.co.za` still loads OPPS
- `https://demo.xos.jointx.co.za` still loads XOS and does not fall through to OPPS

## Remaining Limitations

Still not implemented:

- checkout tenant scoping
- PayFast tenant binding
- custom domains
- tenant-aware storefront CMS/store config
- analytics
- client product self-publishing
- managed-store pilot onboarding

The current storefront visual copy remains Joint X/X LAB-oriented until a later CMS/store config phase.

## Decision

Phase 5C is the smallest safe frontend bridge from the Phase 5B backend to the existing storefront UI. The storefront must not be redesigned in this phase; proceed next only after production route checks confirm the host branch and catalog RPC behavior.
