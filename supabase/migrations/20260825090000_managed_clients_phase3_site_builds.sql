-- Managed Clients Control Plane — Phase 3: Site & Template Provisioning
-- + Generate Build Brief.
--
-- Builds on the live Phase 0/1/2 control plane (20260823140000,
-- 20260824090000/090100/090150/090200) without editing any of it. Adds
-- three new normalized tables and a narrow, app-admin-only RPC surface
-- for site-template registry management, per-workspace site-build
-- configuration, and deterministic, versioned build-brief generation.
--
-- Recovery note: before writing any of this, the repo's full git history
-- (all branches, commit messages, and every file ever added) and the
-- broader local Joint X workspace (archive/legacy-app folders) were
-- searched for an authoritative prior "site build"/"template registry"
-- implementation. Nothing was found - no fake/placeholder templates or
-- fabricated prior behavior are seeded here as a result; the template
-- registry starts genuinely empty (see admin_list_managed_site_templates
-- - the UI shows "No site templates configured yet." until an operator
-- adds one through the new admin registry surface).
--
-- Foundation-model neutrality: admin_generate_managed_site_build_brief
-- is pure deterministic SQL/plpgsql string composition over structured
-- Joint X data. It never calls an LLM and is not "Claude-specific" (or
-- specific to any other coding agent) - the output is a plain-text
-- implementation brief meant to be pasted into whichever coding agent
-- the operator is using that day.
--
-- Architectural boundary: public.managed_client_workspaces (Phase 0-2)
-- remains the high-level operational workspace record (client_type,
-- site_type, onboarding_stage, readiness statuses, preview/live URLs,
-- domain, repo, next action). It is NOT extended with site-build detail
-- fields - that is a separate, normalized domain (this migration's three
-- new tables), matching this phase's explicit architectural principle.
-- managed_client_workspaces.onboarding_stage is never mutated by
-- anything in this migration - a generated build brief changes only
-- managed_site_builds.status (draft -> brief_ready, and only on first
-- generation - see Part C below), a narrower, site-build-specific status
-- track, not the overall client lifecycle.
--
-- Authority: every mutation/generation RPC requires public.is_app_admin()
-- (now NULL-safe and search_path-hardened - see 20260824090200), never
-- is_opps_staff() alone - these are the same class of high-impact
-- operation as Phase 2's provisioning RPCs. SECURITY DEFINER, fixed
-- search_path = pg_catalog, public, PUBLIC/anon revoked, authenticated
-- granted, exactly matching the established Phase 2 pattern. No browser
-- table access is granted to any of the three new tables - RLS is
-- enabled with zero policies, SECURITY DEFINER RPCs only.
-- =====================================================================

-- =====================================================================
-- PART A — public.managed_site_templates: generic internal template
-- registry. Metadata only - NEVER repository tokens, Vercel tokens,
-- Supabase service keys, environment secrets, or passwords. No
-- create-with-seed-data here; the registry starts empty (see header
-- note above).
-- =====================================================================

create table public.managed_site_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null unique,
  name text not null,
  description text,
  supported_site_types text[] not null default '{}',
  repository_url text,
  preview_url text,
  framework text,
  status text not null default 'active' check (status in ('active', 'archived')),
  default_pages jsonb not null default '[]'::jsonb,
  default_features jsonb not null default '[]'::jsonb,
  build_instructions text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.managed_site_templates enable row level security;
revoke all on public.managed_site_templates from public;
revoke all on public.managed_site_templates from anon;
revoke all on public.managed_site_templates from authenticated;

-- =====================================================================
-- PART B — public.managed_site_builds: at most one non-archived
-- ("active") site build per managed workspace, enforced by a partial
-- unique index rather than application logic alone. tenant_id/client_id/
-- workspace_id are always resolved and verified server-side (see
-- public._resolve_active_managed_workspace below) - the browser only
-- ever supplies a tenant_id to the upsert RPC, never these FKs directly.
-- site_type/client_type stay on managed_client_workspaces, per the
-- architectural boundary above - this table does not duplicate them.
-- =====================================================================

create table public.managed_site_builds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  client_id uuid not null references public.clients(id),
  workspace_id uuid not null references public.managed_client_workspaces(id),
  template_id uuid references public.managed_site_templates(id),

  -- Post-review (spec gap): distinguishes "operator has not chosen a
  -- template yet" from "operator intentionally selected a custom build" -
  -- previously both were indistinguishable states of template_id = null.
  -- 'custom' mode always has template_id = null (enforced by both this
  -- CHECK and admin_upsert_managed_site_build's own normalization);
  -- 'template' mode is the only mode where a missing template_id
  -- surfaces as a readiness gap.
  build_mode text not null default 'template' check (build_mode in ('template', 'custom')),
  check (build_mode = 'template' or template_id is null),

  status text not null default 'draft' check (status in ('draft', 'brief_ready', 'building', 'preview_ready', 'review', 'live', 'archived')),

  primary_goal text,
  brand_summary text,
  target_audience text,
  visual_direction text,
  tone_of_voice text,

  required_pages jsonb not null default '[]'::jsonb,
  required_features jsonb not null default '[]'::jsonb,
  integrations jsonb not null default '[]'::jsonb,
  reference_urls jsonb not null default '[]'::jsonb,

  content_notes text,
  product_notes text,
  technical_notes text,
  deployment_notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_managed_site_builds_tenant_id on public.managed_site_builds (tenant_id);

-- At most one non-archived build per workspace (partial unique index -
-- an archived build never blocks a fresh one being started later).
create unique index managed_site_builds_one_active_per_workspace
  on public.managed_site_builds (workspace_id)
  where status <> 'archived';

alter table public.managed_site_builds enable row level security;
revoke all on public.managed_site_builds from public;
revoke all on public.managed_site_builds from anon;
revoke all on public.managed_site_builds from authenticated;

-- =====================================================================
-- PART C — public.managed_site_build_briefs: versioned, immutable brief
-- artifacts. A new generation ALWAYS inserts a new version - existing
-- versions are never updated or overwritten, so the brief a coding agent
-- was actually handed stays reproducible even after later regeneration.
-- generated_by follows the established audit convention used throughout
-- this codebase (opps_activity_events.actor_email, XOS 3B/Phase 2's
-- v_actor) - a text email, not a raw auth_user_id.
-- =====================================================================

create table public.managed_site_build_briefs (
  id uuid primary key default gen_random_uuid(),
  site_build_id uuid not null references public.managed_site_builds(id),
  version integer not null,
  source_fingerprint text not null,
  source_snapshot jsonb not null,
  brief_text text not null,
  generated_at timestamptz not null default now(),
  generated_by text not null,
  unique (site_build_id, version)
);

create index idx_managed_site_build_briefs_site_build_id on public.managed_site_build_briefs (site_build_id, version desc);

alter table public.managed_site_build_briefs enable row level security;
revoke all on public.managed_site_build_briefs from public;
revoke all on public.managed_site_build_briefs from anon;
revoke all on public.managed_site_build_briefs from authenticated;

-- =====================================================================
-- Internal helpers (not part of the public API - never granted to
-- authenticated; called only from inside this migration's own SECURITY
-- DEFINER RPCs, matching the commerce.ensure_product_link /
-- public._is_eligible_managed_tenant precedent).
-- =====================================================================

-- Shape validator (post-review, item 7): the key-allowlist validators
-- below only ever checked KEY names, not VALUE shape - a malformed
-- direct RPC call (e.g. a string or object where an array was expected)
-- would otherwise reach jsonb_array_length/jsonb_array_elements_text
-- deep inside admin_upsert_managed_site_build or the brief generator and
-- raise a generic, unhelpful Postgres JSON-type error instead of a
-- deterministic SITE_BUILD_INPUT_INVALID/SITE_TEMPLATE_INPUT_INVALID one.
create function public._validate_jsonb_string_array(p_value jsonb, p_field_name text, p_error_code text)
returns void
language plpgsql
set search_path to 'pg_catalog', 'public'
as $$
begin
  if p_value is null or p_value = 'null'::jsonb then
    return;
  end if;
  if jsonb_typeof(p_value) <> 'array' then
    raise exception using errcode = 'P0001', message = format('%s: "%s" must be a JSON array', p_error_code, p_field_name);
  end if;
  if exists (select 1 from jsonb_array_elements(p_value) e where jsonb_typeof(e) <> 'string') then
    raise exception using errcode = 'P0001', message = format('%s: "%s" must be a JSON array of strings', p_error_code, p_field_name);
  end if;
end;
$$;

revoke all on function public._validate_jsonb_string_array(jsonb, text, text) from public;
revoke all on function public._validate_jsonb_string_array(jsonb, text, text) from anon;
revoke all on function public._validate_jsonb_string_array(jsonb, text, text) from authenticated;

-- Canonical workspace site types (matches Phase 2's SITE_TYPES exactly -
-- src/components/managedClients/ManagedClientOperations.jsx) - used to
-- reject a template's supported_site_types typo (e.g. "ecommerce" or
-- "E-commerce") that would otherwise never match a real
-- managed_client_workspaces.site_type value and silently make site-type
-- compatibility checks meaningless.
create function public._validate_managed_site_types(p_value jsonb)
returns void
language plpgsql
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_allowed constant text[] := array[
    'Portfolio / Booking', 'Catalog', 'Ecommerce', 'Preorder', 'Landing Page',
    'Quote Request', 'Service Website', 'Other'
  ];
