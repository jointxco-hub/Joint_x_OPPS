-- XOS 2.5 - Decision 3: reusable tenant onboarding/provisioning template.
--
-- This is a TEMPLATE, not a migration. Do not put this file in
-- supabase/migrations/ and do not run it against production without an
-- operator reading and filling in every value in the CONFIGURE block
-- below, and without having already read
-- docs/XOS_2_5_ONBOARDING_RUNBOOK.md (temporary email invariant, what
-- this script can and cannot verify, the manual Vercel domain step).
--
-- Usage: copy this file per onboarding (e.g. xos_provision_gsb.sql), fill
-- in CONFIGURE, run once via `supabase db query --linked --file <copy>.sql`
-- or psql. Everything below runs inside one transaction: any failed
-- precondition raises an exception, which aborts the whole transaction -
-- nothing is left half-provisioned. If every check inside the DO block
-- passes, the explicit COMMIT at the bottom applies it.
--
-- What this script verifies (can be checked without a live session):
--   tenant active, client linked to the right tenant, xos_admin domain
--   active, owner membership active, owner auth email matches the
--   canonical client email exactly.
-- What this script CANNOT verify (needs a real authenticated browser
-- session - see the runbook's Activation Checklist for how to do these
-- by hand after this script commits):
--   resolve_xos_admin_gate() returning allowed=true for the owner,
--   Orders/Requests/Files RPCs actually returning data,
--   a real request submission appearing on the OPPS side.

begin;

do $$
declare
  -- ============ CONFIGURE (fill in before running) ============
  v_workspace_name     text := 'REPLACE_ME workspace display name';
  v_tenant_slug        text := 'replace-me-slug';
  v_hostname           text := 'replace-me.xos.jointx.co.za';
  v_client_email       text := 'replace-me@example.com';
  v_client_name        text := 'REPLACE_ME client contact name';
  v_owner_auth_user_id uuid := null; -- must already exist in auth.users; create the Supabase Auth account first
  v_owner_role         text := 'owner';
  v_order_prefix       text := null; -- REQUIRED: 2-8 uppercase letters/numbers, e.g. GSB, KM, BARBZ
  -- ==============================================================

  v_tenant_id uuid;
  v_client_id uuid;
  v_owner_email text;
  v_check_ok boolean;
begin
  -- ---- Pre-flight: fail loudly on any conflict, never duplicate silently ----
  if v_owner_auth_user_id is null then
    raise exception 'v_owner_auth_user_id is required - create/confirm the Supabase Auth account for the owner first, then set this value.';
  end if;

  v_order_prefix := upper(trim(coalesce(v_order_prefix, '')));
  if v_order_prefix !~ '^[A-Z0-9]{2,8}$' then
    raise exception 'v_order_prefix must contain 2-8 uppercase letters/numbers (received "%").', v_order_prefix;
  end if;

  if exists (select 1 from public.tenants where slug = v_tenant_slug) then
    raise exception 'Tenant slug "%" already exists.', v_tenant_slug;
  end if;

  if exists (select 1 from public.tenant_domains where hostname = v_hostname) then
    raise exception 'Hostname "%" is already registered to a tenant.', v_hostname;
  end if;

  if exists (select 1 from public.clients where lower(email) = lower(v_client_email)) then
    raise exception 'A clients row with email "%" already exists - this workflow only creates a brand-new client tied to a brand-new tenant, it does not relink an existing client.', v_client_email;
  end if;

  select email into v_owner_email from auth.users where id = v_owner_auth_user_id;
  if v_owner_email is null then
    raise exception 'No auth.users row found for id %.', v_owner_auth_user_id;
  end if;

  -- ---- Temporary identity invariant (see runbook: this is not the long-term design) ----
  if lower(trim(v_owner_email)) <> lower(trim(v_client_email)) then
    raise exception 'Owner auth email (%) must match the canonical client email (%) exactly, case-insensitively. Requests submitted from XOS are matched to a clients row by this email; a mismatch makes those requests invisible to OPPS staff (this is exactly the defect fixed in 20260818090001_xos_request_visibility_tenant_scope.sql, now closed off at the source for new tenants).', v_owner_email, v_client_email;
  end if;

  -- ---- Provision, in dependency order ----
  insert into public.tenants (slug, name, status, settings)
  values (
    v_tenant_slug,
    v_workspace_name,
    'active',
    jsonb_build_object('order_prefix', v_order_prefix)
  )
  returning id into v_tenant_id;

  insert into public.clients (tenant_id, name, email, status)
  values (v_tenant_id, v_client_name, v_client_email, 'active')
  returning id into v_client_id;

  insert into public.tenant_domains (tenant_id, hostname, surface, status, is_primary)
  values (v_tenant_id, v_hostname, 'xos_admin', 'active', true);

  insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role, status)
  values (v_tenant_id, v_owner_auth_user_id, v_owner_role, 'active');

  -- ---- Post-insert activation checks (DB-verifiable subset only) ----
  select
    t.status = 'active'
    and exists (select 1 from public.clients c where c.id = v_client_id and c.tenant_id = v_tenant_id)
    and exists (select 1 from public.tenant_domains d where d.tenant_id = v_tenant_id and d.hostname = v_hostname and d.surface = 'xos_admin' and d.status = 'active')
    and exists (select 1 from public.tenant_memberships m where m.tenant_id = v_tenant_id and m.auth_user_id = v_owner_auth_user_id and m.status = 'active')
  into v_check_ok
  from public.tenants t
  where t.id = v_tenant_id;

  if not v_check_ok then
    raise exception 'Post-insert activation check failed - rolling back. Nothing was left half-provisioned.';
  end if;

  raise notice 'Provisioned tenant "%" (id %), client "%" (id %), domain %, owner membership for % (role %). DB-verifiable checks passed. Remaining checks (gate/RPCs/OPPS handoff) require a live login - see the runbook Activation Checklist.',
    v_tenant_slug, v_tenant_id, v_client_name, v_client_id, v_hostname, v_owner_email, v_owner_role;
end $$;

-- Reached only if every check above passed (an exception anywhere above
-- aborts the transaction before this line is reached).
commit;
