-- Managed Clients Control Plane — Phase 2: Operator Workspace + Safe
-- Managed Brand Provisioning.
--
-- Builds on 20260823140000_managed_clients_control_plane.sql (Phase 0/1,
-- LIVE in production) without editing that file. This migration is
-- strictly additive: new tables, new functions, and a CREATE OR REPLACE of
-- admin_list_managed_clients() (same function identity, refined
-- eligibility rule only - see section 11).
--
-- Continues using the exact same underlying tables Phase 0/1 established:
-- public.managed_client_workspaces, public.tenants, public.clients,
-- public.tenant_domains, public.tenant_memberships,
-- public.tenant_capabilities, commerce.*. No competing managed-client
-- model is introduced.
--
-- Legacy modernization (migrating the 3 historical workspace clients to
-- their own dedicated tenants) is explicitly OUT OF SCOPE here - see
-- docs/MANAGED_CLIENTS_CONTROL_PLANE.md. Phase 2 lets staff edit a legacy
-- workspace's own fields, but never unlocks Commerce for it and never
-- touches clients.tenant_id.
--
-- Authority model: admin_list_managed_clients() stays is_opps_staff()-
-- gated (read-only, cross-tenant staff visibility - unchanged from Phase
-- 0/1). Every new MUTATION/provisioning/preflight RPC in this migration
-- requires public.is_app_admin() instead - these are high-impact
-- operations (editing production workspace state, creating tenants/
-- clients/domains/memberships, activating a live XOS hostname), not
-- ordinary staff-read visibility.
--
-- Idempotency: provisioning reuses the exact pg_advisory_xact_lock +
-- ledger-table pattern already proven in
-- commerce.onboarding_operations/admin_onboard_client_commerce_product
-- (20260823120000) - but with its OWN ledger table
-- (public.managed_brand_provisioning_operations), because
-- commerce.onboarding_operations is a Commerce-product-onboarding ledger,
-- not a generic one; reusing it here would conflate two unrelated
-- idempotency domains under one key namespace.
--
-- XOS domain safety: the OLD manual provisioning template
-- (supabase/provisioning/xos_tenant_provisioning_template.sql) inserts
-- tenant_domains with status = 'active' directly, because a human
-- operator manually verifies the Vercel attachment before ever running
-- it. The new UI-driven provisioner (admin_provision_managed_brand) has
-- no such guarantee - a database row can never prove Vercel is actually
-- serving the hostname - so it always inserts status = 'pending'.
-- Activation to 'active' is a separate, explicit, APP-ADMIN-ONLY step
-- (admin_activate_managed_xos_domain) gated behind the operator manually
-- confirming the external Vercel attachment. The two steps are never
-- combined automatically.
-- =====================================================================

-- =====================================================================
-- 1. public.managed_brand_provisioning_operations - idempotency ledger
--    for admin_provision_managed_brand, mirroring
--    commerce.onboarding_operations' own shape/purpose but scoped to
--    tenant/brand provisioning instead of Commerce product onboarding.
--    Internal only - RLS enabled, zero policies, no direct grants to any
--    client-facing role; only reachable through the SECURITY DEFINER RPC.
-- =====================================================================

