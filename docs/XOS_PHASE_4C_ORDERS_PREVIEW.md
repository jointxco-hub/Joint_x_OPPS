# XOS Phase 4C Orders Preview

Date: 2026-06-27

## Status

Live verified for the Demo XOS workspace.

Phase 4C adds a read-only Orders preview to `demo.xos.jointx.co.za`. It does not add order mutation, OPPS routes, tenant switching, finance tools, supplier views, production staff tools, or full portal behavior.

## Backend

Added RPC:

- `get_xos_orders_for_host(p_hostname, p_limit)`

The RPC:

- resolves tenant access through the existing authenticated XOS host gate path
- requires active membership in the host-resolved tenant
- returns only orders owned by the resolved tenant
- caps result size with a safe limit
- denies unknown, malformed, path-like, query-param, or cross-tenant host attempts through the resolver
- is executable by `authenticated` only, not `anon`

## Exposed Fields

The Orders preview returns only client-facing fields:

- `order_number`
- `client_name`
- `status`
- `stage`
- `created_at`
- `due_date`
- `total_amount`
- `item_count`
- `tracking_reference`
- `summary`

`summary` is sourced from the client-facing production update field.

## Intentionally Hidden

The RPC and UI do not return or render:

- `tenant_id`
- order UUIDs
- client email/phone
- internal costs
- supplier costs
- profit or margin
- deposits or finance internals
- supplier data
- private file paths
- invoice file arrays
- internal staff notes
- production hold reasons
- production internal notes
- OPPS dashboard/sidebar/routes
- X LAB storefront/CMS/catalog/payment/analytics internals

## Demo Data

The migration seeds three disposable `demo-xos` orders:

- `DEMO-XOS-1001` confirmed/artwork check
- `DEMO-XOS-1002` in production/pressing
- `DEMO-XOS-1003` ready/packing

All seeded rows use obvious `DEMO-XOS` labels and no real client data.

## Frontend

`XOSAdminShell` now:

- marks Orders as `Available now`
- keeps Requests and Files active
- keeps Reports and Store Settings as `Coming soon`
- renders a read-only Orders panel above Requests and Files
- includes loading, empty, and error states
- does not mount OPPS layout, OPPS sidebar, or OPPS route tables
- keeps file access through the existing signed-link component

## Verification

Completed checks:

- `202606270006_xos_orders_preview.sql` applied to the linked database by controlled direct SQL
- `supabase/tests/xos_orders_preview.sql` passed
- `supabase/tests/xos_requests_files_demo.sql` passed as a Requests/Files regression
- `npm.cmd run check:xos-boundary` passed
- `npm.cmd run build` passed

Deployment:

- Phase 4C deployed to production.
- Production route: `https://demo.xos.jointx.co.za`
- Deployment verified.

Authenticated browser QA passed:

- Orders card shows `Available now`.
- Orders section renders demo orders.
- Orders are read-only.
- Requests still render.
- Files still render.
- Signed file open works through the signed Storage URL flow.
- No OPPS dashboard/sidebar appears on the demo host.
- No risky internal order fields were visible.

Current active client workspace loop:

- Orders
- Requests
- Files

## Real Client Status

Real client onboarding remains paused. Phase 4C is live-verified as a controlled demo-only preview; real onboarding still needs a separate go/no-go checklist.
