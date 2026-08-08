-- Auto-provisions the nested Client Root -> Orders -> ORD-XXXXX -> category
-- folder hierarchy in File Manager (folders/client_assets — the tenant-scoped,
-- client_id-based system already used for the client root-folder-on-creation
-- behavior), and gives order-file code a stable, concurrency-safe RPC to
-- mirror order files into it. The older, email-keyed
-- client_file_folders/client_file_links system is untouched by this
-- migration and keeps working as-is.
--
-- Supersedes the flatter "one root folder, one category level" design from
-- the earlier local-only feature/client-file-manager-auto-folders branch
-- (get_or_create_client_asset_folder is kept, unchanged in behavior, since
-- it's still exactly right for the client-root and Orders-grouping levels).
-- What's new here is get_or_create_order_asset_folder /
-- provision_order_asset_folders, which add the per-order and per-category
-- nesting underneath it, keyed by order_id rather than by name-matching, so
-- an order can never provision two folders for itself even under concurrent
-- calls.
--
-- Rollback:
--   drop function if exists public.provision_order_asset_folders(uuid);
--   drop function if exists public.get_or_create_order_asset_folder(uuid, text);
--   drop function if exists public.get_or_create_client_asset_folder(uuid, text, text);
--   drop index if exists public.idx_client_assets_order_file_url_unique;
--   drop index if exists public.idx_folders_order_folder_unique;
--   drop index if exists public.idx_folders_client_subfolder_unique;
--   drop index if exists public.idx_folders_client_root_unique;

begin;

-- One root folder per client.
create unique index if not exists idx_folders_client_root_unique
  on public.folders (client_id)
  where parent_id is null and client_id is not null;

-- One named subfolder per parent folder (case-insensitive), regardless of
-- which level it's used at: client root -> "Orders", Orders -> order
-- folder's own children never rely on this (they use order_id instead, see
-- idx_folders_order_folder_unique), but the "Orders" grouping folder and
-- every per-order category subfolder both go through this index.
create unique index if not exists idx_folders_client_subfolder_unique
  on public.folders (parent_id, lower(name))
  where parent_id is not null;

-- Exactly one order-specific folder per order, however many concurrent
-- requests try to provision it. This is the identity anchor: the order
-- folder is found by order_id, not by matching its name (order_number),
-- so a later order_number edit can never orphan or duplicate its folder.
create unique index if not exists idx_folders_order_folder_unique
  on public.folders (order_id)
  where order_id is not null;

-- A mirrored order file is placed once per (order, file_url). Repeat mirror
-- calls for the same file (retry, duplicate event, re-save) must not create
-- a second client_assets placement.
create unique index if not exists idx_client_assets_order_file_url_unique
  on public.client_assets (order_id, file_url)
  where order_id is not null and file_url is not null;

-- Get-or-create the client's root File Manager folder and, if a category is
-- given, a named subfolder directly under it. Unchanged from the donor
-- implementation (feature/client-file-manager-auto-folders), already
-- smoke-tested for idempotency, cross-tenant rejection, and unauthenticated
-- rejection.
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
  v_root_id uuid;
  v_sub_id uuid;
  v_category text := nullif(pg_catalog.btrim(coalesce(p_category, '')), '');
  v_name text := nullif(pg_catalog.btrim(coalesce(p_client_name, '')), '');
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

  select id into v_root_id
  from public.folders
  where client_id = p_client_id and parent_id is null
  order by created_at asc
  limit 1;

  if v_root_id is null then
    begin
      insert into public.folders (name, client_id, parent_id, color, created_by)
      values (coalesce(v_name, 'Client'), p_client_id, null, 'blue', v_user_id::text)
      returning id into v_root_id;
    exception when unique_violation then
      select id into v_root_id
      from public.folders
      where client_id = p_client_id and parent_id is null
      order by created_at asc
      limit 1;
    end;
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
      insert into public.folders (name, client_id, parent_id, color, created_by)
      values (v_category, p_client_id, v_root_id, 'slate', v_user_id::text)
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


-- Narrowly scoped: given only an order_id (never a client-supplied
-- client_id — the order's own client/tenant is resolved server-side so a
-- caller can't point provisioning at a client they don't own), get-or-create
-- "<Client Root>/Orders/<order_number>" and, if p_category is given, a
-- category subfolder under that order folder. Idempotent and
-- concurrency-safe: the order folder itself is keyed by order_id
-- (idx_folders_order_folder_unique), category subfolders by
-- (parent_id, lower(name)) (idx_folders_client_subfolder_unique).
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
  v_root_id uuid;
  v_orders_group_id uuid;
  v_order_folder_id uuid;
  v_sub_id uuid;
  v_category text := nullif(pg_catalog.btrim(coalesce(p_category, '')), '');
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'FOLDER_AUTH_REQUIRED';
  end if;
  if p_order_id is null then
    return null;
  end if;

  select o.id, o.client_id, o.client_name, o.order_number, o.tenant_id
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

  v_root_id := public.get_or_create_client_asset_folder(v_order.client_id, v_order.client_name, null);
  v_orders_group_id := public.get_or_create_client_asset_folder(v_order.client_id, v_order.client_name, 'Orders');

  select id into v_order_folder_id
  from public.folders
  where order_id = p_order_id
  limit 1;

  if v_order_folder_id is null then
    begin
      insert into public.folders (name, client_id, parent_id, order_id, color, created_by)
      values (
        coalesce(nullif(pg_catalog.btrim(v_order.order_number), ''), 'Order'),
        v_order.client_id, v_orders_group_id, p_order_id, 'slate', v_user_id::text
      )
      returning id into v_order_folder_id;
    exception when unique_violation then
      select id into v_order_folder_id from public.folders where order_id = p_order_id limit 1;
    end;
  end if;

  if v_category is null then
    return v_order_folder_id;
  end if;

  select id into v_sub_id
  from public.folders
  where parent_id = v_order_folder_id and lower(name) = lower(v_category)
  limit 1;

  if v_sub_id is null then
    begin
      insert into public.folders (name, client_id, parent_id, color, created_by)
      values (v_category, v_order.client_id, v_order_folder_id, 'slate', v_user_id::text)
      returning id into v_sub_id;
    exception when unique_violation then
      select id into v_sub_id
      from public.folders
      where parent_id = v_order_folder_id and lower(name) = lower(v_category)
      limit 1;
    end;
  end if;

  return v_sub_id;
end;
$$;

revoke all on function public.get_or_create_order_asset_folder(uuid, text) from public, anon, service_role;
grant execute on function public.get_or_create_order_asset_folder(uuid, text) to authenticated;


-- Ensures the full standard order subfolder set exists for an order in one
-- round trip, so an order's File Manager structure is ready before any file
-- is attached (e.g. right after order creation). Safe to call repeatedly —
-- every step it performs is itself idempotent.
create or replace function public.provision_order_asset_folders(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_order_folder_id uuid;
  v_category text;
begin
  v_order_folder_id := public.get_or_create_order_asset_folder(p_order_id, null);
  if v_order_folder_id is null then
    return null;
  end if;

  foreach v_category in array array[
    'Mockups', 'Artwork', 'Production', 'QC / Finished', 'Invoices & Quotes', 'Delivery', 'General'
  ]
  loop
    perform public.get_or_create_order_asset_folder(p_order_id, v_category);
  end loop;

  return v_order_folder_id;
end;
$$;

revoke all on function public.provision_order_asset_folders(uuid) from public, anon, service_role;
grant execute on function public.provision_order_asset_folders(uuid) to authenticated;

commit;
