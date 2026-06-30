# X LAB Storefront Integration Boundary

Date: 2026-06-30

## Status

Architecture correction note after the Phase 5C routing incident.

No code changes are part of this note.

## Correction

`xlab.jointx.co.za` was restored to the original X LAB Vercel project after it was temporarily pointed at the OPPS/XOS project during Phase 5C.

The original X LAB storefront remains the production customer-facing storefront for:

- storefront UI and visual experience
- product browsing and detail pages
- cart and shop interactions
- checkout-facing customer flow
- X LAB brand presentation

OPPS/XOS must not render, replace, proxy, or recreate the X LAB storefront UI.

## Boundary

X LAB storefront remains a separate frontend project.

OPPS/XOS provides tenant-safe backend capabilities only, including:

- host-aware tenant resolution
- tenant-scoped catalog APIs
- tenant-scoped order/status APIs when approved
- private file and signed URL boundaries
- XOS client workspace visibility and request workflows
- OPPS internal operations workflows

Future tenant-aware storefront work must integrate those backend APIs into the original X LAB frontend project. It must not route `xlab.jointx.co.za` to OPPS/XOS.

## Phase Impact

Phase 5B remains useful.

The Phase 5B backend work established the safe foundation for storefront catalog reads:

- `resolve_public_storefront_tenant(p_hostname)`
- `get_storefront_catalog_for_host(p_hostname, p_limit)`
- product public-read/RLS hardening
- storefront host/catalog SQL regression tests

The Phase 5C OPPS frontend routing work is rejected and superseded for production architecture purposes. It should not be used as the path for managed storefront UI integration.

Future Phase 5C should be renamed:

```text
Phase 5C - X LAB Frontend API Integration
```

That future phase should happen in the original X LAB frontend project and should consume the tenant-safe backend APIs without changing the storefront ownership boundary.

## Go/No-Go

No real client managed-store onboarding until:

- the original X LAB frontend consumes tenant-safe catalog APIs safely
- `xlab.jointx.co.za` remains assigned to the X LAB Vercel project
- OPPS/XOS remains separate from the public storefront UI
- catalog reads are host-resolved and tenant-scoped
- checkout and PayFast tenant binding are designed and tested separately
- public tracking remains minimal and host-aware
- XOS remains the tenant-gated client workspace, not the storefront

## Decision

Keep X LAB storefront UI ownership in the original X LAB frontend project. Use OPPS/XOS for backend safety, tenant boundaries, operations, and client workspace workflows only.
