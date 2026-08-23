-- Managed Clients Control Plane — Phase 0/1.
--
-- OPPS internal read-only surface reconciling two generations of managed
-- brand/workspace data:
--   - LEGACY: public.managed_client_workspaces (id, tenant_id, client_id,
--     business_id, brand_id, storefront_id, client_type, onboarding_stage,
--     site_type, site_status, storefront_status, domain_status,
--     assets_status, content_status, products_services_status,
--     pricing_status, mockup_status, launch_readiness_status, preview_url,
--     live_url, domain_name, site_repo_url, next_action,
--     next_action_owner, next_action_due_at, launch_target_date,
--     internal_notes, created_at, updated_at) - a surviving table that
--     predates the XOS tenant architecture. All 3 surviving rows point at
--     the Joint X system tenant (their own linked public.clients row is
--     also still tenant-scoped to Joint X - they were never migrated to a
--     dedicated tenant). This migration does not alter this table's
--     schema, does not touch its rows, and does not add a competing
--     table.
--   - MODERN: tenant -> client -> tenant_domains -> tenant_memberships ->
--     tenant_capabilities -> Commerce, the architecture every new managed
--     brand (e.g. GSB) now uses (see
--     supabase/provisioning/xos_tenant_provisioning_template.sql). A
--     modern managed tenant may have NO managed_client_workspaces row at
--     all yet (GSB has none) - that is an expected, valid state, not an
--     error.
--
-- Reconciliation identity rule (see admin_list_managed_clients below):
-- for every tenant that qualifies as a "modern managed tenant" - see the
-- modern_tenants CTE for the exact structural eligibility rule (post-
-- review: slug alone is not sufficient) - resolve its one representative
-- public.clients row (the provisioning template creates exactly one; the
-- oldest is chosen if more than one ever exists, for stability), then
-- look for a managed_client_workspaces row whose client_id AND tenant_id
-- both match (post-review: client_id alone is not sufficient - the
-- table's real uniqueness is (tenant_id, client_id); a workspace whose
-- tenant_id disagrees with its own client's current tenant is a data
-- integrity anomaly and must never be silently absorbed into a modern
-- tenant's row). If found, the workspace and tenant data are merged into
-- ONE row. If a modern tenant has no matching workspace row, it is still
-- emitted - with every legacy/workspace field null - so a brand-new
-- managed tenant like GSB appears automatically without needing a
-- workspace row created for it. Every managed_client_workspaces row that
-- was NOT matched to a modern tenant this way (all 3 current historical
-- rows, since their linked clients are still Joint-X-scoped, and any
-- future tenant/client-mismatched row) is emitted as its own
-- "legacy-only" row, always with tenant_id = null in the projection -
-- never the workspace's own (possibly mismatched, possibly system-tenant)
-- raw tenant_id, which would misleadingly imply a Commerce-eligible
-- modern tenant identity it does not have. This guarantees: (a) no
-- managed brand is ever listed twice, (b) no workspace row is ever
-- silently dropped, because exclusion from the legacy set uses the exact
-- same (client_id, tenant_id) join key as inclusion in the modern set.
--
-- Post-review: Commerce onboarding must only ever be offered for a row
-- with a genuine modern tenant identity (tenant_id is not null, i.e.
-- source in ('modern','both')) - never for a legacy-only row, even though
-- every legacy row does carry a real client_id. Those clients still
-- belong to the Joint X tenant; XOS 3B derives the Commerce tenant from
-- public.clients.tenant_id, so onboarding from a legacy-only row would
-- create/link Commerce state under Joint X, which is architecturally
-- wrong. This RPC still returns client_id for every row (the frontend
-- needs it either way, e.g. to link to the Clients page), but the
-- Commerce-eligibility decision is `tenant_id is not null`, enforced in
-- the UI (src/pages/ManagedClients.jsx) - see that file's own note.
--
-- admin_list_managed_clients() follows the exact staff-authority pattern
-- already established and corrected in XOS 3B (see 20260823120000's
-- header note): is_opps_staff() alone is the actor gate - it is a global
-- "is this an active Joint X staff member" check, not scoped to any one
-- tenant, which is exactly what a cross-tenant internal control plane
-- needs.
--
-- Post-review: this phase ships read-only. An earlier revision also added
-- admin_update_managed_client_workspace(...), a narrow allowlisted write
-- path for legacy workspace fields. It was removed before this PR's final
-- review: nothing in this phase's UI calls it (the detail view is
-- deliberately read-only), and shipping an unused write surface widens
-- the production change surface without giving the operator any new
-- capability yet. Legacy workspace editing is next-phase work, and should
-- ship with its own dedicated mutation test matrix alongside the UI that
-- actually calls it, not ahead of either.