begin
  if p_value is null or p_value = 'null'::jsonb then
    return;
  end if;
  if exists (select 1 from jsonb_array_elements_text(p_value) x where not (x = any(v_allowed))) then
    raise exception using errcode = 'P0001', message = 'SITE_TEMPLATE_SITE_TYPE_INVALID: supported_site_types must only contain canonical workspace site types';
  end if;
end;
$$;

revoke all on function public._validate_managed_site_types(jsonb) from public;
revoke all on function public._validate_managed_site_types(jsonb) from anon;
revoke all on function public._validate_managed_site_types(jsonb) from authenticated;

create function public._validate_site_template_input_keys(p_input jsonb)
returns void
language plpgsql
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_key text;
  v_allowed constant text[] := array[
    'template_key', 'name', 'description', 'supported_site_types', 'repository_url',
    'preview_url', 'framework', 'status', 'default_pages', 'default_features', 'build_instructions'
  ];
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception using errcode = 'P0001', message = 'SITE_TEMPLATE_INPUT_INVALID: template input must be a JSON object';
  end if;
  for v_key in select jsonb_object_keys(p_input) loop
    if not (v_key = any(v_allowed)) then
      raise exception using errcode = 'P0001', message = format('SITE_TEMPLATE_UPDATE_UNKNOWN_KEY: "%s" is not an editable template field', v_key);
    end if;
  end loop;

  perform public._validate_jsonb_string_array(p_input -> 'supported_site_types', 'supported_site_types', 'SITE_TEMPLATE_INPUT_INVALID');
  perform public._validate_managed_site_types(p_input -> 'supported_site_types');
  perform public._validate_jsonb_string_array(p_input -> 'default_pages', 'default_pages', 'SITE_TEMPLATE_INPUT_INVALID');
  perform public._validate_jsonb_string_array(p_input -> 'default_features', 'default_features', 'SITE_TEMPLATE_INPUT_INVALID');
end;
$$;

revoke all on function public._validate_site_template_input_keys(jsonb) from public;
revoke all on function public._validate_site_template_input_keys(jsonb) from anon;
revoke all on function public._validate_site_template_input_keys(jsonb) from authenticated;

create function public._validate_site_build_input_keys(p_input jsonb)
returns void
language plpgsql
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_key text;
  v_allowed constant text[] := array[
    'template_id', 'build_mode', 'primary_goal', 'brand_summary', 'target_audience', 'visual_direction', 'tone_of_voice',
    'required_pages', 'required_features', 'integrations', 'reference_urls',
    'content_notes', 'product_notes', 'technical_notes', 'deployment_notes'
  ];
begin
  if p_input is null then
    return;
  end if;
  if jsonb_typeof(p_input) <> 'object' then
    raise exception using errcode = 'P0001', message = 'SITE_BUILD_INPUT_INVALID: site build input must be a JSON object';
  end if;
  for v_key in select jsonb_object_keys(p_input) loop
    if not (v_key = any(v_allowed)) then
      raise exception using errcode = 'P0001', message = format('SITE_BUILD_UPDATE_UNKNOWN_KEY: "%s" is not an editable site-build field', v_key);
    end if;
  end loop;

  if p_input ? 'build_mode' and nullif(p_input ->> 'build_mode', '') is not null and (p_input ->> 'build_mode') not in ('template', 'custom') then
    raise exception using errcode = 'P0001', message = 'SITE_BUILD_MODE_INVALID: build_mode must be template or custom';
  end if;

  perform public._validate_jsonb_string_array(p_input -> 'required_pages', 'required_pages', 'SITE_BUILD_INPUT_INVALID');
  perform public._validate_jsonb_string_array(p_input -> 'required_features', 'required_features', 'SITE_BUILD_INPUT_INVALID');
  perform public._validate_jsonb_string_array(p_input -> 'integrations', 'integrations', 'SITE_BUILD_INPUT_INVALID');
  perform public._validate_jsonb_string_array(p_input -> 'reference_urls', 'reference_urls', 'SITE_BUILD_INPUT_INVALID');
end;
$$;

revoke all on function public._validate_site_build_input_keys(jsonb) from public;
revoke all on function public._validate_site_build_input_keys(jsonb) from anon;
revoke all on function public._validate_site_build_input_keys(jsonb) from authenticated;

-- Resolves and verifies a modern managed tenant's canonical client and
-- EXISTING workspace server-side - the inverse precondition of Phase 2's
-- admin_initialize_managed_client_workspace (which requires no workspace
-- yet); this requires one to already exist. Ambiguity (more than one
-- linked client) is rejected outright, matching Phase 2's own write-path
-- safety rule - a write must never guess.
create function public._resolve_active_managed_workspace(p_tenant_id uuid, out o_client_id uuid, out o_workspace_id uuid)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_client_count int;
begin
  if not public._is_eligible_managed_tenant(p_tenant_id) then
    raise exception using errcode = 'P0001', message = 'SITE_BUILD_TENANT_NOT_ELIGIBLE: tenant is not a recognized managed brand tenant';
  end if;

  select count(*) into v_client_count from public.clients where tenant_id = p_tenant_id;
  if v_client_count = 0 then
    raise exception using errcode = 'P0001', message = 'SITE_BUILD_CLIENT_NOT_FOUND: tenant has no linked client';
  elsif v_client_count > 1 then
    raise exception using errcode = 'P0001', message = 'SITE_BUILD_CLIENT_AMBIGUOUS: tenant has more than one linked client - cannot determine a safe canonical client';
  end if;
  select id into o_client_id from public.clients where tenant_id = p_tenant_id;

  select id into o_workspace_id from public.managed_client_workspaces where tenant_id = p_tenant_id and client_id = o_client_id;
  if o_workspace_id is null then
    raise exception using errcode = 'P0001', message = 'SITE_BUILD_NO_WORKSPACE: tenant has no managed_client_workspaces row yet - initialize the workspace first';
  end if;
