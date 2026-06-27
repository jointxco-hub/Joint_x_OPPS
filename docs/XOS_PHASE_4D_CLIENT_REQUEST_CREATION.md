# XOS Phase 4D Client Request Creation

Date: 2026-06-27

## Status

Implementation verified for controlled Demo XOS deployment.

Phase 4D adds client request creation to the existing live demo workspace loop:

- Orders
- Requests
- Files

It does not add request editing, request deletion, OPPS internal views, tenant switching, staff assignment, finance, supplier data, or full portal behavior.

## Backend

Added RPC:

- `create_xos_request_for_host(p_hostname, p_title, p_message, p_category, p_priority)`

The RPC:

- resolves the tenant from the authenticated XOS host resolver
- requires the signed-in user to have active membership in the host-resolved tenant
- inserts only into the resolved tenant
- stores requests in `client_quote_requests` so OPPS can receive them through the existing client request bridge
- rejects empty or too-short title/message input
- limits title and message length
- normalizes category and priority
- grants execute to `authenticated` only, not `anon`

## Exposed Fields

The create RPC returns only:

- `id`
- `title`
- `category`
- `priority`
- `status`
- `created_at`

## Intentionally Hidden

The RPC and XOS UI do not return or expose:

- `tenant_id`
- `client_id`
- staff assignments
- internal notes
- internal workflow fields
- OPPS dashboard/sidebar/routes
- finance, cost, margin, supplier, purchasing, inventory, or production-internal data
- private file paths
- cross-tenant data

## Frontend

`XOSAdminShell` now adds a `New Request` control inside the Requests module.

The form captures:

- Title
- Category
- Priority
- Message

On submit, it calls the secure host-scoped RPC with `window.location.hostname`, shows success/error/loading state, and refreshes the Requests list.

## Security Boundaries

- XOS host gating is unchanged.
- Tenant selection still comes only from the hostname resolver.
- Query params, local storage, cached OPPS tenant state, or browser-supplied tenant slugs cannot choose the tenant.
- XOS users can create only in their host-resolved tenant.
- XOS does not mount OPPS layout, OPPS route tables, or internal data clients.
- Creation is insert-only; no edit/delete request actions exist in XOS.

## QA Checklist

Completed checks:

- `supabase/tests/xos_client_request_creation.sql` passed
- `supabase/tests/xos_requests_files_demo.sql` passed
- `supabase/tests/xos_orders_preview.sql` passed
- `npm.cmd run check:xos-boundary` passed
- `npm.cmd run build` passed

Manual browser checks:

- `demo.xos.jointx.co.za` renders the XOS shell only
- Requests module shows `New Request`
- demo member can submit a request
- new request appears in the Requests list
- OPPS receives the request through the existing client request bridge
- non-member is denied by host gate
- Orders still render read-only
- Files still render and open through signed links
- no OPPS dashboard/sidebar appears on the demo host

## Deployment Status

Not deployed yet. Frontend deploy and authenticated browser QA remain pending.

## Known Limitations

- XOS request creation is demo-controlled and insert-only.
- No attachments on new XOS requests yet.
- No request edit/delete actions yet.
- No real client onboarding until the separate onboarding checklist is approved.
