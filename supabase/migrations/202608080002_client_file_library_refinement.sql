-- Phase 1A.1: client-first File Manager hierarchy.
--
-- Phase 1A (202608080001) provisioned "<Client Root>/Orders/<order_number>
-- /<category>" — technically correct but poor UX as clients accumulate many
-- orders, and it created one canonical ClientAsset per (order, file), so the
-- same physical file re-linked to a second order became a second row.
--
-- This migration moves the canonical structure to:
--   All Files -> Clients -> <Client> -> <category>
-- Orders are no longer physical folders — order_number becomes metadata for
-- filtering (orders.file_urls), not a folder path segment. One client_assets
-- row now exists per (client_id, file_url), reusable across every order that
-- references the same file_url.
--
-- Fully additive/compatible:
--   - 202608080001 is NOT edited. Its RPCs (get_or_create_client_asset_folder,
--     get_or_create_order_asset_folder, provision_order_asset_folders) keep
--     their exact signatures — the currently deployed frontend may call them
--     during deploy sequencing — only their internal bodies change here via
--     create or replace.
--   - idx_client_assets_order_file_url_unique (order_id, file_url) is kept,
--     not dropped, for backward compatibility with any row that still has it
--     as its only identity signal.
--   - idx_folders_client_root_unique (client_id) where parent_id is null is
--     kept, not dropped — it is exactly what protects the two existing
--     legacy Phase 1A client roots (Mahlali Jebese, x) until the separate,
--     manual, non-automatic supabase/backfills/client_file_library_restructure.sql
--     moves them under Clients. This migration does not touch a single
--     existing folders/client_assets row.
--   - get_or_create_clients_root() also reuses, read-only, a pre-existing
--     manually-created "Clients" folder at true File Manager root
--     (parent_id is null, client_id is null, name = 'Clients', not
--     archived, folder_kind still null because it predates this
--     migration) instead of creating a competing second one — this covers
--     the case where staff already built a Clients folder by hand before
--     Phase 1A.1 shipped. Exactly one such candidate is required to
--     auto-reuse; more than one raises FOLDER_CLIENTS_ROOT_AMBIGUOUS
--     rather than guessing. The row itself is never written to by this
--     function — read-only reuse only, same as the client-root case above.
--   - The email-keyed client_file_folders/client_file_links system is
--     untouched.
--
-- Rollback:
--   drop function if exists public.provision_order_asset_folders(uuid);
--   drop function if exists public.get_or_create_order_asset_folder(uuid, text);
--   drop function if exists public.get_or_create_client_asset_folder(uuid, text, text);
--   drop function if exists public.get_or_create_clients_root(uuid);
--   -- (restore each function's Phase 1A body from 202608080001 if truly
--   -- rolling back — this migration only replaces their definitions)
--   drop index if exists public.idx_client_assets_client_file_url_unique;
--   drop index if exists public.idx_folders_clients_root_unique;
--   drop index if exists public.idx_folders_client_root_kind_unique;
--   alter table public.folders drop column if exists folder_kind;

begin;

-- ═══════════════════════════════════════════════════════════════════
-- 1. Canonical client asset uniqueness
-- ═══════════════════════════════════════════════════════════════════
-- One physical/client asset exists once per (client_id, file_url). Kept
-- alongside idx_client_assets_order_file_url_unique (not dropped) — a row
-- created before this migration only satisfies the order/file index; new
-- rows satisfy both, and the mirror helper's dedup-by-(client_id, file_url)
-- lookup (application-side) is backstopped by this constraint for the
-- concurrent-insert case.
create unique index if not exists idx_client_assets_client_file_url_unique
  on public.client_assets (client_id, file_url)
  where client_id is not null and file_url is not null;

-- ═══════════════════════════════════════════════════════════════════
-- 2. Folder kind
-- ═══════════════════════════════════════════════════════════════════
-- Nullable: every folder that predates this migration (legacy Phase 1A
-- client roots, "Orders" grouping folders, ORD-XXXXX folders, any unrelated
-- internal/Design Assets/X LAB Studio/Supply folder a staff member created
-- directly in File Manager) keeps folder_kind = null and is completely
-- unaffected. Only folders this migration's redefined RPCs create going
-- forward get a kind.
alter table public.folders
  add column if not exists folder_kind text;