-- =====================================================================
-- admin_list_managed_clients() - the unified staff-safe read model.
-- Returns a jsonb array; see the reconciliation rule above. Every field
-- is explicitly allowlisted via jsonb_build_object - no `select *`. The
-- 'access' array returns only email/role/status, never auth_user_id or
-- any other auth internals - email is resolved as
-- coalesce(public.users.user_email, auth.users.email) so a real active
-- membership (e.g. GSB's owner) is never misrepresented as unknown just
-- because no public.users profile row happens to exist yet for that auth
-- identity; auth.users itself is never exposed beyond that one derived
-- column, matching the same reasoning as is_opps_staff()'s and
-- apply_invoice_order_sync's existing auth.users-derived-email patterns.
-- =====================================================================

create function public.admin_list_managed_clients()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_result jsonb;
begin
  if not public.is_opps_staff() then
    raise exception using errcode = 'P0001', message = 'MANAGED_CLIENTS_FORBIDDEN: staff access required';
  end if;

  with modern_tenants as (
    -- Structural eligibility (post-review): slug naming alone is not
    -- sufficient to decide a tenant is a real managed brand - it is used
    -- only as an EXCLUSION heuristic (the system tenant and disposable
    -- qa/demo/test fixture tenants, matching how every fixture tenant in
    -- this codebase's own test suites is named), never as the sole
    -- INCLUSION signal. A tenant only qualifies as a managed brand when
    -- it also has a linked public.clients row AND at least one positive,
    -- structural sign of being live managed-brand infrastructure: an
    -- active xos_admin or storefront tenant_domain, or an enabled
    -- tenant_capabilities row. There is no dedicated tenant "type" column
    -- in the current schema (tenants.settings is empty '{}' on every
    -- tenant today) - this is the closest available structural proxy.
    select t.*
    from public.tenants t
    where t.slug <> 'joint-x'
      and t.slug !~* '(^|-)(qa|demo|test)(-|$)'
      and exists (select 1 from public.clients c where c.tenant_id = t.id)
      and (
        exists (
          select 1 from public.tenant_domains d
          where d.tenant_id = t.id
            and d.surface in ('xos_admin', 'storefront')
            and d.status = 'active'
        )
        or exists (
          select 1 from public.tenant_capabilities tc
          where tc.tenant_id = t.id and tc.enabled = true
        )
      )
  ),
  tenant_primary_client as (
    -- One representative clients row per modern tenant - the
    -- provisioning template creates exactly one; the oldest is chosen if
    -- more than one ever exists, for a stable pick.
    select distinct on (c.tenant_id) c.*
    from public.clients c
    join modern_tenants mt on mt.id = c.tenant_id
    order by c.tenant_id, c.created_at asc
  ),
  modern_rows as (
    select
      jsonb_build_object(
        'key', 'tenant:' || mt.id::text,
        'source', case when w.id is not null then 'both' else 'modern' end,
        'brand_name', coalesce(pc.brand_name, pc.name, mt.name),
        'tenant_id', mt.id,
        'tenant_slug', mt.slug,
        'tenant_name', mt.name,
        'tenant_status', mt.status,
        'client_id', pc.id,
        'client_name', pc.name,
        'workspace_id', w.id,
        'client_type', w.client_type,
        'onboarding_stage', w.onboarding_stage,
        'site_type', w.site_type,
        'site_status', w.site_status,
        'storefront_status', w.storefront_status,
        'domain_status', w.domain_status,
        'assets_status', w.assets_status,
        'content_status', w.content_status,
        'products_services_status', w.products_services_status,
        'pricing_status', w.pricing_status,
        'mockup_status', w.mockup_status,
        'launch_readiness_status', w.launch_readiness_status,
        'preview_url', w.preview_url,
        'live_url', w.live_url,
        'domain_name', w.domain_name,
        'site_repo_url', w.site_repo_url,
        'next_action', w.next_action,
        'next_action_owner', w.next_action_owner,
        'next_action_due_at', w.next_action_due_at,
        'launch_target_date', w.launch_target_date,
        'internal_notes', w.internal_notes,
        'xos_hostname', (
          select d.hostname from public.tenant_domains d
          where d.tenant_id = mt.id and d.surface = 'xos_admin' and d.is_primary
          limit 1
        ),
        'xos_status', (
          select d.status from public.tenant_domains d
          where d.tenant_id = mt.id and d.surface = 'xos_admin' and d.is_primary
          limit 1
        ),
        'products_capability_enabled', coalesce((
          select tc.enabled from public.tenant_capabilities tc
          where tc.tenant_id = mt.id and tc.capability_key = 'products'
        ), false),
        'commerce_product_count', (
          select count(*) from commerce.products cp
          where cp.tenant_id = mt.id and cp.status <> 'archived'
        ),
        'access', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'email', coalesce(u.user_email, au.email),
              'role', m.tenant_role,
              'status', m.status
            )
            order by m.created_at
          )
          from public.tenant_memberships m
          left join public.users u on u.auth_user_id = m.auth_user_id
          left join auth.users au on au.id = m.auth_user_id
          where m.tenant_id = mt.id
        ), '[]'::jsonb),
        'created_at', coalesce(w.created_at, mt.created_at),
        'updated_at', greatest(coalesce(w.updated_at, mt.updated_at), mt.updated_at)
      ) as row,
      greatest(coalesce(w.updated_at, mt.updated_at), mt.updated_at) as sort_at
    from modern_tenants mt
    left join tenant_primary_client pc on pc.tenant_id = mt.id
    left join public.managed_client_workspaces w on w.client_id = pc.id and w.tenant_id = mt.id
  ),
  legacy_rows as (
    select
      jsonb_build_object(
        'key', 'workspace:' || w.id::text,
        'source', 'legacy',
        'brand_name', coalesce(c.brand_name, c.name, 'Unnamed managed client'),
        'tenant_id', null::uuid,
        'tenant_slug', null::text,
        'tenant_name', null::text,
        'tenant_status', null::text,
        'client_id', w.client_id,
        'client_name', c.name,
        'workspace_id', w.id,
        'client_type', w.client_type,
        'onboarding_stage', w.onboarding_stage,
        'site_type', w.site_type,
        'site_status', w.site_status,
        'storefront_status', w.storefront_status,
        'domain_status', w.domain_status,
        'assets_status', w.assets_status,
        'content_status', w.content_status,
        'products_services_status', w.products_services_status,
        'pricing_status', w.pricing_status,
        'mockup_status', w.mockup_status,
        'launch_readiness_status', w.launch_readiness_status,
        'preview_url', w.preview_url,
        'live_url', w.live_url,
        'domain_name', w.domain_name,
        'site_repo_url', w.site_repo_url,
        'next_action', w.next_action,
        'next_action_owner', w.next_action_owner,
        'next_action_due_at', w.next_action_due_at,
        'launch_target_date', w.launch_target_date,
        'internal_notes', w.internal_notes,
        'xos_hostname', null::text,
        'xos_status', null::text,
        'products_capability_enabled', false,
        'commerce_product_count', 0,
        'access', '[]'::jsonb,
        'created_at', w.created_at,
        'updated_at', w.updated_at
      ) as row,
      w.updated_at as sort_at
    from public.managed_client_workspaces w
    left join public.clients c on c.id = w.client_id
    where not exists (
      select 1
      from tenant_primary_client pc
      where pc.id = w.client_id and pc.tenant_id = w.tenant_id
    )
  )
  select jsonb_agg(x.row order by x.sort_at desc)
  into v_result
  from (
    select row, sort_at from modern_rows
    union all
    select row, sort_at from legacy_rows
  ) x;

  return coalesce(v_result, '[]'::jsonb);
end;
$$;

revoke all on function public.admin_list_managed_clients() from public;
revoke all on function public.admin_list_managed_clients() from anon;
grant execute on function public.admin_list_managed_clients() to authenticated;

-- =====================================================================
-- Post-apply verification (run manually, not part of this script):
--   select has_function_privilege('anon', 'public.admin_list_managed_clients()', 'EXECUTE'); -- expect false
-- =====================================================================
