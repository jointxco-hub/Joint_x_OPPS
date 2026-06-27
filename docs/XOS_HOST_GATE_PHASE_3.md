# XOS Host Gate Phase 3

Date: 2026-06-27

## Alignment Check

Confirmed before continuing:
- tenant foundation migrations exist and `joint-x` is seeded by `202606200001_multi_tenant_foundation.sql`
- Phase 2 audit doc exists: `docs/TENANT_PHASE_2_AUDIT.md`
- two-tenant QA doc exists: `docs/TENANT_TWO_TENANT_QA.md`
- host routing plan exists: `docs/TENANT_HOST_ROUTING_XOS_PHASE_0.md`
- Phase 1 host routing migration/test exist: `202606210008_tenant_host_routing.sql`, `supabase/tests/tenant_host_routing.sql`
- Phase 2 host-aware public tracking migration/test/verification doc exist

Notes:
- OPPS currently has an internal active-tenant helper in `src/lib/tenantContext.js` that may use `localStorage` after checking memberships. XOS must not use this helper for tenant selection.
- Older Supabase migration-history drift remains, so production application should use direct SQL for this migration unless that drift is resolved separately.

## Existing App Structure

- `src/App.jsx` owns top-level routing and chooses between public tracking, sign-in, and authenticated OPPS layout.
- `src/lib/AuthContext.jsx` bootstraps Supabase auth.
- `src/lib/tenantContext.js` is the current OPPS active tenant helper for internal data APIs.
- Authenticated host resolver: `public.resolve_authenticated_tenant_host(p_hostname text, p_surface text default 'xos_admin')`.

## Phase 3 Implementation

Added:
- `public.resolve_xos_admin_gate(p_hostname text)`
- XOS host detection for `*.xos.jointx.co.za`
- minimal `XOSAdminShell`
- XOS branch in `App.jsx` that bypasses OPPS layout/tools

Gate behavior:
- browser sends only `window.location.hostname`
- authorized tenant resolution delegates to `resolve_authenticated_tenant_host(p_hostname, 'xos_admin')`
- unknown or inactive XOS hosts return `site_not_configured`
- configured hosts without membership return `access_denied`
- tenant name/slug are returned only when access is allowed

The shell shows only:
- tenant name
- tenant slug
- signed-in account/access state
- placeholders for Orders, Requests, Files, Reports, and Store Settings

The shell does not show:
- finance
- suppliers
- purchase orders
- inventory internals
- production notes
- staff admin
- OPPS internal dashboards
- private files

## Checks

SQL assertions:
- `supabase/tests/xos_admin_gate.sql`

Covered:
- Joint X member can access a mapped Joint X XOS host.
- Tenant A member can access only Tenant A's resolved host.
- Tenant A member is denied on Tenant B host.
- User without membership is denied.
- Unknown XOS host is site-not-configured.
- Query-param and path-like host inputs cannot override host resolution.
- RLS tenant access helper remains the final cross-tenant protection.
- Gate RPC accepts only `p_hostname`.

App checks:
- `npm.cmd run build` passed.
- `npm.cmd run lint` still fails on the existing repo-wide unused import backlog.

Manual QA before production deploy:
- configure only disposable `xos_admin` tenant_domains rows
- sign in as a user with active membership and confirm shell loads
- sign in as a user without membership and confirm access denied
- visit an unmapped `*.xos.jointx.co.za` host and confirm site-not-configured
- add `?tenant_slug=...` and verify the resolved tenant does not change
- seed localStorage tenant cache and verify the resolved tenant does not change
## Production Verification

Date: 2026-06-27
Project ref: `slhcvyeuqsduaglddqdb`

Applied:
- `supabase/migrations/202606240002_xos_admin_gate.sql`
- remote migration history repaired for `202606240002` only

Executed:

```powershell
supabase.exe db query --linked --file supabase\tests\xos_admin_gate.sql --output table
```

Result: passed with no exceptions after correcting the assertion file to inspect PostgreSQL input arguments correctly and to avoid switching the cleanup role.

Verified by SQL assertions:
- disposable Joint X member can access a mapped Joint X XOS host
- disposable Tenant A member can access only Tenant A's resolved XOS host
- Tenant A member is denied on Tenant B host
- user without membership gets `access_denied`
- unknown host gets `site_not_configured`
- query-param and path-like host inputs cannot override host resolution
- RLS tenant access helper denies cross-tenant access
- gate RPC accepts only one `text` hostname argument
- disposable test users, tenants, memberships, and domains were cleaned up

Additional production checks:
- `resolve_xos_admin_gate('unknown.xos.jointx.co.za')` returned `site_not_configured`
- query/path override inputs returned `site_not_configured`
- disposable Phase 3 tenants/domains were absent after the assertion run
- active production `xos_admin` mapping count is currently `0`, as expected because no real client tenant was onboarded

Frontend deploy:

```powershell
npx.cmd vercel --prod --yes
```

Result:
- deployment id: `dpl_5pHSZrrGdexgFsVP4TH8gNPsFQuy`
- deployment URL: `https://joint-x-opps-5hv7lcl0b-joint-x.vercel.app`
- production alias reported by Vercel: `https://ops.jointx.co.za`

Post-deploy route checks:
- `https://ops.jointx.co.za` returned `200`
- `https://ops.jointx.co.za/track` returned `200`
- `https://xlab.jointx.co.za/track` returned `200`

XOS browser-host note:
- `phase3-a.xos.jointx.co.za` does not currently resolve in DNS.
- Browser rendering on an actual `*.xos.jointx.co.za` host remains pending DNS/Vercel host setup with a disposable host mapping.
- The deployed frontend contains the XOS host branch, but no persistent real `xos_admin` tenant domain was added in this phase.

Lint:
- `npm.cmd run build` passed.
- `npm.cmd run lint` remains blocked by the existing repo-wide unused import backlog.