-- At most one "Clients" grouping folder per tenant.
create unique index if not exists idx_folders_clients_root_unique
  on public.folders (tenant_id)
  where folder_kind = 'clients_root';

-- At most one NEW-style client root per client. Deliberately a separate,
-- additional index from idx_folders_client_root_unique (client_id where
-- parent_id is null) rather than a replacement — that index keeps
-- protecting legacy Phase 1A roots (parent_id is null, folder_kind is
-- null) exactly as before. A client can only ever have one of each kind
-- at a time in normal operation because get_or_create_client_asset_folder
-- (below) always checks for an existing root of EITHER kind before
-- creating a new one; these two indexes are the concurrency backstop for
-- each kind individually, not a cross-kind guarantee, which is fine here
-- since the manual restructure script is what ever consolidates the two.
create unique index if not exists idx_folders_client_root_kind_unique
  on public.folders (client_id)
  where folder_kind = 'client_root';

-- Category folders directly under a client root reuse the existing
-- idx_folders_client_subfolder_unique (parent_id, lower(name)) from
-- 202608080001 — already generic over any parent, so it already protects
-- "one category name per client root" and "one client display name per
-- Clients root" without a new index.

-- ═══════════════════════════════════════════════════════════════════
-- 3. Tenant-level Clients root
-- ═══════════════════════════════════════════════════════════════════
-- Narrow, idempotent, concurrency-safe get-or-create for "All Files ->
-- Clients" within one tenant. Tenant identity must already be resolved by
-- the caller (get_or_create_client_asset_folder resolves it from the
-- client row server-side) — this function only ever trusts
-- can_access_tenant(p_tenant_id) for the CURRENT authenticated user, it
-- never infers or accepts a foreign tenant. If multiple tenants exist,
-- each gets its own Clients root; no tenant UUID is ever hardcoded.
create or replace function public.get_or_create_clients_root(p_tenant_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_root_id uuid;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'FOLDER_AUTH_REQUIRED';
  end if;
  if p_tenant_id is null or not public.can_access_tenant(p_tenant_id) then
    raise exception using errcode = 'P0001', message = 'FOLDER_ACCESS_DENIED';
  end if;

  -- 1. Prefer an already-canonical root.
  select id into v_root_id
  from public.folders
  where tenant_id = p_tenant_id and folder_kind = 'clients_root'
  limit 1;

  -- 2. No canonical root yet — this migration ships into a tenant that may
  -- already have a manually-created "Clients" folder at true File Manager
  -- root (folder_kind is still null for every pre-1A.1 row, including one
  -- a staff member built by hand days before this migration ever ran).
  -- Reuse it rather than creating a silent duplicate. Exactly one
  -- compatible candidate is required — zero means create fresh, more than
  -- one is a genuine ambiguity this function refuses to guess through.
  if v_root_id is null then
    declare
      v_candidate_count int;
    begin
      select count(*) into v_candidate_count
      from public.folders
      where tenant_id = p_tenant_id
        and parent_id is null
        and client_id is null
        and lower(btrim(name)) = 'clients'
        and coalesce(is_archived, false) = false
        and coalesce(folder_kind, '') <> 'clients_root';

      if v_candidate_count > 1 then
        raise exception using errcode = 'P0001', message = 'FOLDER_CLIENTS_ROOT_AMBIGUOUS';
      elsif v_candidate_count = 1 then
        select id into v_root_id
        from public.folders
        where tenant_id = p_tenant_id
          and parent_id is null
          and client_id is null
          and lower(btrim(name)) = 'clients'
          and coalesce(is_archived, false) = false
          and coalesce(folder_kind, '') <> 'clients_root';
        -- Reused as-is: this function never writes to a legacy row it
        -- didn't create. It stays additive/read-only against existing
        -- production data; the separate, manual, non-automatic restructure
        -- script is the only thing that ever tags a reused legacy root
        -- with folder_kind = 'clients_root'.
      end if;
    end;
  end if;

  -- 3. Nothing to reuse — create a new canonical root.
  if v_root_id is null then
    begin
      insert into public.folders (name, parent_id, tenant_id, folder_kind, color, created_by)
      values ('Clients', null, p_tenant_id, 'clients_root', 'blue', v_user_id::text)
      returning id into v_root_id;
    exception when unique_violation then
      select id into v_root_id
      from public.folders
      where tenant_id = p_tenant_id and folder_kind = 'clients_root'
      limit 1;
    end;
  end if;

  return v_root_id;
end;
$$;

revoke all on function public.get_or_create_clients_root(uuid) from public, anon, service_role;
grant execute on function public.get_or_create_clients_root(uuid) to authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- 4. Redefine get_or_create_client_asset_folder — client-first semantics
-- ═══════════════════════════════════════════════════════════════════
-- Signature unchanged (p_client_id, p_client_name, p_category) for
-- compatibility with any caller from the 202608080001 deploy. New
-- behavior: root now lives under Clients, not at File Manager's true
-- root; p_category resolves DIRECTLY under the client root — there is no
-- "Orders" grouping level in the new hierarchy at all.
create or replace function public.get_or_create_client_asset_folder(
  p_client_id uuid,
  p_client_name text,
  p_category text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_client_tenant uuid;
  v_clients_root_id uuid;
  v_root_id uuid;
  v_sub_id uuid;
  v_category text := nullif(pg_catalog.btrim(coalesce(p_category, '')), '');
  v_name text := coalesce(nullif(pg_catalog.btrim(coalesce(p_client_name, '')), ''), 'Client');
  v_label text;
  v_suffix text;
  v_attempt int := 0;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'FOLDER_AUTH_REQUIRED';
  end if;
  if p_client_id is null then
    return null;
  end if;

  select tenant_id into v_client_tenant from public.clients where id = p_client_id;
  if v_client_tenant is null or not public.can_access_tenant(v_client_tenant) then
    raise exception using errcode = 'P0001', message = 'FOLDER_ACCESS_DENIED';
  end if;

  -- Reuse an existing root regardless of which pattern created it: a
  -- legacy Phase 1A root (parent_id is null, folder_kind is null) or a
  -- new-style root (folder_kind = 'client_root', living under Clients).
  -- Never silently create a second root for a client that already has
  -- one — the manual restructure script is the only thing that ever
  -- moves a legacy root, not this function.
  select id into v_root_id
  from public.folders
  where client_id = p_client_id
    and (parent_id is null or folder_kind = 'client_root')
  order by created_at asc
  limit 1;

  if v_root_id is null then
    v_clients_root_id := public.get_or_create_clients_root(v_client_tenant);

    -- Disambiguate a colliding display name against existing siblings
    -- under the same Clients root (idx_folders_client_subfolder_unique
    -- covers parent_id + lower(name)) with a short, human-readable
    -- client-id suffix — only when actually needed.
    v_label := v_name;
    if exists (
      select 1 from public.folders
      where parent_id = v_clients_root_id and lower(name) = lower(v_label)
    ) then
      v_suffix := lower(substr(replace(p_client_id::text, '-', ''), 1, 4));
      v_label := v_name || ' · ' || v_suffix;
    end if;

    loop
      v_attempt := v_attempt + 1;
      begin
        insert into public.folders (name, client_id, parent_id, tenant_id, folder_kind, color, created_by)
        values (v_label, p_client_id, v_clients_root_id, v_client_tenant, 'client_root', 'blue', v_user_id::text)
        returning id into v_root_id;
        exit;
      exception when unique_violation then
        -- Either this client's root was created concurrently (reuse it),
        -- or the disambiguated label itself collided (very unlikely,
        -- but widen the suffix once rather than loop forever).
        select id into v_root_id
        from public.folders
        where client_id = p_client_id and folder_kind = 'client_root'
        limit 1;
        if v_root_id is not null then
          exit;
        end if;
        if v_attempt >= 3 then
          raise;
        end if;
        v_label := v_name || ' · ' || lower(substr(replace(p_client_id::text, '-', ''), 1, 4 + v_attempt));
      end;
    end loop;
  end if;

  if v_category is null then
    return v_root_id;
  end if;

  select id into v_sub_id
  from public.folders
  where parent_id = v_root_id and lower(name) = lower(v_category)
  limit 1;

  if v_sub_id is null then
    begin
      insert into public.folders (name, client_id, parent_id, tenant_id, folder_kind, color, created_by)
      values (v_category, p_client_id, v_root_id, v_client_tenant, 'client_category', 'slate', v_user_id::text)
      returning id into v_sub_id;
    exception when unique_violation then
      select id into v_sub_id
      from public.folders
      where parent_id = v_root_id and lower(name) = lower(v_category)
      limit 1;
    end;
  end if;

  return v_sub_id;
end;
$$;

revoke all on function public.get_or_create_client_asset_folder(uuid, text, text) from public, anon, service_role;
grant execute on function public.get_or_create_client_asset_folder(uuid, text, text) to authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- 5. Backward-compatible order RPC semantics
-- ═══════════════════════════════════════════════════════════════════
-- Signature and name kept for compatibility ("order_asset_folder" is now
-- legacy naming only — see comment below) since the currently deployed
-- frontend may still call it during deploy sequencing. It no longer
-- creates ANY order-specific physical folder ("Orders" grouping,
-- ORD-XXXXX). p_category null now resolves the CLIENT root (not an order
-- folder); p_category supplied resolves the CLIENT category folder
-- directly. Order identity plays no part in the physical path any more —
-- order_number becomes pure metadata via orders.file_urls, exactly as the
-- Phase 1A.1 design requires.
create or replace function public.get_or_create_order_asset_folder(
  p_order_id uuid,
  p_category text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_order record;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'FOLDER_AUTH_REQUIRED';
  end if;
  if p_order_id is null then
    return null;
  end if;

  select o.id, o.client_id, o.client_name, o.tenant_id
  into v_order
  from public.orders o
  where o.id = p_order_id;

  if v_order.id is null then
    raise exception using errcode = 'P0001', message = 'FOLDER_ORDER_NOT_FOUND';
  end if;
  if v_order.client_id is null then
    return null;
  end if;
  if v_order.tenant_id is null or not public.can_access_tenant(v_order.tenant_id) then
    raise exception using errcode = 'P0001', message = 'FOLDER_ACCESS_DENIED';
  end if;

  -- Delegates straight to the client-first resolver — no order-specific
  -- folder is created or looked up any more.
  return public.get_or_create_client_asset_folder(v_order.client_id, v_order.client_name, p_category);
end;
$$;

revoke all on function public.get_or_create_order_asset_folder(uuid, text) from public, anon, service_role;
grant execute on function public.get_or_create_order_asset_folder(uuid, text) to authenticated;


-- Ensures the client root + all 9 standard client categories exist for an
-- order's client, even before any file is attached. Returns the CLIENT
-- root id (not an order folder id — there isn't one any more).
create or replace function public.provision_order_asset_folders(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_root_id uuid;
  v_category text;
begin
  v_root_id := public.get_or_create_order_asset_folder(p_order_id, null);
  if v_root_id is null then
    return null;
  end if;

  foreach v_category in array array[
    'Mockups', 'Artwork', 'Brand Assets', 'References', 'Production',
    'QC / Finished', 'Invoices & Quotes', 'Delivery', 'General'
  ]
  loop
    perform public.get_or_create_order_asset_folder(p_order_id, v_category);
  end loop;

  return v_root_id;
end;
$$;

revoke all on function public.provision_order_asset_folders(uuid) from public, anon, service_role;
grant execute on function public.provision_order_asset_folders(uuid) to authenticated;

commit;