create table public.managed_brand_provisioning_operations (
  idempotency_key text primary key,
  actor_email text not null,
  request_fingerprint text not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.managed_brand_provisioning_operations enable row level security;

revoke all on public.managed_brand_provisioning_operations from public;
revoke all on public.managed_brand_provisioning_operations from anon;
revoke all on public.managed_brand_provisioning_operations from authenticated;

-- =====================================================================
-- 2. Internal helpers (not part of the public API - never granted to
--    authenticated; called only from inside this migration's own
--    SECURITY DEFINER RPCs, which execute as the function owner and so
--    can call them regardless of the missing grant, same as
--    commerce.ensure_product_link in 20260823120000).
-- =====================================================================

-- Deterministic tenant-slug normalization, shared by preview/provision so
-- a slug is always validated and derived identically in both calls.
create function public._normalize_managed_brand_slug(p_raw text)
returns text
language sql
immutable
as $$
  select nullif(
    regexp_replace(
      regexp_replace(lower(btrim(coalesce(p_raw, ''))), '[^a-z0-9]+', '-', 'g'),
      '(^-+|-+$)', '', 'g'
    ),
    ''
  );
$$;

revoke all on function public._normalize_managed_brand_slug(text) from public;
revoke all on function public._normalize_managed_brand_slug(text) from anon;
revoke all on function public._normalize_managed_brand_slug(text) from authenticated;

-- Structural "is this a real managed-brand tenant" rule (post-review,
-- Phase 2): refines Phase 0/1's read-model rule (which required an ACTIVE
-- domain or enabled capability) because a freshly provisioned tenant now
-- legitimately sits in xos_admin domain status = 'pending' until the
-- operator confirms Vercel activation - requiring ACTIVE would hide a
-- brand-new managed brand from Managed Clients entirely. A tenant now
-- qualifies when it has a linked public.clients row AND at least one of:
-- a matching managed_client_workspaces row, a non-disabled (pending,
-- verified, or active) xos_admin/storefront tenant_domains row, or an
-- enabled tenant_capabilities row. Slug naming (excluding joint-x and
-- qa/demo/test fixtures) remains an EXCLUSION heuristic only, never the
-- sole inclusion signal - unchanged from Phase 0/1. Shared by the
-- unified read model (admin_list_managed_clients, section 11) and every
-- Phase 2 write RPC that must reject acting on a non-managed tenant
-- (admin_initialize_managed_client_workspace,
-- admin_set_managed_tenant_products_capability) - one source of truth,
-- never duplicated.
create function public._is_eligible_managed_tenant(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select exists (
    select 1
    from public.tenants t
    where t.id = p_tenant_id
      and t.slug <> 'joint-x'
      and t.slug !~* '(^|-)(qa|demo|test)(-|$)'
      and exists (select 1 from public.clients c where c.tenant_id = t.id)
      and (
        exists (
          select 1
          from public.managed_client_workspaces w
          join public.clients c on c.id = w.client_id
          where c.tenant_id = t.id and w.tenant_id = t.id
        )
        or exists (
          select 1 from public.tenant_domains d
          where d.tenant_id = t.id
            and d.surface in ('xos_admin', 'storefront')
            and d.status <> 'disabled'
        )
        or exists (
          select 1 from public.tenant_capabilities tc
          where tc.tenant_id = t.id and tc.enabled = true
        )
      )
  );
$$;

revoke all on function public._is_eligible_managed_tenant(uuid) from public;
revoke all on function public._is_eligible_managed_tenant(uuid) from anon;
revoke all on function public._is_eligible_managed_tenant(uuid) from authenticated;

-- Shared allowlist gate for both workspace-mutation RPCs (Part A update,
-- Part B initialize) - rejects any key outside the allowlisted operational
-- workspace fields explicitly, rather than silently ignoring it. Never
-- allows id/tenant_id/client_id/business_id/brand_id/storefront_id/
-- created_at through this path at all - those identity columns are not
-- in the allowlist and are never referenced from p_updates by either
-- caller, so there is no path for the frontend to mutate them even if it
-- tried.
create function public._validate_managed_workspace_update_keys(p_updates jsonb)
returns void
language plpgsql
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_key text;
  v_allowed constant text[] := array[
    'client_type', 'onboarding_stage', 'site_type', 'site_status', 'storefront_status',
    'domain_status', 'assets_status', 'content_status', 'products_services_status',
    'pricing_status', 'mockup_status', 'launch_readiness_status', 'preview_url', 'live_url',
    'domain_name', 'site_repo_url', 'next_action', 'next_action_owner', 'next_action_due_at',
    'launch_target_date', 'internal_notes'
  ];
begin
  if p_updates is null then
    return;
  end if;
  if jsonb_typeof(p_updates) <> 'object' then
    raise exception using errcode = 'P0001', message = 'WORKSPACE_UPDATE_INVALID_PAYLOAD: updates must be a JSON object';
  end if;
  for v_key in select jsonb_object_keys(p_updates) loop
    if not (v_key = any(v_allowed)) then
      raise exception using errcode = 'P0001', message = format('WORKSPACE_UPDATE_UNKNOWN_KEY: "%s" is not an editable workspace field', v_key);
    end if;
  end loop;
end;
$$;

revoke all on function public._validate_managed_workspace_update_keys(jsonb) from public;
revoke all on function public._validate_managed_workspace_update_keys(jsonb) from anon;
revoke all on function public._validate_managed_workspace_update_keys(jsonb) from authenticated;

-- =====================================================================
-- PART A — admin_update_managed_client_workspace(p_workspace_id, p_updates)
-- APP ADMIN ONLY. Reintroduces the narrow allowlisted mutation Phase 0/1
-- deliberately removed (it had no caller then) - now the "Edit Workspace"
-- dialog calls it. Per-field CASE ... WHEN p_updates ? 'key' preserves
-- every field the caller did not mention, and setting a JSON null for a
-- nullable field clears it to SQL NULL (p_updates->>'key' on a present-
-- but-null value already returns NULL) - "intentional clearing" without
-- any separate clear-flag convention. onboarding_stage/client_type/
-- site_type still cannot be cleared because the table's own NOT NULL /
-- CHECK constraints reject that, exactly as they should. No identity
-- column (id/tenant_id/client_id/business_id/brand_id/storefront_id/
-- created_at) appears anywhere in the SET list - not just disallowed by
-- the key allowlist, but structurally absent from the UPDATE statement
-- itself.
-- =====================================================================

create function public.admin_update_managed_client_workspace(p_workspace_id uuid, p_updates jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_actor text;
  v_workspace public.managed_client_workspaces;
  v_updated_keys jsonb;
begin
  if not public.is_app_admin() then
    raise exception using errcode = 'P0001', message = 'MANAGED_BRAND_FORBIDDEN: app admin access required';
  end if;

  perform public._validate_managed_workspace_update_keys(p_updates);

  select * into v_workspace from public.managed_client_workspaces where id = p_workspace_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'WORKSPACE_NOT_FOUND: workspace does not exist';
  end if;

  v_actor := auth.email();

  update public.managed_client_workspaces set
    client_type = case when p_updates ? 'client_type' then p_updates ->> 'client_type' else client_type end,
    onboarding_stage = case when p_updates ? 'onboarding_stage' then p_updates ->> 'onboarding_stage' else onboarding_stage end,
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
    preview_url = case when p_updates ? 'preview_url' then p_updates ->> 'preview_url' else preview_url end,
    live_url = case when p_updates ? 'live_url' then p_updates ->> 'live_url' else live_url end,
    domain_name = case when p_updates ? 'domain_name' then p_updates ->> 'domain_name' else domain_name end,
    site_repo_url = case when p_updates ? 'site_repo_url' then p_updates ->> 'site_repo_url' else site_repo_url end,
    next_action = case when p_updates ? 'next_action' then p_updates ->> 'next_action' else next_action end,
    next_action_owner = case when p_updates ? 'next_action_owner' then p_updates ->> 'next_action_owner' else next_action_owner end,
    next_action_due_at = case when p_updates ? 'next_action_due_at' then nullif(p_updates ->> 'next_action_due_at', '')::timestamptz else next_action_due_at end,
    launch_target_date = case when p_updates ? 'launch_target_date' then nullif(p_updates ->> 'launch_target_date', '')::date else launch_target_date end,
    internal_notes = case when p_updates ? 'internal_notes' then p_updates ->> 'internal_notes' else internal_notes end,
    updated_at = now()
  where id = p_workspace_id
  returning * into v_workspace;

  select coalesce(jsonb_agg(k), '[]'::jsonb) into v_updated_keys from jsonb_object_keys(coalesce(p_updates, '{}'::jsonb)) k;

  insert into public.opps_activity_events (
    tenant_id, actor_email, actor_name, event_type, entity_type, entity_id, summary, metadata
  ) values (
    v_workspace.tenant_id, v_actor, v_actor, 'managed_client_workspace_updated', 'managed_client_workspace', v_workspace.id,
    'Updated managed client workspace ' || v_workspace.id::text,
    jsonb_build_object('updated_keys', v_updated_keys)
  );

  return to_jsonb(v_workspace);
end;
$$;

revoke all on function public.admin_update_managed_client_workspace(uuid, jsonb) from public;
revoke all on function public.admin_update_managed_client_workspace(uuid, jsonb) from anon;
grant execute on function public.admin_update_managed_client_workspace(uuid, jsonb) to authenticated;

-- =====================================================================
-- PART B — admin_initialize_managed_client_workspace(p_tenant_id, p_workspace)
-- APP ADMIN ONLY. Lets a modern tenant with no workspace row yet (GSB
-- today) get one, without the browser ever supplying a client_id - the
-- canonical client is resolved server-side, and "ambiguous" (more than
-- one clients row for the tenant) is rejected outright rather than
-- guessed at, unlike the read model's display-only "pick the oldest"
-- convenience (a write must never guess).
-- =====================================================================

create function public.admin_initialize_managed_client_workspace(p_tenant_id uuid, p_workspace jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_actor text;
  v_tenant public.tenants;
  v_client_count int;
  v_client_id uuid;
  v_workspace public.managed_client_workspaces;
  v_fields jsonb;
begin
  if not public.is_app_admin() then
    raise exception using errcode = 'P0001', message = 'MANAGED_BRAND_FORBIDDEN: app admin access required';
  end if;

  perform public._validate_managed_workspace_update_keys(p_workspace);

  select * into v_tenant from public.tenants where id = p_tenant_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'WORKSPACE_INIT_TENANT_NOT_FOUND: tenant does not exist';
  end if;
  if v_tenant.slug = 'joint-x' or v_tenant.slug ~* '(^|-)(qa|demo|test)(-|$)' then
    raise exception using errcode = 'P0001', message = 'WORKSPACE_INIT_SYSTEM_TENANT_FORBIDDEN: cannot initialize a workspace for a system/QA/demo/test tenant';
  end if;
  if not public._is_eligible_managed_tenant(p_tenant_id) then
    raise exception using errcode = 'P0001', message = 'WORKSPACE_INIT_TENANT_NOT_ELIGIBLE: tenant is not a recognized managed brand tenant';
  end if;

  select count(*) into v_client_count from public.clients where tenant_id = p_tenant_id;
  if v_client_count = 0 then
    raise exception using errcode = 'P0001', message = 'WORKSPACE_INIT_CLIENT_NOT_FOUND: tenant has no linked client';
  elsif v_client_count > 1 then
    raise exception using errcode = 'P0001', message = 'WORKSPACE_INIT_CLIENT_AMBIGUOUS: tenant has more than one linked client - cannot determine a safe canonical client';
  end if;
  select id into v_client_id from public.clients where tenant_id = p_tenant_id;

  -- client.tenant_id = tenant.id by construction (v_client_id was
  -- resolved by filtering clients on tenant_id = p_tenant_id above), but
  -- re-asserted explicitly per the review's requirement #5.
  if not exists (select 1 from public.clients where id = v_client_id and tenant_id = p_tenant_id) then
    raise exception using errcode = 'P0001', message = 'WORKSPACE_INIT_CLIENT_TENANT_MISMATCH: resolved client does not belong to the resolved tenant';
  end if;

  if exists (select 1 from public.managed_client_workspaces where tenant_id = p_tenant_id and client_id = v_client_id) then
    raise exception using errcode = 'P0001', message = 'WORKSPACE_INIT_ALREADY_EXISTS: a workspace already exists for this tenant/client';
  end if;

  v_actor := auth.email();
  v_fields := coalesce(p_workspace, '{}'::jsonb);

  insert into public.managed_client_workspaces (
    tenant_id, client_id, client_type, site_type, onboarding_stage, site_status,
    storefront_status, domain_status, assets_status, content_status,
    products_services_status, pricing_status, mockup_status, launch_readiness_status,
    preview_url, live_url, domain_name, site_repo_url, next_action, next_action_owner,
    next_action_due_at, launch_target_date, internal_notes
  ) values (
    p_tenant_id, v_client_id,
    v_fields ->> 'client_type', v_fields ->> 'site_type',
    coalesce(v_fields ->> 'onboarding_stage', '01 Intake'),
    v_fields ->> 'site_status', v_fields ->> 'storefront_status', v_fields ->> 'domain_status',
    v_fields ->> 'assets_status', v_fields ->> 'content_status', v_fields ->> 'products_services_status',
    v_fields ->> 'pricing_status', v_fields ->> 'mockup_status', v_fields ->> 'launch_readiness_status',
    v_fields ->> 'preview_url', v_fields ->> 'live_url', v_fields ->> 'domain_name', v_fields ->> 'site_repo_url',
    v_fields ->> 'next_action', v_fields ->> 'next_action_owner',
    nullif(v_fields ->> 'next_action_due_at', '')::timestamptz, nullif(v_fields ->> 'launch_target_date', '')::date,
    v_fields ->> 'internal_notes'
  )
  returning * into v_workspace;

  insert into public.opps_activity_events (
    tenant_id, actor_email, actor_name, event_type, entity_type, entity_id, summary, metadata
  ) values (
    p_tenant_id, v_actor, v_actor, 'managed_client_workspace_initialized', 'managed_client_workspace', v_workspace.id,
    'Initialized managed client workspace for tenant ' || v_tenant.slug,
    jsonb_build_object('client_id', v_client_id)
  );

  return to_jsonb(v_workspace);
end;
$$;

revoke all on function public.admin_initialize_managed_client_workspace(uuid, jsonb) from public;
revoke all on function public.admin_initialize_managed_client_workspace(uuid, jsonb) from anon;
grant execute on function public.admin_initialize_managed_client_workspace(uuid, jsonb) to authenticated;

-- =====================================================================
-- PART C — admin_preview_managed_brand_provisioning(p_input)
-- APP ADMIN ONLY, READ-ONLY. Powers the wizard's preflight step. Derives
-- the hostname server-side (never accepts one from the browser), and
-- resolves "owner account exists" / "email matches" via ONE lookup -
-- select auth.users by lower(email) = lower(canonical client email) -
-- so there is no path where an unrelated auth account could be found and
-- then compared; the search predicate IS the match. Never returns
-- auth_user_id, only the booleans/derived strings the wizard needs.
-- =====================================================================

create function public.admin_preview_managed_brand_provisioning(p_input jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_workspace_name text;
  v_raw_slug text;
  v_slug text;
  v_hostname text;
  v_client_email text;
  v_client_name text;
  v_slug_valid boolean;
  v_slug_available boolean;
  v_hostname_available boolean;
  v_client_email_valid boolean;
  v_client_email_available boolean;
  v_owner_id uuid;
  v_owner_account_exists boolean;
  v_email_match boolean;
  v_blockers text[] := '{}';
  v_can_provision boolean;
begin
  if not public.is_app_admin() then
    raise exception using errcode = 'P0001', message = 'MANAGED_BRAND_FORBIDDEN: app admin access required';
  end if;

  v_workspace_name := nullif(btrim(coalesce(p_input ->> 'workspace_name', '')), '');
  v_raw_slug := p_input ->> 'tenant_slug';
  v_client_email := nullif(btrim(coalesce(p_input ->> 'client_email', '')), '');
  v_client_name := nullif(btrim(coalesce(p_input ->> 'client_name', '')), '');

  v_slug := public._normalize_managed_brand_slug(v_raw_slug);
  v_slug_valid := v_slug is not null
    and char_length(v_slug) between 2 and 50
    and v_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    and v_slug <> 'joint-x'
    and v_slug !~* '(^|-)(qa|demo|test)(-|$)';
  v_hostname := case when v_slug_valid then v_slug || '.xos.jointx.co.za' else null end;

  v_slug_available := v_slug_valid and not exists (select 1 from public.tenants t where t.slug = v_slug);
  v_hostname_available := v_hostname is not null and not exists (select 1 from public.tenant_domains d where d.hostname = v_hostname);

  v_client_email_valid := v_client_email is not null and v_client_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$';
  v_client_email_available := v_client_email_valid and not exists (select 1 from public.clients c where lower(c.email) = lower(v_client_email));

  if v_client_email_valid then
    select au.id into v_owner_id from auth.users au where lower(au.email) = lower(v_client_email) limit 1;
  end if;
  v_owner_account_exists := v_owner_id is not null;
  -- The lookup predicate IS the case-insensitive email match, so a found
  -- account has, by construction, a matching email.
  v_email_match := v_owner_account_exists;

  if v_workspace_name is null then
    v_blockers := v_blockers || 'Workspace/brand display name is required.';
  end if;
  if v_client_name is null then
    v_blockers := v_blockers || 'Client/contact name is required.';
  end if;
  if not v_slug_valid then
    v_blockers := v_blockers || 'Tenant slug is invalid or reserved.';
  elsif not v_slug_available then
    v_blockers := v_blockers || format('Tenant slug "%s" is already in use.', v_slug);
  end if;
  if v_hostname is not null and not v_hostname_available then
    v_blockers := v_blockers || format('Hostname "%s" is already registered.', v_hostname);
  end if;
  if not v_client_email_valid then
    v_blockers := v_blockers || 'Canonical client/owner email is not a valid email address.';
  else
    if not v_client_email_available then
      v_blockers := v_blockers || 'A clients row with this email already exists.';
    end if;
    if not v_owner_account_exists then
      v_blockers := v_blockers || 'The owner must sign in/create their XOS account with this exact email before the workspace can be provisioned.';
    end if;
  end if;

  v_can_provision := v_workspace_name is not null
    and v_client_name is not null
    and v_slug_valid and v_slug_available
    and v_hostname_available
    and v_client_email_valid and v_client_email_available
    and v_owner_account_exists and v_email_match;

  return jsonb_build_object(
    'normalized_slug', v_slug,
    'derived_hostname', v_hostname,
    'owner_account_exists', v_owner_account_exists,
    'email_match', v_email_match,
    'slug_available', v_slug_available,
    'hostname_available', v_hostname_available,
    'client_email_available', v_client_email_available,
    'can_provision', v_can_provision,
    'blockers', to_jsonb(v_blockers)
  );
end;
$$;

revoke all on function public.admin_preview_managed_brand_provisioning(jsonb) from public;
revoke all on function public.admin_preview_managed_brand_provisioning(jsonb) from anon;
grant execute on function public.admin_preview_managed_brand_provisioning(jsonb) to authenticated;

-- =====================================================================
-- PART D — admin_provision_managed_brand(p_input, p_idempotency_key)
-- APP ADMIN ONLY, ATOMIC. Re-validates everything the preview already
-- checked (never trusts the earlier preview call - state can change
-- between the two, and this is the write that actually matters), then
-- provisions tenant -> client -> XOS domain (PENDING, never active) ->
-- owner membership -> optional products capability -> workspace, all in
-- one transaction. Any failure means zero partial provisioning - a
-- single `insert` failing anywhere aborts the whole function, and
-- Postgres rolls back every earlier insert in this same call
-- automatically (no explicit savepoints needed - a plpgsql function body
-- is already one implicit block). auth_user_id is resolved and used
-- internally only; it is never part of the returned/stored result.
-- Concurrency: three pg_advisory_xact_lock namespaces, always acquired in
-- the same order (idempotency-key -> slug -> email, see the inline note
-- below the slug checks) so two concurrent calls can never deadlock.
-- initial_workspace is validated against the same key allowlist used by
-- Parts A/B before it touches any insert.
-- =====================================================================

create function public.admin_provision_managed_brand(p_input jsonb, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_actor text;
  v_workspace_name text;
  v_raw_slug text;
  v_slug text;
  v_hostname text;
  v_client_email text;
  v_client_name text;
  v_client_type text;
  v_site_type text;
  v_products_enabled boolean;
  v_workspace_fields jsonb;
  v_fingerprint text;
  v_existing_op public.managed_brand_provisioning_operations;
  v_owner_id uuid;
  v_tenant_id uuid;
  v_client_id uuid;
  v_workspace_id uuid;
  v_result jsonb;
begin
  if not public.is_app_admin() then
    raise exception using errcode = 'P0001', message = 'MANAGED_BRAND_FORBIDDEN: app admin access required';
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception using errcode = 'P0001', message = 'MANAGED_BRAND_IDEMPOTENCY_KEY_REQUIRED: p_idempotency_key is required';
  end if;

  v_actor := auth.email();

  v_workspace_name := nullif(btrim(coalesce(p_input ->> 'workspace_name', '')), '');
  v_raw_slug := p_input ->> 'tenant_slug';
  v_client_email := nullif(btrim(coalesce(p_input ->> 'client_email', '')), '');
  v_client_name := nullif(btrim(coalesce(p_input ->> 'client_name', '')), '');
  v_client_type := nullif(p_input ->> 'client_type', '');
  v_site_type := nullif(p_input ->> 'site_type', '');
  v_products_enabled := coalesce((p_input ->> 'products_enabled')::boolean, false);
  v_workspace_fields := coalesce(p_input -> 'initial_workspace', '{}'::jsonb);

  v_slug := public._normalize_managed_brand_slug(v_raw_slug);

  if v_workspace_name is null then
    raise exception using errcode = 'P0001', message = 'MANAGED_BRAND_NAME_REQUIRED: workspace/brand display name is required';
  end if;
  if v_client_name is null then
    raise exception using errcode = 'P0001', message = 'MANAGED_BRAND_CLIENT_NAME_REQUIRED: client/contact name is required';
  end if;
  if v_slug is null
     or char_length(v_slug) < 2 or char_length(v_slug) > 50
     or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     or v_slug = 'joint-x'
     or v_slug ~* '(^|-)(qa|demo|test)(-|$)'
  then
    raise exception using errcode = 'P0001', message = 'MANAGED_BRAND_SLUG_INVALID: tenant slug is invalid or reserved';
  end if;
  if v_client_email is null or v_client_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception using errcode = 'P0001', message = 'MANAGED_BRAND_EMAIL_INVALID: canonical client/owner email is not valid';
  end if;

  -- Post-review: initial_workspace must pass the same 21-field allowlist
  -- as admin_update_managed_client_workspace/admin_initialize_managed_client_workspace
  -- (client_type/site_type stay their own separate top-level constrained
  -- inputs above, not part of this payload) - an unknown key here must
  -- reject, not be silently ignored, keeping all three workspace-mutation
  -- entry points aligned.
  perform public._validate_managed_workspace_update_keys(v_workspace_fields);

  v_hostname := v_slug || '.xos.jointx.co.za';

  -- Fingerprint every resolved input that changes the outcome (not the
  -- idempotency key itself), same convention as XOS 3B's
  -- admin_onboard_client_commerce_product.
  v_fingerprint := md5(
    v_workspace_name || '|' ||
    v_slug || '|' ||
    lower(v_client_email) || '|' ||
    v_client_name || '|' ||
    coalesce(v_client_type, '') || '|' ||
    coalesce(v_site_type, '') || '|' ||
    v_products_enabled::text || '|' ||
    v_workspace_fields::text
  );

  -- Serialize retries/double-clicks sharing this exact idempotency key.
  perform pg_advisory_xact_lock(hashtextextended('managed_brand_provision:' || p_idempotency_key, 0));

  select * into v_existing_op from public.managed_brand_provisioning_operations where idempotency_key = p_idempotency_key;
  if found then
    if v_existing_op.request_fingerprint is distinct from v_fingerprint then
      raise exception using errcode = 'P0001', message = 'MANAGED_BRAND_IDEMPOTENCY_CONFLICT: idempotency key already used with a different payload';
    end if;
    return v_existing_op.result;
  end if;

  -- Also serialize concurrent provisioning attempts targeting the SAME
  -- slug under DIFFERENT idempotency keys - the lock above only protects
  -- replays of one call; this prevents a slug/hostname uniqueness race
  -- between two distinct wizard sessions.
  perform pg_advisory_xact_lock(hashtextextended('managed_brand_slug:' || v_slug, 0));

  if exists (select 1 from public.tenants where slug = v_slug) then
    raise exception using errcode = 'P0001', message = format('MANAGED_BRAND_SLUG_TAKEN: tenant slug "%s" is already in use', v_slug);
  end if;
  if exists (select 1 from public.tenant_domains where hostname = v_hostname) then
    raise exception using errcode = 'P0001', message = format('MANAGED_BRAND_HOSTNAME_TAKEN: hostname "%s" is already registered', v_hostname);
  end if;

  -- Post-review (blocker): public.clients.email has no global unique
  -- constraint, so the email-conflict check below is only race-safe if
  -- it runs while holding a lock keyed on the normalized email itself -
  -- otherwise two concurrent provisioning calls with different slugs/
  -- idempotency keys but the SAME canonical email could both pass the
  -- check before either transaction commits. Deterministic, documented
  -- global lock-acquisition order for this function (never varied, so
  -- two concurrent calls can never form a wait cycle): idempotency-key ->
  -- slug -> email. No separate hostname lock is needed - hostname is
  -- derived 1:1 from slug, so the slug lock already serializes it.
  perform pg_advisory_xact_lock(hashtextextended('managed_brand_email:' || lower(btrim(v_client_email)), 0));

  if exists (select 1 from public.clients where lower(email) = lower(v_client_email)) then
    raise exception using errcode = 'P0001', message = 'MANAGED_BRAND_CLIENT_EMAIL_TAKEN: a clients row with this email already exists';
  end if;

  select au.id into v_owner_id from auth.users au where lower(au.email) = lower(v_client_email) limit 1;
  if v_owner_id is null then
    raise exception using errcode = 'P0001', message = 'MANAGED_BRAND_OWNER_ACCOUNT_REQUIRED: the owner must sign in/create their XOS account with this exact email before the workspace can be provisioned';
  end if;

  -- ---- Provision, in dependency order (mirrors
  -- supabase/provisioning/xos_tenant_provisioning_template.sql, except
  -- the XOS domain is created PENDING, never active - see header note) ----
  insert into public.tenants (slug, name, status, settings)
  values (v_slug, v_workspace_name, 'active', '{}'::jsonb)
  returning id into v_tenant_id;

  -- Post-review: brand_name is set explicitly to the workspace/brand
  -- name, separately from name (the contact person) - the unified read
  -- model's brand_name display (section 11 below) would otherwise show
  -- the contact's name instead of the brand whenever they differ.
  insert into public.clients (tenant_id, name, brand_name, email, status)
  values (v_tenant_id, v_client_name, v_workspace_name, v_client_email, 'active')
  returning id into v_client_id;

  insert into public.tenant_domains (tenant_id, hostname, surface, status, is_primary)
  values (v_tenant_id, v_hostname, 'xos_admin', 'pending', true);

  insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role, status)
  values (v_tenant_id, v_owner_id, 'owner', 'active');

  if v_products_enabled then
    insert into public.tenant_capabilities (tenant_id, capability_key, enabled)
    values (v_tenant_id, 'products', true)
    on conflict (tenant_id, capability_key) do update set enabled = true, updated_at = now();
  end if;

  insert into public.managed_client_workspaces (
    tenant_id, client_id, client_type, site_type, onboarding_stage, site_status,
    storefront_status, domain_status, assets_status, content_status,
    products_services_status, pricing_status, mockup_status, launch_readiness_status,
    preview_url, live_url, domain_name, site_repo_url, next_action, next_action_owner,
    next_action_due_at, launch_target_date, internal_notes
  ) values (
    v_tenant_id, v_client_id, v_client_type, v_site_type,
    coalesce(v_workspace_fields ->> 'onboarding_stage', '01 Intake'),
    v_workspace_fields ->> 'site_status', v_workspace_fields ->> 'storefront_status', v_workspace_fields ->> 'domain_status',
    v_workspace_fields ->> 'assets_status', v_workspace_fields ->> 'content_status', v_workspace_fields ->> 'products_services_status',
    v_workspace_fields ->> 'pricing_status', v_workspace_fields ->> 'mockup_status', v_workspace_fields ->> 'launch_readiness_status',
    v_workspace_fields ->> 'preview_url', v_workspace_fields ->> 'live_url', v_workspace_fields ->> 'domain_name', v_workspace_fields ->> 'site_repo_url',
    v_workspace_fields ->> 'next_action', v_workspace_fields ->> 'next_action_owner',
    nullif(v_workspace_fields ->> 'next_action_due_at', '')::timestamptz, nullif(v_workspace_fields ->> 'launch_target_date', '')::date,
    v_workspace_fields ->> 'internal_notes'
  )
  returning id into v_workspace_id;

  insert into public.opps_activity_events (
    tenant_id, actor_email, actor_name, event_type, entity_type, entity_id, summary, metadata
  ) values (
    v_tenant_id, v_actor, v_actor, 'managed_brand_provisioned', 'tenant', v_tenant_id,
    'Provisioned managed brand "' || v_workspace_name || '" (tenant ' || v_slug || ')',
    jsonb_build_object(
      'client_id', v_client_id, 'workspace_id', v_workspace_id, 'hostname', v_hostname,
      'products_enabled', v_products_enabled, 'idempotency_key', p_idempotency_key
    )
  );

  v_result := jsonb_build_object(
    'tenant_id', v_tenant_id,
    'tenant_slug', v_slug,
    'client_id', v_client_id,
    'workspace_id', v_workspace_id,
    'xos_hostname', v_hostname,
    'xos_status', 'pending',
    'products_capability_enabled', v_products_enabled
  );

  insert into public.managed_brand_provisioning_operations (
    idempotency_key, actor_email, request_fingerprint, result
  ) values (
    p_idempotency_key, v_actor, v_fingerprint, v_result
  );

  return v_result;
end;
$$;

revoke all on function public.admin_provision_managed_brand(jsonb, text) from public;
revoke all on function public.admin_provision_managed_brand(jsonb, text) from anon;
grant execute on function public.admin_provision_managed_brand(jsonb, text) to authenticated;

-- =====================================================================
-- PART E — admin_activate_managed_xos_domain(p_tenant_id)
-- APP ADMIN ONLY. The only way a Phase-2-provisioned domain ever reaches
-- status = 'active' - never automatic, always this explicit call, gated
-- in the UI behind the operator's manual Vercel-attachment confirmation.
-- Accepts only a tenant id, never a hostname - it locates the tenant's
-- OWN primary xos_admin domain itself, so there is no way to activate an
-- arbitrary domain row via this RPC.
-- =====================================================================

create function public.admin_activate_managed_xos_domain(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_actor text;
  v_tenant public.tenants;
  v_domain public.tenant_domains;
begin
  if not public.is_app_admin() then
    raise exception using errcode = 'P0001', message = 'MANAGED_BRAND_FORBIDDEN: app admin access required';
  end if;

  select * into v_tenant from public.tenants where id = p_tenant_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'MANAGED_BRAND_TENANT_NOT_FOUND: tenant does not exist';
  end if;
  if v_tenant.slug = 'joint-x' or v_tenant.slug ~* '(^|-)(qa|demo|test)(-|$)' then
    raise exception using errcode = 'P0001', message = 'MANAGED_BRAND_SYSTEM_TENANT_FORBIDDEN: cannot activate a system/QA/demo/test tenant domain';
  end if;

  select * into v_domain
  from public.tenant_domains
  where tenant_id = p_tenant_id and surface = 'xos_admin' and is_primary = true;
  if not found then
    raise exception using errcode = 'P0001', message = 'MANAGED_BRAND_XOS_DOMAIN_NOT_FOUND: no primary xos_admin domain exists for this tenant';
  end if;

  if v_domain.status = 'active' then
    -- Idempotent: re-activating an already-active domain is a safe no-op.
    return jsonb_build_object('tenant_id', p_tenant_id, 'hostname', v_domain.hostname, 'status', v_domain.status);
  end if;

  if v_domain.status not in ('pending', 'verified') then
    raise exception using errcode = 'P0001', message = format('MANAGED_BRAND_XOS_DOMAIN_UNSAFE_TRANSITION: cannot activate a domain with status "%s"', v_domain.status);
  end if;

  v_actor := auth.email();

  update public.tenant_domains
  set status = 'active', verified_at = coalesce(verified_at, now()), updated_at = now()
  where id = v_domain.id
  returning * into v_domain;

  insert into public.opps_activity_events (
    tenant_id, actor_email, actor_name, event_type, entity_type, entity_id, summary, metadata
  ) values (
    p_tenant_id, v_actor, v_actor, 'managed_xos_domain_activated', 'tenant_domain', v_domain.id,
    'Activated XOS domain ' || v_domain.hostname || ' for tenant ' || v_tenant.slug,
    jsonb_build_object('hostname', v_domain.hostname)
  );

  return jsonb_build_object('tenant_id', p_tenant_id, 'hostname', v_domain.hostname, 'status', v_domain.status);
end;
$$;

revoke all on function public.admin_activate_managed_xos_domain(uuid) from public;
revoke all on function public.admin_activate_managed_xos_domain(uuid) from anon;
grant execute on function public.admin_activate_managed_xos_domain(uuid) to authenticated;

-- =====================================================================
-- PART F — admin_set_managed_tenant_products_capability(p_tenant_id, p_enabled)
-- APP ADMIN ONLY. Reuses the existing tenant_capabilities authority as-
-- is (Phase 2 introduces no new module system) and is scoped to
-- capability_key = 'products' only. Never touches commerce.products -
-- turning the capability off only controls the XOS-side capability flag,
-- never deletes or alters any Commerce product row.
--
-- Post-review: "has at least one linked clients row" was too broad a
-- gate on its own - it would let the capability be enabled for any
-- tenant with a client at all, not just a genuine managed brand. This
-- now requires the same structural signal the read model itself uses
-- (public._is_eligible_managed_tenant) - a linked client AND at least
-- one of a matching workspace, a non-disabled xos_admin/storefront
-- domain, or an already-enabled capability. The capability toggle is an
-- operational control for a tenant that is already established as
-- managed (via provisioning, which sets the domain first), never a
-- bootstrapping mechanism for making an arbitrary tenant "managed".
-- =====================================================================

create function public.admin_set_managed_tenant_products_capability(p_tenant_id uuid, p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_actor text;
  v_tenant public.tenants;
begin
  if not public.is_app_admin() then
    raise exception using errcode = 'P0001', message = 'MANAGED_BRAND_FORBIDDEN: app admin access required';
  end if;
  if p_enabled is null then
    raise exception using errcode = 'P0001', message = 'MANAGED_BRAND_CAPABILITY_VALUE_REQUIRED: p_enabled is required';
  end if;

  select * into v_tenant from public.tenants where id = p_tenant_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'MANAGED_BRAND_TENANT_NOT_FOUND: tenant does not exist';
  end if;
  if v_tenant.slug = 'joint-x' or v_tenant.slug ~* '(^|-)(qa|demo|test)(-|$)' then
    raise exception using errcode = 'P0001', message = 'MANAGED_BRAND_SYSTEM_TENANT_FORBIDDEN: cannot manage capability for a system/QA/demo/test tenant';
  end if;
  if not public._is_eligible_managed_tenant(p_tenant_id) then
    raise exception using errcode = 'P0001', message = 'MANAGED_BRAND_TENANT_NOT_MANAGED: tenant has no managed-tenant signal (workspace/domain/capability) - not a recognized managed brand';
  end if;

  v_actor := auth.email();

  insert into public.tenant_capabilities (tenant_id, capability_key, enabled)
  values (p_tenant_id, 'products', p_enabled)
  on conflict (tenant_id, capability_key) do update set enabled = excluded.enabled, updated_at = now();

  insert into public.opps_activity_events (
    tenant_id, actor_email, actor_name, event_type, entity_type, entity_id, summary, metadata
  ) values (
    p_tenant_id, v_actor, v_actor, 'managed_tenant_products_capability_changed', 'tenant_capability', p_tenant_id,
    'Set products capability to ' || p_enabled::text || ' for tenant ' || v_tenant.slug,
    jsonb_build_object('capability_key', 'products', 'enabled', p_enabled)
  );

  return jsonb_build_object('tenant_id', p_tenant_id, 'capability_key', 'products', 'enabled', p_enabled);
end;
$$;

revoke all on function public.admin_set_managed_tenant_products_capability(uuid, boolean) from public;
revoke all on function public.admin_set_managed_tenant_products_capability(uuid, boolean) from anon;
grant execute on function public.admin_set_managed_tenant_products_capability(uuid, boolean) to authenticated;

-- =====================================================================
-- 11. admin_list_managed_clients() - CREATE OR REPLACE, same function
-- identity as Phase 0/1 (20260823140000). The ONLY logical change is the
-- modern_tenants CTE, which now delegates to
-- public._is_eligible_managed_tenant() (section 2) instead of requiring
-- an ACTIVE domain/capability inline - so a brand newly provisioned via
-- Part D (xos_admin domain status = 'pending') still appears immediately
-- as its own row, rather than being hidden until someone remembers to
-- run Part E's activation step. tenant_primary_client / modern_rows /
-- legacy_rows and the whole reconciliation/Commerce-eligibility/access-
-- email-fallback logic are otherwise byte-identical to Phase 0/1 - see
-- that migration's header for the full rationale, which still applies
-- unchanged. is_opps_staff() remains the sole actor gate (unchanged -
-- this is still the cross-tenant staff READ surface, not a mutation).
-- =====================================================================

create or replace function public.admin_list_managed_clients()
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
    -- Structural eligibility (Phase 2 refinement - see
    -- public._is_eligible_managed_tenant's own header note): a linked
    -- public.clients row plus at least one of a matching workspace, a
    -- non-disabled xos_admin/storefront domain (pending counts now, not
    -- just active), or an enabled tenant_capabilities row. Slug naming
    -- remains an exclusion heuristic only (baked into the helper).
    select t.*
    from public.tenants t
    where public._is_eligible_managed_tenant(t.id)
  ),
  tenant_primary_client as (
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
        -- Post-review: brand identity (pc.brand_name, then the tenant's
        -- own name - itself the workspace/brand name at provisioning
        -- time) must be preferred over the contact person's name
        -- (pc.name) whenever they differ - see admin_provision_managed_brand,
        -- which now sets clients.brand_name explicitly for this reason.
        'brand_name', coalesce(pc.brand_name, mt.name, pc.name),
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
--   select has_function_privilege('anon', 'public.admin_provision_managed_brand(jsonb,text)', 'EXECUTE'); -- expect false
--   select has_table_privilege('authenticated', 'public.managed_brand_provisioning_operations', 'SELECT'); -- expect false
--   select public._is_eligible_managed_tenant('4e0f1fa4-3149-40fa-a3f8-00ec251a2c11'); -- expect true (GSB)
-- =====================================================================
