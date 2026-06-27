# XOS Controlled Onboarding Readiness

Date: 2026-06-27

## Status

Planning phase only. Do not onboard a real client yet.

This document prepares the first safe demo/client onboarding path after the core tenant, host, file, and bridge blockers were closed.

Closed blockers:

- Phase 3 XOS Host Gate is closed.
- Phase 2C.1 Private Uploads + Signed URLs is closed for engineering.
- X LAB bridge mutation recheck is closed for engineering.

## First Demo Tenant

Use the existing controlled demo tenant target:

- Tenant slug: `demo-xos`
- Host: `demo.xos.jointx.co.za`
- Surface: `xos_admin`
- Purpose: prove the client-facing XOS surface without exposing internal OPPS.

Do not create or onboard a real client tenant during this readiness phase.

## Access Model

Only signed-in users with an active `tenant_memberships` row for the host-resolved tenant may access the XOS shell.

Allowed access for `demo-xos`:

- demo tenant member users explicitly added to `demo-xos`
- Joint X admin/test users only if they are intentionally added to `demo-xos` for QA

Denied access:

- signed-out visitors
- signed-in users without `demo-xos` membership
- users with membership in another tenant only
- users trying to pass tenant slugs, tenant IDs, query params, local storage, or cached OPPS tenant state

The browser may only send `window.location.hostname`. Tenant selection must come from the authenticated host resolver and database membership checks.

## Client-Visible Surface

The current XOS shell may show:

- resolved tenant name and slug
- logged-in user email/access state
- `XOS Boundary Active` runtime marker while the boundary remains under active verification
- placeholder cards for future modules

The first minimal modules should be:

- Requests
- Files

Client users may see only tenant-owned client-facing records that are explicitly allowed for the XOS surface.

## Must Never Expose

XOS must never render or expose:

- OPPS dashboard/sidebar
- internal OPPS routes
- internal orders across tenants
- internal finance
- suppliers
- purchase orders
- inventory internals
- production notes
- staff tasks
- private files outside the user's resolved tenant
- raw private Storage URLs
- X LAB storefront/CMS/catalog/payment/analytics internals

RLS remains the final protection boundary, but XOS should also avoid mounting OPPS layout, OPPS APIs, tenant local-storage helpers, and internal navigation entirely.

## Remaining Risks

- Legacy public file URLs may still exist in historical database fields and need a controlled backfill/recovery plan.
- The initial XOS shell has no real module data yet; first module RPCs need their own tenant-scoped tests before use.
- `demo-xos` must remain disposable and clearly marked as demo data.
- Supabase migration history drift still exists; production SQL changes may need controlled direct SQL application and explicit documentation.
- Lint remains blocked by the existing repo-wide unused-import backlog.
- XOS service-worker/cache behavior should stay guarded so stale OPPS bundles cannot control `*.xos.jointx.co.za`.

## Seeded Demo Data Plan

Use only disposable records with obvious prefixes such as `DEMO-XOS`.

Seed minimum data:

- one `demo-xos` tenant, if not already present
- one active `xos_admin` host mapping for `demo.xos.jointx.co.za`
- one or two demo membership users
- two demo client requests
- two demo file metadata rows using `private-upload://uploads/<demo_tenant_id>/...`
- optional one public-safe display asset in `public-assets`

Do not seed:

- real client names
- real client files
- supplier data
- purchase orders
- finance records
- production notes
- staff tasks
- payment/storefront/CMS records

Demo cleanup must remove memberships, host mapping, request rows, file metadata rows, and storage test objects where applicable.

## Phase 4A Proposal

Build only the smallest safe implementation:

1. Add a tenant-aware XOS Requests RPC.
   - Resolve tenant from `resolve_xos_admin_gate(window.location.hostname)`.
   - Require active membership in the resolved tenant.
   - Return only demo/client-facing request fields.
   - Exclude internal notes, OPPS assignment data, staff-only status details, and cross-tenant data.

2. Add a tenant-aware XOS Files RPC.
   - Require active membership in the resolved tenant.
   - Return only file metadata rows owned by the resolved tenant.
   - Generate short-lived signed URLs only after membership/tenant checks.
   - Never return raw private bucket URLs or persisted signed URLs.

3. Add minimal shell tabs or cards for `Requests` and `Files`.
   - Keep Orders, Reports, and Store Settings as placeholders.
   - Do not mount OPPS layouts, sidebars, route tables, or internal data clients.

4. Add SQL assertions.
   - `demo-xos` member can read demo tenant requests/files.
   - non-member is denied.
   - Tenant A cannot read Tenant B requests/files.
   - query params and local storage cannot override host-resolved tenant.
   - signed URL helper rejects cross-tenant private paths.
   - public tracking still exposes no private file arrays.

5. Add browser checks.
   - XOS host renders only XOS shell.
   - Requests list shows only demo tenant demo requests.
   - Files list opens only signed URLs for demo tenant files.
   - OPPS at `ops.jointx.co.za` still works normally.
   - `ops.jointx.co.za/track` and `xlab.jointx.co.za/track` still work.

## Manual Browser Checklist

Before Phase 4A implementation:

- `demo.xos.jointx.co.za` logged out shows XOS sign-in only.
- Google and email/password sign-in return to `https://demo.xos.jointx.co.za/`.
- signed-in non-member sees `Access Denied`.
- signed-in demo member sees minimal XOS shell only.
- no OPPS sidebar/dashboard appears on XOS.
- `ops.jointx.co.za` still renders OPPS normally.
- `ops.jointx.co.za/track` returns public tracking.
- `xlab.jointx.co.za/track` returns public tracking.

After Phase 4A implementation:

- Requests module lists only `demo-xos` demo requests.
- Files module lists only `demo-xos` demo files.
- file clicks use `/storage/v1/object/sign/uploads/...`.
- no `private-upload://` refs appear in rendered public tracking pages.
- no `tenant_id` appears in public tracking payloads.
- local storage `jx_current_tenant` cannot change XOS tenant.
- query params cannot change XOS tenant.

## Rollback Plan

Fast rollback options:

- disable the `demo.xos.jointx.co.za` `tenant_domains` row by setting `status = 'disabled'`
- remove demo tenant memberships
- revert the Phase 4A frontend deploy
- revoke or replace new XOS RPCs with deny-only implementations
- delete disposable demo records and private storage test objects

Disabling the host mapping should make the XOS host render `Site Not Configured` without affecting OPPS or public tracking.

## Go/No-Go Checklist

Go for Phase 4A implementation only if:

- `demo.xos.jointx.co.za` shows the XOS boundary and no OPPS fallthrough.
- demo membership and non-membership browser checks pass.
- Requests and Files data contracts are approved as client-facing.
- SQL tests exist before deploying module data.
- private file access uses signed URLs only.
- no OPPS layout/routes/data clients are mounted in XOS.
- rollback steps are ready and tested against the demo host.

No-go for real client onboarding if any of these are true:

- a XOS host can render OPPS layout or internal routes
- any module can read across tenants
- private files can be opened without signed URL authorization
- public tracking exposes private file refs or tenant IDs
- demo data is mixed with real client data
- rollback cannot disable the demo host quickly

## Decision

Proceed next with Phase 4A design/implementation for `demo-xos` Requests and Files only. Keep real client onboarding paused until Phase 4A passes SQL assertions, browser verification, rollback verification, and a separate onboarding checklist.