end;
$$;

revoke all on function public._resolve_active_managed_workspace(uuid) from public;
revoke all on function public._resolve_active_managed_workspace(uuid) from anon;
revoke all on function public._resolve_active_managed_workspace(uuid) from authenticated;

-- Readiness (Part F): 'blocked' is reserved for structural errors -
-- invalid/archived template, or (post-review, item 2) a template that no
-- longer supports the workspace's CURRENT site type (site_type can
-- change later through the Phase 2 workspace editor, after the build was
-- saved and even after a brief was generated - readiness and generation
-- must re-check compatibility against live data every time, not just at
-- the moment the template was originally selected). Workspace/tenant/
-- client structural problems are already fail-fast raised by the
-- resolver above and never reach this function. Missing content NEVER
-- blocks - it is surfaced as 'ready_with_missing_inputs' plus an
-- explicit missing-inputs list, so a brief can legitimately say
-- "Missing: final hero copy" instead of fabricating placeholder content.
--
-- build_mode (post-review, item 3): in 'custom' mode, template_id is
-- always null by construction (see managed_site_builds' own CHECK
-- constraint and admin_upsert_managed_site_build's normalization), and
-- the "no template selected" gap simply does not apply - an explicit
-- custom build can reach 'ready' with no template at all. In 'template'
-- mode (the default), a null template_id IS a genuine missing input.
create function public._managed_site_build_readiness(
  p_build_mode text,
  p_template_id uuid,
  p_primary_goal text,
  p_brand_summary text,
  p_required_pages jsonb,
  p_required_features jsonb,
  p_site_type text,
  p_assets_status text,
  p_content_status text
)
returns jsonb
language plpgsql
stable
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_missing text[] := '{}';
  v_blocked boolean := false;
  v_template_status text;
  v_template_site_types text[];
begin
  if p_build_mode = 'custom' then
    -- template_id is expected to be null here by construction; no
    -- "no template selected" warning applies to an explicit custom build.
    null;
  elsif p_template_id is not null then
    select status, supported_site_types into v_template_status, v_template_site_types
    from public.managed_site_templates where id = p_template_id;
    if v_template_status is null then
      v_blocked := true;
      v_missing := array_append(v_missing, 'Selected template no longer exists.');
    elsif v_template_status <> 'active' then
      v_blocked := true;
      v_missing := array_append(v_missing, 'Selected template has been archived - choose an active template.');
    elsif p_site_type is not null
      and coalesce(array_length(v_template_site_types, 1), 0) > 0
      and not (p_site_type = any(v_template_site_types))
    then
      v_blocked := true;
      v_missing := array_append(v_missing, format('Selected template does not support current workspace site type "%s".', p_site_type));
    end if;
  else
    v_missing := array_append(v_missing, 'No template selected (mark explicitly custom if intentional).');
  end if;

  if p_site_type is null then
    v_missing := array_append(v_missing, 'Site type not set on the workspace.');
  end if;
  if p_primary_goal is null then
    v_missing := array_append(v_missing, 'Primary goal not set.');
  end if;
  if p_brand_summary is null then
    v_missing := array_append(v_missing, 'Brand summary not set.');
  end if;
  if coalesce(jsonb_array_length(p_required_pages), 0) = 0 then
    v_missing := array_append(v_missing, 'No required pages configured.');
  end if;
  if coalesce(jsonb_array_length(p_required_features), 0) = 0 then
    v_missing := array_append(v_missing, 'No required features configured.');
  end if;
  if p_assets_status is null then
    v_missing := array_append(v_missing, 'Assets status unknown.');
  end if;
  if p_content_status is null then
    v_missing := array_append(v_missing, 'Content status unknown.');
  end if;

  return jsonb_build_object(
    'state', case
      when v_blocked then 'blocked'
      when array_length(v_missing, 1) > 0 then 'ready_with_missing_inputs'
      else 'ready'
    end,
    'missing_inputs', to_jsonb(v_missing)
  );
end;
$$;

revoke all on function public._managed_site_build_readiness(text, uuid, text, text, jsonb, jsonb, text, text, text) from public;
revoke all on function public._managed_site_build_readiness(text, uuid, text, text, jsonb, jsonb, text, text, text) from anon;
revoke all on function public._managed_site_build_readiness(text, uuid, text, text, jsonb, jsonb, text, text, text) from authenticated;

-- Single source of truth for the brief source snapshot (Part D/E) -
-- shared by admin_get_managed_site_build (to detect and report
-- staleness WITHOUT generating a new version) and
-- admin_generate_managed_site_build_brief (to actually generate one).
-- Takes already-resolved rows rather than re-querying by id, so a caller
-- that already fetched them for its own purposes (template display,
-- brief text composition) never pays for or risks drifting from a
-- second, subtly different resolution. fingerprint = md5(snapshot::text)
-- is computed by each caller inline (one line, trivial, nothing to
-- drift) rather than folded into this function, so a caller that only
-- needs the raw snapshot never pays for a hash it does not need either.
create function public._compute_managed_site_build_snapshot(
  p_build public.managed_site_builds,
  p_workspace public.managed_client_workspaces,
  p_tenant public.tenants,
  p_client public.clients,
  p_template public.managed_site_templates
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_products jsonb;
  v_products_enabled boolean;
begin
  v_products_enabled := coalesce((select enabled from public.tenant_capabilities where tenant_id = p_build.tenant_id and capability_key = 'products'), false);

  -- Post-review (blocker, item 4): the product query only ever RUNS when
  -- the tenant's Products capability is actually enabled. Querying
  -- commerce.products unconditionally (and only checking the flag for
  -- display) meant a hidden/disabled catalog change could silently mark
  -- a brief stale even though the brief itself never shows Commerce
  -- content for that tenant - violating "For Products-enabled managed
  -- tenants, include SAFE Commerce summaries" (implying: never otherwise).
  -- Safe Commerce product context - commerce.products/product_variants
  -- (see 20260823111500_xos_3a_products_foundation.sql) have no internal
  -- production-cost column at all; they are already the customer-facing
  -- catalog projection XOS 3A/3B established, so selecting these columns
  -- directly can never leak supplier/production cost.
  if v_products_enabled then
    -- Post-review (item 5): deterministic tie-breakers - product name
    -- and variant sort_order are both realistically non-unique (two
    -- products can share a name; two variants can share/lack a
    -- sort_order), so the primary key is appended to guarantee a
    -- stable, reproducible aggregate order regardless of how many rows
    -- happen to tie. IDs are never exposed in the generated brief text
    -- itself - they exist here only to make ORDER BY deterministic.
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', p.name, 'description', p.description, 'price', p.price, 'sale_price', p.sale_price,
      'currency', p.currency, 'availability', p.availability, 'primary_image_url', p.primary_image_url,
      'variants', coalesce((
        select jsonb_agg(jsonb_build_object('title', v.title, 'size', v.size, 'color', v.color, 'availability', v.availability) order by v.sort_order nulls last, v.title, v.id)
        from commerce.product_variants v where v.product_id = p.id
      ), '[]'::jsonb)
    ) order by p.name, p.id), '[]'::jsonb)
    into v_products
    from commerce.products p
    where p.tenant_id = p_build.tenant_id and p.status <> 'archived';
  else
    v_products := '[]'::jsonb;
  end if;

  -- Never includes auth metadata, private file contents, internal costs,
  -- supplier prices, tokens, secrets, or private conversation content -
  -- every field below is either operator-entered site-build
  -- configuration, workspace readiness status text, template metadata,
  -- or the safe Commerce projection above. Unrelated OPPS data never
  -- enters this object, so an unrelated change elsewhere in the system
  -- can never change the fingerprint derived from it.
  --
  -- Post-review (blocker, item 1): the generated brief text directly
  -- uses the SELECTED template's repository_url, supported_site_types,
  -- and build_instructions (sections 4 and readiness) - all three (plus
  -- status, since an archived template changes readiness/blocks
  -- generation) must participate here, or editing a template after a
  -- brief was generated could leave a stale brief silently reporting
  -- "Current".
  return jsonb_build_object(
    'brand_name', coalesce(p_client.brand_name, p_tenant.name, p_client.name),
    'tenant_slug', p_tenant.slug,
    'client_type', p_workspace.client_type,
    'site_type', p_workspace.site_type,
    'build_mode', p_build.build_mode,
    'template_id', p_build.template_id,
    'template_key', p_template.template_key,
    'template_name', p_template.name,
    'template_status', p_template.status,
    'template_repository_url', p_template.repository_url,
    'template_supported_site_types', to_jsonb(p_template.supported_site_types),
    'template_build_instructions', p_template.build_instructions,
    'primary_goal', p_build.primary_goal,
    'brand_summary', p_build.brand_summary,
    'target_audience', p_build.target_audience,
    'visual_direction', p_build.visual_direction,
    'tone_of_voice', p_build.tone_of_voice,
    'required_pages', p_build.required_pages,
    'required_features', p_build.required_features,
    'integrations', p_build.integrations,
    'reference_urls', p_build.reference_urls,
    'content_notes', p_build.content_notes,
    'product_notes', p_build.product_notes,
    'technical_notes', p_build.technical_notes,
    'deployment_notes', p_build.deployment_notes,
    'assets_status', p_workspace.assets_status,
    'content_status', p_workspace.content_status,
    'products_services_status', p_workspace.products_services_status,
    'pricing_status', p_workspace.pricing_status,
    'mockup_status', p_workspace.mockup_status,
    'preview_url', p_workspace.preview_url,
    'live_url', p_workspace.live_url,
    'domain_name', p_workspace.domain_name,
    'site_repo_url', p_workspace.site_repo_url,
    'products_capability_enabled', v_products_enabled,
    'commerce_products', v_products
  );
