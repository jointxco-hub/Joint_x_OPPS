# Tenant/Host Routing And XOS Phase 0

## Decision

This is a planning phase only. No real tenant is onboarded, no tenant switcher is introduced, and the existing Joint X public applications remain unchanged until the routing QA passes.

The system will resolve a tenant from the request host, not from a browser-supplied tenant slug. Host resolution determines the public tenant context; authenticated access still requires an active `tenant_memberships` row and RLS remains the final enforcement boundary.

## Target Topology

| Surface | Initial host | Tenant | Purpose | Access |
| --- | --- | --- | --- | --- |
| OPPS command center | `ops.jointx.co.za` | `joint-x` | Internal operations, finance, production, and staff workflows | Authenticated Joint X membership |
| X LAB storefront | `xlab.jointx.co.za` | `joint-x` | Existing connected storefront | Existing public/storefront model unchanged |
| Joint X public tracking | `ops.jointx.co.za/track` and existing X LAB links | `joint-x` | One requested order only | Anonymous, minimal result |
| XOS client admin | `<tenant>.xos.jointx.co.za` | Resolved tenant | Future client-facing operational administration | Authenticated membership in resolved tenant |
| Client public domain | `track.client-domain.example` or client custom host | Resolved tenant | Future branded tracking/public routes | Anonymous, minimal result |

`ops.jointx.co.za` remains the internal command center. XOS is a separately framed client-admin surface, initially host-scoped to one tenant. A user who belongs to several tenants must enter the relevant tenant host; a broad in-app tenant switcher is deliberately out of scope for Phase 0.

## Host Resolution Contract

1. Read `window.location.hostname` in the browser for presentation and route selection only.
2. Normalize it to lowercase ASCII hostname form, strip any port, reject empty values, and never accept a full URL or path.
3. Resolve it through a database-owned host mapping with active status.
4. Use the resolved tenant only for that request/surface. Do not accept `tenant_id` or `tenant_slug` query parameters as an override.
5. For authenticated routes, intersect the resolved tenant with the signed-in user's active memberships. RLS continues to protect every data query.
6. For anonymous routes, a security-definer RPC resolves the host internally and returns only the explicitly approved public payload.

The current `jx_current_tenant` local-storage value can remain a convenience cache for existing Joint X work, but it must not choose the tenant for a host-scoped XOS route. It will be replaced or constrained by the resolved host context when Phase 1 is implemented.

## Database Plan

Additive migration: `tenant_domains`.

```sql
create table public.tenant_domains (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  hostname text not null,
  surface text not null check (surface in ('ops', 'xos_admin', 'public_tracking', 'storefront')),
  status text not null default 'pending' check (status in ('pending', 'verified', 'active', 'disabled')),
  is_primary boolean not null default false,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (hostname, surface)
);

create unique index tenant_domains_one_primary_per_surface
  on public.tenant_domains (tenant_id, surface)
  where is_primary and status = 'active';
```

The production migration will also:

- normalize and validate `hostname` in a trigger: lowercase, no scheme, no path, no port, no wildcard, and no trailing dot;
- allow one hostname to expose several approved surfaces, but reject any attempt to map that hostname to different tenants;
- seed only verified active Joint X rows for `ops.jointx.co.za` and `xlab.jointx.co.za` with the appropriate surfaces;
- enable RLS; allow app admins to manage mappings while regular members cannot enumerate domains;
- expose a minimal `resolve_tenant_host(p_hostname, p_surface)` RPC for public routing, returning only active mappings and safe display configuration;
- add an authenticated resolver that confirms both the active mapping and membership before XOS loads protected data;
- preserve the existing slug-based tracking RPC during migration, then replace browser calls with a host-based wrapper before the legacy parameter is retired.

Tenant branding/public configuration belongs in an explicitly allowlisted JSON shape in `tenants.settings` or a later `tenant_public_settings` table. It must not let arbitrary tenant content choose routes, storage buckets, or RPC behavior.

## Public Tracking Design

Replace the browser call that currently sends `p_tenant_slug: "joint-x"` with a host-aware RPC, conceptually:

```text
get_public_order_tracking_for_host(p_lookup, p_hostname)
  -> normalize host
  -> resolve active tenant_domains row for surface = public_tracking
  -> find one matching order inside that tenant
  -> return the existing minimal public JSON only
```

Order number, courier tracking number, and supported invoice number remain lookup keys. The result is still limited to one order, ordered deterministically, with no list endpoint and no task, finance, project, purchasing, asset, sequence, or internal-note data.

The public RPC must not return `tenant_id`, membership data, internal host mappings, or unapproved tenant settings. A hostname is routing input, not authentication: someone can type another public host into an API request, so the payload must remain safe for anyone who could visit that public host. Add rate limiting and abuse monitoring at the edge before enabling client-branded public tracking.

## Route Boundaries

Tenant-aware in the future:

- `/track` on an active `public_tracking` host.
- XOS client-admin routes on an active `xos_admin` host.
- Tenant-branded client invoice/portal routes only after their exact public data contract and signed-file behavior are approved.

