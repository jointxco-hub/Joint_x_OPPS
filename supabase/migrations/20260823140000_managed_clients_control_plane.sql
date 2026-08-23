-- Managed Clients Control Plane — Phase 0/1.
--
-- OPPS internal read/write surface reconciling two generations of managed
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
-- for every tenant that qualifies as a "modern managed tenant" (not the
-- Joint X system tenant, not a QA/demo/test fixture tenant - see the
-- modern_tenants CTE), resolve its one representative public.clients row
-- (the provisioning template creates exactly one; the oldest is chosen if
-- more than one ever exists, for stability), then look for a
-- managed_client_workspaces row whose client_id equals that exact client.
-- If found, the workspace and tenant data are merged into ONE row. If a
-- modern tenant has no matching workspace row, it is still emitted - with
-- every legacy/workspace field null - so a brand-new managed tenant like
-- GSB appears automatically without needing a workspace row created for
-- it. Every managed_client_workspaces row that was NOT matched to a
-- modern tenant this way (all 3 current historical rows, since their
-- linked clients are still Joint-X-scoped) is emitted as its own
-- "legacy-only" row. This guarantees: (a) no managed brand is ever listed
-- twice, (b) no workspace row is ever silently dropped even if the
-- matching logic ever misses an edge case (a non-primary client on a
-- multi-client tenant, which does not exist in current data), because
-- exclusion from the legacy set uses the exact same join key as inclusion
-- in the modern set.
--
-- Both RPCs follow the exact staff-authority pattern already established
-- and corrected in XOS 3B (see 20260823120000's header note):
-- is_opps_staff() alone is the actor gate - it is a global "is this an
-- active Joint X staff member" check, not scoped to any one tenant, which
-- is exactly what a cross-tenant internal control plane needs. Tenant
-- identity is always resolved server-side, never trusted from caller
-- input beyond an opaque row id.

-- =====================================================================
-- 1. admin_list_managed_clients() - the unified staff-safe read model.
--    Returns a jsonb array; see the reconciliation rule above. Every
--    field is explicitly allowlisted via jsonb_build_object - no `select
--    *`, no raw auth.users exposure (only public.users.user_email, the
--    same derived-email pattern already used by is_opps_staff() and
--    apply_invoice_order_sync's actor_email).
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
    -- Every tenant that is an actual managed brand - excludes the
    -- internal Joint X system tenant (the same 'joint-x' slug
    -- is_opps_staff() itself already treats as the system tenant - not a
    -- new hardcode) and QA/demo/test fixture tenants, matched by naming
    -- convention (every disposable/fixture tenant in this codebase's own
    -- test suites is named with a qa/demo/test segment; there is no
    -- structural tenant "type" column to key off instead).
    select t.*
    from public.tenants t
    where t.slug <> 'joint-x'
      and t.slug !~* '(^|-)(qa|demo|test)(-|$)'
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
            jsonb_build_object('email', u.user_email, 'role', m.tenant_role, 'status', m.status)
            order by m.created_at
          )
          from public.tenant_memberships m
          left join public.users u on u.auth_user_id = m.auth_user_id
          where m.tenant_id = mt.id
        ), '[]'::jsonb),
        'created_at', coalesce(w.created_at, mt.created_at),
        'updated_at', greatest(coalesce(w.updated_at, mt.updated_at), mt.updated_at)
      ) as row,
      greatest(coalesce(w.updated_at, mt.updated_at), mt.updated_at) as sort_at
    from modern_tenants mt
    left join tenant_primary_client pc on pc.tenant_id = mt.id
    left join public.managed_client_workspaces w on w.client_id = pc.id
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
      where pc.id = w.client_id
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
-- 2. admin_update_managed_client_workspace - narrow, allowlisted write
--    path for LEGACY workspace fields only. p_workspace_id must already
--    exist - this never creates a managed_client_workspaces row (a
--    modern tenant with no workspace row, like GSB, cannot be edited
--    through this function; creating its first workspace row is a
--    separate, explicit reconciliation action for a later phase, not
--    something this PR wires up). id/tenant_id/client_id/business_id/
--    brand_id/storefront_id/created_at are never in the SET list, so no
--    caller input can ever reassign identity/mapping fields - only the
--    operational/readiness/site fields below are editable.
-- =====================================================================