end;
$$;

revoke all on function public._compute_managed_site_build_snapshot(public.managed_site_builds, public.managed_client_workspaces, public.tenants, public.clients, public.managed_site_templates) from public;
revoke all on function public._compute_managed_site_build_snapshot(public.managed_site_builds, public.managed_client_workspaces, public.tenants, public.clients, public.managed_site_templates) from anon;
revoke all on function public._compute_managed_site_build_snapshot(public.managed_site_builds, public.managed_client_workspaces, public.tenants, public.clients, public.managed_site_templates) from authenticated;

-- =====================================================================
-- PART I / K — Template registry RPCs. APP ADMIN ONLY. No hard delete -
-- "Archive" only, so a template already referenced by a site build can
-- never be removed out from under it (managed_site_builds.template_id
-- has no ON DELETE behavior to worry about because nothing ever deletes
-- a template row).
-- =====================================================================

create function public.admin_list_managed_site_templates()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_result jsonb;
begin
  if not public.is_app_admin() then
    raise exception using errcode = 'P0001', message = 'SITE_TEMPLATE_FORBIDDEN: app admin access required';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'template_key', t.template_key, 'name', t.name, 'description', t.description,
    'supported_site_types', to_jsonb(t.supported_site_types), 'repository_url', t.repository_url,
    'preview_url', t.preview_url, 'framework', t.framework, 'status', t.status,
    'default_pages', t.default_pages, 'default_features', t.default_features,
    'build_instructions', t.build_instructions, 'created_at', t.created_at, 'updated_at', t.updated_at
  ) order by (t.status = 'active') desc, t.name asc), '[]'::jsonb)
  into v_result
  from public.managed_site_templates t;

  return v_result;
end;
$$;

revoke all on function public.admin_list_managed_site_templates() from public;
revoke all on function public.admin_list_managed_site_templates() from anon;
grant execute on function public.admin_list_managed_site_templates() to authenticated;

create function public.admin_upsert_managed_site_template(p_template_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_actor text;
  v_template public.managed_site_templates;
  v_site_types text[];
  v_status text;
begin
  if not public.is_app_admin() then
    raise exception using errcode = 'P0001', message = 'SITE_TEMPLATE_FORBIDDEN: app admin access required';
  end if;

  perform public._validate_site_template_input_keys(p_input);

  v_actor := auth.email();

  if p_input ? 'supported_site_types' then
    select array_agg(x) into v_site_types from jsonb_array_elements_text(coalesce(p_input -> 'supported_site_types', '[]'::jsonb)) x;
  end if;

  if p_input ? 'status' then
    v_status := nullif(p_input ->> 'status', '');
    if v_status is not null and v_status not in ('active', 'archived') then
      raise exception using errcode = 'P0001', message = 'SITE_TEMPLATE_STATUS_INVALID: status must be active or archived';
    end if;
  end if;

  if p_template_id is null then
    if nullif(btrim(coalesce(p_input ->> 'template_key', '')), '') is null then
      raise exception using errcode = 'P0001', message = 'SITE_TEMPLATE_KEY_REQUIRED: template_key is required';
    end if;
    if nullif(btrim(coalesce(p_input ->> 'name', '')), '') is null then
      raise exception using errcode = 'P0001', message = 'SITE_TEMPLATE_NAME_REQUIRED: name is required';
    end if;

    insert into public.managed_site_templates (
      template_key, name, description, supported_site_types, repository_url, preview_url,
      framework, status, default_pages, default_features, build_instructions
    ) values (
      btrim(p_input ->> 'template_key'), btrim(p_input ->> 'name'), p_input ->> 'description',
      coalesce(v_site_types, '{}'::text[]), p_input ->> 'repository_url', p_input ->> 'preview_url',
      p_input ->> 'framework', coalesce(v_status, 'active'),
      coalesce(p_input -> 'default_pages', '[]'::jsonb), coalesce(p_input -> 'default_features', '[]'::jsonb),
      p_input ->> 'build_instructions'
    )
    returning * into v_template;

    insert into public.opps_activity_events (tenant_id, actor_email, actor_name, event_type, entity_type, entity_id, summary, metadata)
    values (
      null, v_actor, v_actor, 'managed_site_template_created', 'managed_site_template', v_template.id,
      'Created site template "' || v_template.name || '" (' || v_template.template_key || ')',
      jsonb_build_object('template_key', v_template.template_key)
    );
  else
    select * into v_template from public.managed_site_templates where id = p_template_id;
    if not found then
      raise exception using errcode = 'P0001', message = 'SITE_TEMPLATE_NOT_FOUND: template does not exist';
    end if;

    if p_input ? 'template_key' then
      if nullif(btrim(coalesce(p_input ->> 'template_key', '')), '') is null then
        raise exception using errcode = 'P0001', message = 'SITE_TEMPLATE_KEY_REQUIRED: template_key cannot be empty';
      end if;
      if btrim(p_input ->> 'template_key') <> v_template.template_key then
        raise exception using errcode = 'P0001', message = 'SITE_TEMPLATE_KEY_IMMUTABLE: template_key cannot be changed after creation';
      end if;
    end if;

    if p_input ? 'name' and nullif(btrim(coalesce(p_input ->> 'name', '')), '') is null then
      raise exception using errcode = 'P0001', message = 'SITE_TEMPLATE_NAME_REQUIRED: name cannot be empty';
    end if;

    update public.managed_site_templates set
      name = case when p_input ? 'name' then btrim(p_input ->> 'name') else name end,
      description = case when p_input ? 'description' then p_input ->> 'description' else description end,
      supported_site_types = case when p_input ? 'supported_site_types' then coalesce(v_site_types, '{}'::text[]) else supported_site_types end,
      repository_url = case when p_input ? 'repository_url' then p_input ->> 'repository_url' else repository_url end,
      preview_url = case when p_input ? 'preview_url' then p_input ->> 'preview_url' else preview_url end,
      framework = case when p_input ? 'framework' then p_input ->> 'framework' else framework end,
      status = case when p_input ? 'status' then coalesce(v_status, status) else status end,
      default_pages = case when p_input ? 'default_pages' then coalesce(p_input -> 'default_pages', '[]'::jsonb) else default_pages end,
      default_features = case when p_input ? 'default_features' then coalesce(p_input -> 'default_features', '[]'::jsonb) else default_features end,
      build_instructions = case when p_input ? 'build_instructions' then p_input ->> 'build_instructions' else build_instructions end,
      updated_at = now()
    where id = p_template_id
    returning * into v_template;

    insert into public.opps_activity_events (tenant_id, actor_email, actor_name, event_type, entity_type, entity_id, summary, metadata)
    values (
      null, v_actor, v_actor, 'managed_site_template_updated', 'managed_site_template', v_template.id,
      'Updated site template "' || v_template.name || '"',
      jsonb_build_object('updated_keys', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(p_input) k))
    );
  end if;

  return to_jsonb(v_template);
