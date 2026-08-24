-- Managed Clients Control Plane — Phase 2 hotfix: preflight blocker
-- array concatenation bug.
--
-- Production migration 20260824090000_managed_clients_phase2_operations.sql
-- is now LIVE and is treated as immutable production history - this file
-- does not touch it. This is a NEW, strictly additive migration that
-- CREATE OR REPLACEs exactly one function:
-- public.admin_preview_managed_brand_provisioning(jsonb).
--
-- Runtime bug (found by supabase/tests/managed_clients_phase2_operations.sql
-- against live production): `v_blockers text[] := '{}';` followed by
-- `v_blockers := v_blockers || '<plain string literal>';` raised
-- `22P02: malformed array literal` on every blocker-producing branch (a
-- successful, zero-blocker preflight never hit this code path, which is
-- why it wasn't caught until the SQL suite exercised the rejection
-- paths). Root cause: `anyarray || anyelement` and `anyarray || anyarray`
-- are both valid overloads of `||`, and an untyped ("unknown") string
-- literal on the right-hand side is ambiguous between "cast to the
-- array's element type (text) and append" and "cast to the array type
-- itself (text[]) and concatenate" - PostgreSQL's operator resolution
-- picked the latter for these plain-English sentences, then failed to
-- parse them as array-literal syntax. `array_append(anyarray,
-- anyelement)` has only one signature, so there is no ambiguity to
-- resolve incorrectly - every blocker addition below now uses it.
--
-- Everything else - signature, SECURITY DEFINER, STABLE, fixed
-- search_path, the is_app_admin() gate, output schema, hostname
-- derivation, owner lookup, and every validation rule - is byte-for-byte
-- unchanged from the live function; only the six `v_blockers := v_blockers
-- || ...` lines become `v_blockers := array_append(v_blockers, ...)`.
-- Wording is unchanged.

create or replace function public.admin_preview_managed_brand_provisioning(p_input jsonb)
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

  -- Hotfix: array_append(anyarray, anyelement) instead of `v_blockers ||
  -- '<plain string>'` - see header note for why the operator form was
  -- ambiguous and raised 22P02 in production.
  if v_workspace_name is null then
    v_blockers := array_append(v_blockers, 'Workspace/brand display name is required.');
  end if;
  if v_client_name is null then
    v_blockers := array_append(v_blockers, 'Client/contact name is required.');
  end if;
  if not v_slug_valid then
    v_blockers := array_append(v_blockers, 'Tenant slug is invalid or reserved.');
  elsif not v_slug_available then
    v_blockers := array_append(v_blockers, format('Tenant slug "%s" is already in use.', v_slug));
  end if;
  if v_hostname is not null and not v_hostname_available then
    v_blockers := array_append(v_blockers, format('Hostname "%s" is already registered.', v_hostname));
  end if;
  if not v_client_email_valid then
    v_blockers := array_append(v_blockers, 'Canonical client/owner email is not a valid email address.');
  else
    if not v_client_email_available then
      v_blockers := array_append(v_blockers, 'A clients row with this email already exists.');
    end if;
    if not v_owner_account_exists then
      v_blockers := array_append(v_blockers, 'The owner must sign in/create their XOS account with this exact email before the workspace can be provisioned.');
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
-- Post-apply verification (run manually, not part of this script):
--   select has_function_privilege('anon', 'public.admin_preview_managed_brand_provisioning(jsonb)', 'EXECUTE'); -- expect false
--   select public.admin_preview_managed_brand_provisioning(jsonb_build_object('workspace_name', null, 'tenant_slug', null, 'client_email', null, 'client_name', null)); -- expect a populated blockers array, no 22P02
-- =====================================================================