create function public.admin_update_managed_client_workspace(
  p_workspace_id uuid,
  p_updates jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_row public.managed_client_workspaces;
begin
  if not public.is_opps_staff() then
    raise exception using errcode = 'P0001', message = 'MANAGED_CLIENTS_FORBIDDEN: staff access required';
  end if;

  if not exists (select 1 from public.managed_client_workspaces where id = p_workspace_id) then
    raise exception using errcode = 'P0001', message = 'MANAGED_CLIENTS_WORKSPACE_NOT_FOUND: workspace not found';
  end if;

  update public.managed_client_workspaces
  set
    client_type = case when p_updates ? 'client_type' then p_updates ->> 'client_type' else client_type end,
    onboarding_stage = case when p_updates ? 'onboarding_stage' then coalesce(p_updates ->> 'onboarding_stage', onboarding_stage) else onboarding_stage end,
    site_type = case when p_updates ? 'site_type' then p_updates ->> 'site_type' else site_type end,
    site_status = case when p_updates ? 'site_status' then p_updates ->> 'site_status' else site_status end,
    storefront_status = case when p_updates ? 'storefront_status' then p_updates ->> 'storefront_status' else storefront_status end,
    domain_status = case when p_updates ? 'domain_status' then p_updates ->> 'domain_status' else domain_status end,
    assets_status = case when p_updates ? 'assets_status' then p_updates ->> 'assets_status' else assets_status end,
    content_status = case when p_updates ? 'content_status' then p_updates ->> 'content_status' else content_status end,
    products_services_status = case when p_updates ? 'products_services_status' then p_updates ->> 'products_services_status' else products_services_status end,
    pricing_status = case when p_updates ? 'pricing_status' then p_updates ->> 'pricing_status' else pricing_status end,
    mockup_status = case when p_updates ? 'mockup_status' then p_updates ->> 'mockup_status' else mockup_status end,
    launch_readiness_status = case when p_updates ? 'launch_readiness_status' then p_updates ->> 'launch_readiness_status' else launch_readiness_status end,
    preview_url = case when p_updates ? 'preview_url' then nullif(p_updates ->> 'preview_url', '') else preview_url end,
    live_url = case when p_updates ? 'live_url' then nullif(p_updates ->> 'live_url', '') else live_url end,
    domain_name = case when p_updates ? 'domain_name' then nullif(p_updates ->> 'domain_name', '') else domain_name end,
    site_repo_url = case when p_updates ? 'site_repo_url' then nullif(p_updates ->> 'site_repo_url', '') else site_repo_url end,
    next_action = case when p_updates ? 'next_action' then p_updates ->> 'next_action' else next_action end,
    next_action_owner = case when p_updates ? 'next_action_owner' then p_updates ->> 'next_action_owner' else next_action_owner end,
    next_action_due_at = case when p_updates ? 'next_action_due_at' then nullif(p_updates ->> 'next_action_due_at', '')::timestamptz else next_action_due_at end,
    launch_target_date = case when p_updates ? 'launch_target_date' then nullif(p_updates ->> 'launch_target_date', '')::date else launch_target_date end,
    internal_notes = case when p_updates ? 'internal_notes' then p_updates ->> 'internal_notes' else internal_notes end,
    updated_at = now()
  where id = p_workspace_id
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.admin_update_managed_client_workspace(uuid, jsonb) from public;
revoke all on function public.admin_update_managed_client_workspace(uuid, jsonb) from anon;
grant execute on function public.admin_update_managed_client_workspace(uuid, jsonb) to authenticated;

-- =====================================================================
-- Post-apply verification (run manually, not part of this script):
--   select has_function_privilege('anon', 'public.admin_list_managed_clients()', 'EXECUTE'); -- expect false
--   select has_function_privilege('anon', 'public.admin_update_managed_client_workspace(uuid,jsonb)', 'EXECUTE'); -- expect false
-- =====================================================================