end;
$$;

revoke all on function public.admin_upsert_managed_site_template(uuid, jsonb) from public;
revoke all on function public.admin_upsert_managed_site_template(uuid, jsonb) from anon;
grant execute on function public.admin_upsert_managed_site_template(uuid, jsonb) to authenticated;

create function public.admin_archive_managed_site_template(p_template_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_actor text;
  v_template public.managed_site_templates;
begin
  if not public.is_app_admin() then
    raise exception using errcode = 'P0001', message = 'SITE_TEMPLATE_FORBIDDEN: app admin access required';
  end if;

  update public.managed_site_templates
  set status = 'archived', updated_at = now()
  where id = p_template_id
  returning * into v_template;

  if not found then
    raise exception using errcode = 'P0001', message = 'SITE_TEMPLATE_NOT_FOUND: template does not exist';
  end if;

  v_actor := auth.email();
  insert into public.opps_activity_events (tenant_id, actor_email, actor_name, event_type, entity_type, entity_id, summary, metadata)
  values (
    null, v_actor, v_actor, 'managed_site_template_archived', 'managed_site_template', v_template.id,
    'Archived site template "' || v_template.name || '"', '{}'::jsonb
  );

  return to_jsonb(v_template);
end;
$$;

revoke all on function public.admin_archive_managed_site_template(uuid) from public;
revoke all on function public.admin_archive_managed_site_template(uuid) from anon;
grant execute on function public.admin_archive_managed_site_template(uuid) to authenticated;

-- =====================================================================
-- PART B / K — Site build RPCs. APP ADMIN ONLY. The browser supplies
-- only p_tenant_id (never client_id/workspace_id directly) - both are
-- resolved and verified server-side by
-- public._resolve_active_managed_workspace.
-- =====================================================================

create function public.admin_get_managed_site_build(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_client_id uuid;
  v_workspace_id uuid;
  v_build public.managed_site_builds;
  v_workspace public.managed_client_workspaces;
  v_tenant public.tenants;
  v_client public.clients;
  v_template_row public.managed_site_templates;
  v_template jsonb;
  v_latest_brief_row public.managed_site_build_briefs;
  v_latest_brief jsonb;
  v_readiness jsonb;
  v_current_fingerprint text;
  v_brief_stale boolean;
begin
  if not public.is_app_admin() then
    raise exception using errcode = 'P0001', message = 'SITE_BUILD_FORBIDDEN: app admin access required';
  end if;

  select * into v_client_id, v_workspace_id from public._resolve_active_managed_workspace(p_tenant_id);
  select * into v_workspace from public.managed_client_workspaces where id = v_workspace_id;

  select * into v_build from public.managed_site_builds where workspace_id = v_workspace_id and status <> 'archived';
  if not found then
    return jsonb_build_object('workspace_id', v_workspace_id, 'client_id', v_client_id, 'build', null);
  end if;

  select * into v_tenant from public.tenants where id = v_build.tenant_id;
  select * into v_client from public.clients where id = v_build.client_id;

  if v_build.template_id is not null then
    select * into v_template_row from public.managed_site_templates where id = v_build.template_id;
    v_template := jsonb_build_object(
      'id', v_template_row.id, 'template_key', v_template_row.template_key, 'name', v_template_row.name, 'status', v_template_row.status,
      'supported_site_types', to_jsonb(v_template_row.supported_site_types), 'repository_url', v_template_row.repository_url,
      'preview_url', v_template_row.preview_url, 'framework', v_template_row.framework, 'build_instructions', v_template_row.build_instructions
    );
  end if;

  select * into v_latest_brief_row from public.managed_site_build_briefs where site_build_id = v_build.id order by version desc limit 1;

  -- Staleness (Part D): recompute the CURRENT fingerprint via the same
  -- shared helper admin_generate_managed_site_build_brief itself uses -
  -- never a second, independently-maintained comparison - and compare
  -- against the fingerprint actually stored on the latest generated
  -- version. No new brief version is written here; this is read-only.
  if found then
    v_current_fingerprint := md5(public._compute_managed_site_build_snapshot(v_build, v_workspace, v_tenant, v_client, v_template_row)::text);
    v_brief_stale := v_current_fingerprint is distinct from v_latest_brief_row.source_fingerprint;
    v_latest_brief := jsonb_build_object(
      'id', v_latest_brief_row.id, 'version', v_latest_brief_row.version, 'generated_at', v_latest_brief_row.generated_at,
      'generated_by', v_latest_brief_row.generated_by, 'source_fingerprint', v_latest_brief_row.source_fingerprint
    );
  end if;

  v_readiness := public._managed_site_build_readiness(
    v_build.build_mode, v_build.template_id, v_build.primary_goal, v_build.brand_summary, v_build.required_pages, v_build.required_features,
    v_workspace.site_type, v_workspace.assets_status, v_workspace.content_status
  );

  return jsonb_build_object(
    'workspace_id', v_workspace_id,
    'client_id', v_client_id,
    'build', to_jsonb(v_build) || jsonb_build_object(
      'template', v_template, 'latest_brief', v_latest_brief, 'readiness', v_readiness, 'brief_stale', v_brief_stale
    )
  );
end;
$$;

revoke all on function public.admin_get_managed_site_build(uuid) from public;
revoke all on function public.admin_get_managed_site_build(uuid) from anon;
grant execute on function public.admin_get_managed_site_build(uuid) to authenticated;

create function public.admin_upsert_managed_site_build(p_tenant_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_actor text;
  v_client_id uuid;
  v_workspace_id uuid;
  v_workspace_site_type text;
  v_template_status text;
  v_template_site_types text[];
  v_existing public.managed_site_builds;
  v_is_new boolean;
  v_next_build_mode text;
  v_next_template_id uuid;
  v_build public.managed_site_builds;
begin
  if not public.is_app_admin() then
    raise exception using errcode = 'P0001', message = 'SITE_BUILD_FORBIDDEN: app admin access required';
  end if;

  perform public._validate_site_build_input_keys(p_input);

  select * into v_client_id, v_workspace_id from public._resolve_active_managed_workspace(p_tenant_id);
  select site_type into v_workspace_site_type from public.managed_client_workspaces where id = v_workspace_id;

  select * into v_existing from public.managed_site_builds where workspace_id = v_workspace_id and status <> 'archived';
  v_is_new := not found;

  -- ---- Resolve the EFFECTIVE build_mode/template_id together (post-
  -- review, item 3) - "custom" always wins over any supplied template_id
  -- (normalized, not rejected: selecting build_mode=custom silently
  -- clears template_id server-side, matching "if operator changes from
  -- template -> custom: clear template_id server-side"), and explicitly
  -- selecting a real template always forces build_mode back to
  -- "template" (matching "if operator selects a template: set/require
  -- build_mode = template"). ----
  v_next_build_mode := case when p_input ? 'build_mode' then coalesce(nullif(p_input ->> 'build_mode', ''), 'template') else coalesce(v_existing.build_mode, 'template') end;
  v_next_template_id := case when p_input ? 'template_id' then nullif(p_input ->> 'template_id', '')::uuid else v_existing.template_id end;

  if (p_input ? 'template_id') and v_next_template_id is not null then
    v_next_build_mode := 'template';
  end if;
  if v_next_build_mode = 'custom' then
    v_next_template_id := null;
  end if;

  if v_next_template_id is not null then
    select status, supported_site_types into v_template_status, v_template_site_types
    from public.managed_site_templates where id = v_next_template_id;
    if v_template_status is null or v_template_status <> 'active' then
      raise exception using errcode = 'P0001', message = 'SITE_BUILD_TEMPLATE_INVALID: template does not exist or is not active';
    end if;
    -- Site-type compatibility: only enforced when both sides have a
    -- value to compare - a template with an empty supported_site_types
    -- array is treated as "not yet scoped to specific site types" and
    -- is never rejected on this basis alone.
    if v_workspace_site_type is not null
       and coalesce(array_length(v_template_site_types, 1), 0) > 0
       and not (v_workspace_site_type = any(v_template_site_types))
    then
      raise exception using errcode = 'P0001', message = format('SITE_BUILD_TEMPLATE_SITE_TYPE_MISMATCH: template does not support site type "%s"', v_workspace_site_type);
    end if;
  end if;

  v_actor := auth.email();

  if v_is_new then
    insert into public.managed_site_builds (
      tenant_id, client_id, workspace_id, template_id, build_mode, primary_goal, brand_summary, target_audience,
      visual_direction, tone_of_voice, required_pages, required_features, integrations, reference_urls,
      content_notes, product_notes, technical_notes, deployment_notes
    ) values (
      p_tenant_id, v_client_id, v_workspace_id, v_next_template_id, v_next_build_mode,
      p_input ->> 'primary_goal', p_input ->> 'brand_summary', p_input ->> 'target_audience',
      p_input ->> 'visual_direction', p_input ->> 'tone_of_voice',
      coalesce(p_input -> 'required_pages', '[]'::jsonb), coalesce(p_input -> 'required_features', '[]'::jsonb),
      coalesce(p_input -> 'integrations', '[]'::jsonb), coalesce(p_input -> 'reference_urls', '[]'::jsonb),
      p_input ->> 'content_notes', p_input ->> 'product_notes', p_input ->> 'technical_notes', p_input ->> 'deployment_notes'
    )
    returning * into v_build;

    insert into public.opps_activity_events (tenant_id, actor_email, actor_name, event_type, entity_type, entity_id, summary, metadata)
    values (p_tenant_id, v_actor, v_actor, 'managed_site_build_created', 'managed_site_build', v_build.id, 'Created site build for tenant ' || p_tenant_id::text, '{}'::jsonb);
  else
    update public.managed_site_builds set
      template_id = v_next_template_id,
      build_mode = v_next_build_mode,
      primary_goal = case when p_input ? 'primary_goal' then p_input ->> 'primary_goal' else primary_goal end,
      brand_summary = case when p_input ? 'brand_summary' then p_input ->> 'brand_summary' else brand_summary end,
      target_audience = case when p_input ? 'target_audience' then p_input ->> 'target_audience' else target_audience end,
      visual_direction = case when p_input ? 'visual_direction' then p_input ->> 'visual_direction' else visual_direction end,
      tone_of_voice = case when p_input ? 'tone_of_voice' then p_input ->> 'tone_of_voice' else tone_of_voice end,
      required_pages = case when p_input ? 'required_pages' then coalesce(p_input -> 'required_pages', '[]'::jsonb) else required_pages end,
      required_features = case when p_input ? 'required_features' then coalesce(p_input -> 'required_features', '[]'::jsonb) else required_features end,
      integrations = case when p_input ? 'integrations' then coalesce(p_input -> 'integrations', '[]'::jsonb) else integrations end,
      reference_urls = case when p_input ? 'reference_urls' then coalesce(p_input -> 'reference_urls', '[]'::jsonb) else reference_urls end,
      content_notes = case when p_input ? 'content_notes' then p_input ->> 'content_notes' else content_notes end,
      product_notes = case when p_input ? 'product_notes' then p_input ->> 'product_notes' else product_notes end,
      technical_notes = case when p_input ? 'technical_notes' then p_input ->> 'technical_notes' else technical_notes end,
      deployment_notes = case when p_input ? 'deployment_notes' then p_input ->> 'deployment_notes' else deployment_notes end,
      updated_at = now()
    where id = v_existing.id
    returning * into v_build;

    insert into public.opps_activity_events (tenant_id, actor_email, actor_name, event_type, entity_type, entity_id, summary, metadata)
    values (
      p_tenant_id, v_actor, v_actor, 'managed_site_build_updated', 'managed_site_build', v_build.id,
      'Updated site build configuration for tenant ' || p_tenant_id::text,
      jsonb_build_object('updated_keys', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(coalesce(p_input, '{}'::jsonb)) k))
    );
  end if;

  return to_jsonb(v_build);
end;
$$;

revoke all on function public.admin_upsert_managed_site_build(uuid, jsonb) from public;
revoke all on function public.admin_upsert_managed_site_build(uuid, jsonb) from anon;
grant execute on function public.admin_upsert_managed_site_build(uuid, jsonb) to authenticated;

-- =====================================================================
-- PART C/D/E — Build brief RPCs. APP ADMIN ONLY. The browser supplies
-- only p_site_build_id - tenant/client/workspace/template are all
-- resolved from the build row itself (immutable FKs) and re-verified
-- for internal agreement before generating anything.
-- =====================================================================

create function public.admin_generate_managed_site_build_brief(p_site_build_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_actor text;
  v_build public.managed_site_builds;
  v_workspace public.managed_client_workspaces;
  v_tenant public.tenants;
  v_client public.clients;
  v_template public.managed_site_templates;
  v_readiness jsonb;
  v_products jsonb;
  v_products_enabled boolean;
  v_snapshot jsonb;
  v_fingerprint text;
  v_next_version int;
  v_brief text;
  v_pages_lines text;
  v_features_lines text;
  v_integrations_lines text;
  v_refs_lines text;
  v_missing_lines text;
  v_products_section text;
  v_acceptance_lines text;
  v_brief_row public.managed_site_build_briefs;
begin
  if not public.is_app_admin() then
    raise exception using errcode = 'P0001', message = 'SITE_BUILD_FORBIDDEN: app admin access required';
  end if;

  -- Post-review (item 6): FOR UPDATE serializes two concurrent
  -- generations for the SAME build (so `max(version) + 1` below can
  -- never race and collide against the unique(site_build_id, version)
  -- constraint), and also serializes generation against a concurrent
  -- admin_upsert_managed_site_build UPDATE on this same row - a plain
  -- UPDATE from another transaction needs the same row lock and will
  -- simply wait until this transaction commits/rolls back. Deliberately
  -- scoped to this one row, not a broad/global lock.
  select * into v_build from public.managed_site_builds where id = p_site_build_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'SITE_BUILD_NOT_FOUND: site build does not exist';
  end if;

  select * into v_tenant from public.tenants where id = v_build.tenant_id;
  select * into v_client from public.clients where id = v_build.client_id;
  select * into v_workspace from public.managed_client_workspaces where id = v_build.workspace_id;

  -- Defensive re-verification: the build's own stored identities must
  -- still agree with each other server-side - p_site_build_id is the
  -- only input this RPC accepts.
  if v_tenant.id is null or v_client.id is null or v_workspace.id is null
     or v_client.tenant_id is distinct from v_build.tenant_id
     or v_workspace.tenant_id is distinct from v_build.tenant_id
     or v_workspace.client_id is distinct from v_build.client_id
  then
    raise exception using errcode = 'P0001', message = 'SITE_BUILD_IDENTITY_MISMATCH: tenant/client/workspace identity no longer agrees';
  end if;

  if v_build.template_id is not null then
    select * into v_template from public.managed_site_templates where id = v_build.template_id;
  end if;

  v_readiness := public._managed_site_build_readiness(
    v_build.build_mode, v_build.template_id, v_build.primary_goal, v_build.brand_summary, v_build.required_pages, v_build.required_features,
    v_workspace.site_type, v_workspace.assets_status, v_workspace.content_status
  );
  if v_readiness ->> 'state' = 'blocked' then
    raise exception using errcode = 'P0001', message = 'SITE_BUILD_BLOCKED: ' || coalesce((select string_agg(x, '; ') from jsonb_array_elements_text(v_readiness -> 'missing_inputs') x), 'structural error');
  end if;

  -- ---- Snapshot + fingerprint via the SAME shared helper
  -- admin_get_managed_site_build uses to detect staleness (Part D) - one
  -- source of truth, so "is this brief stale" and "what does a fresh
  -- generation actually capture" can never drift apart. ----
  v_snapshot := public._compute_managed_site_build_snapshot(v_build, v_workspace, v_tenant, v_client, v_template);
  v_fingerprint := md5(v_snapshot::text);
  v_products_enabled := coalesce((v_snapshot ->> 'products_capability_enabled')::boolean, false);
  v_products := v_snapshot -> 'commerce_products';

  select coalesce(max(version), 0) + 1 into v_next_version from public.managed_site_build_briefs where site_build_id = v_build.id;

  v_actor := auth.email();

  -- ---- Compose the repeatable list sections ----
  v_pages_lines := coalesce((select string_agg('- ' || x, chr(10)) from jsonb_array_elements_text(coalesce(v_build.required_pages, '[]'::jsonb)) x), '(none selected)');
  v_features_lines := coalesce((select string_agg('- ' || x, chr(10)) from jsonb_array_elements_text(coalesce(v_build.required_features, '[]'::jsonb)) x), '(none selected)');
  v_integrations_lines := coalesce((select string_agg('- ' || x, chr(10)) from jsonb_array_elements_text(coalesce(v_build.integrations, '[]'::jsonb)) x), '(none configured)');
  v_refs_lines := coalesce((select string_agg('- ' || x, chr(10)) from jsonb_array_elements_text(coalesce(v_build.reference_urls, '[]'::jsonb)) x), '(none provided)');
  v_missing_lines := coalesce((select string_agg('- ' || x, chr(10)) from jsonb_array_elements_text(coalesce(v_readiness -> 'missing_inputs', '[]'::jsonb)) x), '(none - all tracked inputs present)');

  if coalesce(jsonb_array_length(v_products), 0) > 0 then
    select string_agg(
      format(
        '- %s | %s | price: %s%s | availability: %s | image: %s',
        p ->> 'name',
        coalesce(p ->> 'description', '(no description)'),
        coalesce(p ->> 'currency', '') || ' ' || coalesce(p ->> 'price', '(not set)'),
        case when p ->> 'sale_price' is not null then ' (sale: ' || coalesce(p ->> 'currency', '') || ' ' || (p ->> 'sale_price') || ')' else '' end,
        coalesce(p ->> 'availability', '(unknown)'),
        coalesce(p ->> 'primary_image_url', '(none)')
      ),
      chr(10)
    )
    into v_products_section
    from jsonb_array_elements(v_products) p;
  else
    v_products_section := case
      when v_products_enabled then '(Products capability is enabled but no active Commerce products exist yet.)'
      else '(Products capability is not enabled for this tenant - use configured product/service notes instead.)'
    end;
  end if;

  select coalesce(string_agg('- ' || x, chr(10)), '(no acceptance criteria could be derived - configure required pages/features/integrations first)')
  into v_acceptance_lines
  from (
    select 'Page "' || p || '" exists and is reachable.' as x from jsonb_array_elements_text(coalesce(v_build.required_pages, '[]'::jsonb)) p
    union all
    select 'Feature "' || f || '" is implemented and functional.' from jsonb_array_elements_text(coalesce(v_build.required_features, '[]'::jsonb)) f
    union all
    select 'Integration "' || i || '" is wired up and functional.' from jsonb_array_elements_text(coalesce(v_build.integrations, '[]'::jsonb)) i
    union all
    select 'Site renders correctly on mobile, tablet, and desktop viewports.'
  ) acceptance;

  -- ---- Compose the brief (Part E's 13-section format) ----
  v_brief :=
    '# Managed Site Build Brief' || chr(10) || chr(10) ||
    '## 1. Project Identity' || chr(10) || chr(10) ||
    'Brand: ' || coalesce(v_snapshot ->> 'brand_name', 'Not configured') || chr(10) ||
    'Tenant slug: ' || coalesce(v_tenant.slug, 'Not configured') || chr(10) ||
    'Client type: ' || coalesce(v_workspace.client_type, 'Not configured') || chr(10) ||
    'Site type: ' || coalesce(v_workspace.site_type, 'Not configured') || chr(10) ||
    'Build ID: ' || v_build.id::text || chr(10) ||
    'Build mode: ' || case when v_build.build_mode = 'custom' then 'Custom' else 'Template' end || chr(10) ||
    'Template: ' || coalesce(v_template.name, case when v_build.build_mode = 'custom' then 'None (explicit custom build)' else 'Not selected' end) || chr(10) ||
    'Template reference: ' || coalesce(v_template.repository_url, v_template.template_key, 'Not configured') || chr(10) || chr(10) ||

    '## 2. Objective' || chr(10) || chr(10) ||
    'Primary goal: ' || coalesce(v_build.primary_goal, 'Not set') || chr(10) ||
    'Audience: ' || coalesce(v_build.target_audience, 'Not set') || chr(10) || chr(10) ||

    '## 3. Brand Direction' || chr(10) || chr(10) ||
    'Brand summary: ' || coalesce(v_build.brand_summary, 'Not set') || chr(10) ||
    'Visual direction: ' || coalesce(v_build.visual_direction, 'Not set') || chr(10) ||
    'Tone of voice: ' || coalesce(v_build.tone_of_voice, 'Not set') || chr(10) ||
    'Reference URLs:' || chr(10) || v_refs_lines || chr(10) || chr(10) ||

    '## 4. Template' || chr(10) || chr(10) ||
    'Selected template: ' || coalesce(v_template.name, 'None - custom build') || chr(10) ||
    'Repository/template source: ' || coalesce(v_template.repository_url, 'Not configured') || chr(10) ||
    'Supported site type(s): ' || coalesce(array_to_string(v_template.supported_site_types, ', '), 'N/A') || chr(10) ||
    'Template-specific instructions: ' || coalesce(v_template.build_instructions, 'None provided') || chr(10) || chr(10) ||

    '## 5. Required Pages' || chr(10) || chr(10) || v_pages_lines || chr(10) || chr(10) ||

    '## 6. Required Features' || chr(10) || chr(10) || v_features_lines || chr(10) || chr(10) ||

    '## 7. Products / Services' || chr(10) || chr(10) || v_products_section || chr(10) || chr(10) ||
    'Product/service notes: ' || coalesce(v_build.product_notes, 'None provided') || chr(10) || chr(10) ||

    '## 8. Content / Assets Readiness' || chr(10) || chr(10) ||
    'Assets status: ' || coalesce(v_workspace.assets_status, 'Not configured') || chr(10) ||
    'Content status: ' || coalesce(v_workspace.content_status, 'Not configured') || chr(10) ||
    'Products/services status: ' || coalesce(v_workspace.products_services_status, 'Not configured') || chr(10) ||
    'Pricing status: ' || coalesce(v_workspace.pricing_status, 'Not configured') || chr(10) ||
    'Mockup status: ' || coalesce(v_workspace.mockup_status, 'Not configured') || chr(10) ||
    'Content notes: ' || coalesce(v_build.content_notes, 'None provided') || chr(10) || chr(10) ||

    '## 9. Integrations' || chr(10) || chr(10) || v_integrations_lines || chr(10) || chr(10) ||

    '## 10. Technical / Architecture Rules' || chr(10) || chr(10) ||
    '- Strict tenant isolation - this site serves exactly one managed brand tenant.' || chr(10) ||
    '- Never expose internal OPPS/Joint X operational data to the public site.' || chr(10) ||
    '- Derive server-side tenant context from the request hostname per the existing Joint X/XOS multi-tenant contract - never trust a client-supplied tenant identifier.' || chr(10) ||
    '- Respect existing private-asset access rules - never make a private/internal asset publicly reachable.' || chr(10) ||
    '- Must be fully responsive on mobile.' || chr(10) ||
    '- Meet reasonable performance and accessibility expectations (fast initial load, semantic HTML, keyboard/screen-reader accessible).' || chr(10) ||
    'Technical notes: ' || coalesce(v_build.technical_notes, 'None provided') || chr(10) || chr(10) ||

    '## 11. Infrastructure' || chr(10) || chr(10) ||
    'Repository URL: ' || coalesce(v_workspace.site_repo_url, 'Not configured') || chr(10) ||
    'Preview URL: ' || coalesce(v_workspace.preview_url, 'Not configured') || chr(10) ||
    'Live URL: ' || coalesce(v_workspace.live_url, 'Not configured') || chr(10) ||
    'Domain name: ' || coalesce(v_workspace.domain_name, 'Not configured') || chr(10) ||
    'Deployment notes: ' || coalesce(v_build.deployment_notes, 'None provided') || chr(10) || chr(10) ||

    '## 12. Acceptance Criteria' || chr(10) || chr(10) || v_acceptance_lines || chr(10) || chr(10) ||

    '## 13. Missing Inputs' || chr(10) || chr(10) || v_missing_lines || chr(10);

  insert into public.managed_site_build_briefs (
    site_build_id, version, source_fingerprint, source_snapshot, brief_text, generated_at, generated_by
  ) values (
    v_build.id, v_next_version, v_fingerprint, v_snapshot, v_brief, now(), v_actor
  )
  returning * into v_brief_row;

  -- Only draft -> brief_ready, and only on this table's own narrower
  -- status track. managed_client_workspaces.onboarding_stage is never
  -- touched here (see header note).
  if v_build.status = 'draft' then
    update public.managed_site_builds set status = 'brief_ready', updated_at = now() where id = v_build.id;
  end if;

  insert into public.opps_activity_events (tenant_id, actor_email, actor_name, event_type, entity_type, entity_id, summary, metadata)
  values (
    v_build.tenant_id, v_actor, v_actor, 'managed_site_build_brief_generated', 'managed_site_build_brief', v_brief_row.id,
    'Generated build brief v' || v_next_version || ' for site build ' || v_build.id::text,
    jsonb_build_object('site_build_id', v_build.id, 'version', v_next_version, 'source_fingerprint', v_fingerprint)
  );

  return to_jsonb(v_brief_row);
end;
$$;

revoke all on function public.admin_generate_managed_site_build_brief(uuid) from public;
revoke all on function public.admin_generate_managed_site_build_brief(uuid) from anon;
grant execute on function public.admin_generate_managed_site_build_brief(uuid) to authenticated;

create function public.admin_get_managed_site_build_briefs(p_site_build_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_result jsonb;
begin
  if not public.is_app_admin() then
    raise exception using errcode = 'P0001', message = 'SITE_BUILD_FORBIDDEN: app admin access required';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'version', b.version, 'generated_at', b.generated_at, 'generated_by', b.generated_by,
    'source_fingerprint', b.source_fingerprint, 'brief_text', b.brief_text
  ) order by b.version desc), '[]'::jsonb)
  into v_result
  from public.managed_site_build_briefs b
  where b.site_build_id = p_site_build_id;

  return v_result;
end;
$$;

revoke all on function public.admin_get_managed_site_build_briefs(uuid) from public;
revoke all on function public.admin_get_managed_site_build_briefs(uuid) from anon;
grant execute on function public.admin_get_managed_site_build_briefs(uuid) to authenticated;

-- =====================================================================
-- Post-apply verification (run manually, not part of this script):
--   select has_function_privilege('anon', 'public.admin_generate_managed_site_build_brief(uuid)', 'EXECUTE'); -- expect false
--   select count(*) from public.managed_site_templates; -- expect 0 (registry starts empty)
--   select count(*) from public.managed_site_builds; -- expect 0
-- =====================================================================