Remain Joint X/internal only:

- OPPS dashboard, orders, production, finance, purchasing, internal projects, and staff administration at `ops.jointx.co.za`.
- Existing `xlab.jointx.co.za` storefront, CMS, catalog, payment, discount, and analytics routes. They remain untouched until a separate storefront architecture decision.
- Admin management of tenants, memberships, and domains.

During rollout, an unknown host must show a neutral "site not configured" response and must never fall back to `joint-x`. This prevents a DNS or deployment mistake from silently serving Joint X data on another tenant's domain.

## Security Controls

- Canonicalize hostnames once in a shared helper and validate them again inside database resolver functions.
- Make hostname globally unique; do not support wildcard mappings in the first release.
- Require `verified` before `active`; verification is an operational DNS/TLS step, recorded by an app admin or controlled deployment workflow.
- Treat `Host`, `Origin`, query strings, local storage, and a browser-provided tenant slug as untrusted routing hints, never authorization.
- Use resolved-host plus active membership for XOS; do not rely on super-admin cross-tenant bypass. Super-admin access requires explicit tenant membership as established in QA.
- Keep tenant IDs and parent-link triggers on all writes. Host resolution adds context but cannot replace RLS or the existing database guards.
- Restrict CORS/origin allowlists at the deployment and Supabase configuration level as client domains are activated.
- Log host-resolution misses, disabled-domain requests, public lookup failures, and repeated lookup attempts without recording sensitive lookup values in application logs.

## Rollout Plan

1. **Phase 0: architecture and inventory**: approve this document, list current Vercel/DNS ownership, and identify the deployment layer that can route custom hosts.
2. **Phase 1: domain registry**: ship the additive migration, seed Joint X mappings, and add resolver tests. Existing browser behavior stays hard-coded to Joint X until the mappings are verified.
3. **Phase 2: host-aware tracking**: add the host-based public tracking RPC and client helper. Run the public-tracking QA below using Joint X first, then disposable tenant hosts only.
4. **Phase 3: XOS host gate**: add the resolved host/membership gate to the client-admin shell. No switcher; inaccessible tenants receive a clear access-denied state.
5. **Phase 4: controlled client-domain activation**: verify DNS/TLS, create one mapping, run isolation and public-route QA, then activate. Do not bulk onboard domains.

Each phase is additive and reversible by disabling a `tenant_domains` row. Do not remove the existing Joint X tracker or storefront routes during the rollout.

## Tenant Public Tracking QA

- `ops.jointx.co.za/track` resolves only `joint-x` and continues to return one matching Joint X order.
- An active disposable tenant host resolves only that tenant; matching order, courier, and invoice lookup each return one row at most.
- The same lookup on Tenant A and Tenant B hosts cannot cross-return orders when identifiers overlap.
- Unknown, disabled, pending, malformed, scheme-prefixed, port-bearing, and trailing-dot hosts resolve to no tenant.
- A browser query parameter cannot change the resolved tenant.
- Direct RPC calls with a different public hostname return only that hostname's approved tenant payload; they never expose lists or internal data.
- Authenticated XOS page load fails for a user without membership in the resolved tenant, even if that user has a cached local tenant ID.
- Explicit multi-tenant membership works only on the corresponding active host; verify no cross-tenant fallback.
- Re-run the existing two-tenant read, mutation, parent-link, invoice-sequence, reporting, and public-payload tests after introducing host routing.

## Private Uploads Connection: Phase 2C.1

Host routing determines which tenant may request a file. It does not make a public `uploads` URL private. Before client onboarding:

- move tenant-sensitive files to a private bucket or private tenant-prefixed paths;
- enforce tenant membership and record ownership before creating a signed URL;
- have the signed-URL RPC resolve the tenant from the authenticated host context and verify the metadata row belongs to it;
- keep anonymous public tracking free of raw asset URLs unless an explicitly public, short-lived asset contract is approved;
- include domain/host QA in signed-URL tests so a Tenant A host/session cannot request Tenant B metadata or object paths.

## X LAB Bridge Follow-up

After `supabase login` restores the CLI session, rerun the rollback-only Tenant A to Tenant B bridge probe against:

- `get_internal_client_requests` list/read filtering;
- `update_internal_client_request_status` mutation denial;
- file-reply creation and parent-message linkage;
- bridge records for requests, messages, and file metadata where available.

Record the result in `TENANT_TWO_TENANT_QA.md`. This verification remains independent of host routing: the bridge wrappers must enforce tenant membership even when invoked directly.

## XOS Readiness Exit Criteria

Phase 0 is ready to move into implementation when:

- the deployment/DNS owner and custom-domain verification method are known;
- `tenant_domains` schema and resolver contract are approved;
- public route payloads are explicitly classified as public or authenticated;
- the upload hardening design is accepted as an onboarding prerequisite;
- the X LAB bridge mutation probe is completed; and
- a disposable tenant host QA plan is scheduled before any real domain is activated.
