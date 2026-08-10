-- Phase 1B.2 correction: canonical Order Primary Image role.
--
-- Replaces the rejected donor design from
-- 202608060005_add_order_production_thumbnail.sql (a bare orders.text
-- column with no identity, no ownership check, no lifecycle guarantee -
-- deleted, never applied). The canonical model is a nullable FK to the
-- ClientAsset currently linked to the order, validated so a primary can
-- never point at another client's/tenant's file, a file no longer linked
-- to the order, an archived asset, or a non-image file.
--
-- Not applied anywhere by this session - file only, per instructions.
--
-- Rollback:
--   drop function if exists public.get_order_primary_image_context(uuid[]);
--   drop trigger if exists trg_validate_order_primary_image on public.orders;
--   drop function if exists public.validate_order_primary_image();
--   drop index if exists public.idx_orders_primary_image_asset_id;
--   alter table public.orders drop constraint if exists orders_primary_image_asset_id_fkey;
--   alter table public.orders drop column if exists primary_image_asset_id;

begin;

-- ═══════════════════════════════════════════════════════════════════
-- 1. Column + FK + index
-- ═══════════════════════════════════════════════════════════════════
-- No backfill: every existing order starts NULL. Staff explicitly pick a
-- primary going forward; nothing is silently promoted from old data.
alter table public.orders
  add column if not exists primary_image_asset_id uuid null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_primary_image_asset_id_fkey'
  ) then
    alter table public.orders
      add constraint orders_primary_image_asset_id_fkey
      foreign key (primary_image_asset_id)
      references public.client_assets(id)
      on delete set null;
  end if;
end $$;

-- Partial: only orders that actually have a primary set are ever looked
-- up by this column (Production Summary / Quick Print / OrderFilesTab all
-- batch-resolve via get_order_primary_image_context below).
create index if not exists idx_orders_primary_image_asset_id
  on public.orders (primary_image_asset_id)
  where primary_image_asset_id is not null;

-- ═══════════════════════════════════════════════════════════════════
-- 2. Validation trigger
-- ═══════════════════════════════════════════════════════════════════
-- A bare FK only proves the ClientAsset row exists - it says nothing
-- about whether it is *this order's* file. Every check below closes a
-- specific way a primary could otherwise point at the wrong image:
--   - client/tenant match: the asset must belong to the same client and
--     tenant as the order, never a different customer's file;
--   - file_url membership: the asset's canonical file_url must currently
--     be present in orders.file_urls - client_assets.order_id is NEVER
--     used for this check, because it only records the order an asset
--     was first uploaded/linked from and does not update when the same
--     canonical asset is later copied/linked into a different order;
--   - not archived: a soft-deleted asset can't be the production image;
--   - recognized image extension, kept aligned with the extension set in
--     src/lib/imageReference.js (png, jpg/jpeg, webp, gif, avif, svg).
--
-- Two different failure modes, both required:
--   - staff EXPLICITLY set primary_image_asset_id to something invalid
--     (an INSERT with it set, or an UPDATE that changes it) -> REJECT the
--     write outright so the bad value is never stored;
--   - primary_image_asset_id was left UNCHANGED by this write, but a
--     collateral change (file_urls edited, client re-linked, tenant
--     changed) made the already-selected primary invalid -> silently
--     clear it to NULL rather than blocking the unrelated update or
--     leaving a stale/dangling reference.
--
-- orders.file_urls' storage representation has been handled defensively
-- elsewhere in this codebase (see
-- 202605240003_order_production_readiness.sql) via
-- to_jsonb()/jsonb_typeof rather than assuming text[] vs jsonb - the same
-- pattern is used here.
create or replace function public.validate_order_primary_image()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_asset public.client_assets%rowtype;
  v_file_urls jsonb;
  v_url_linked boolean;
  v_explicit boolean;
begin
  if new.primary_image_asset_id is null then
    return new;
  end if;

  v_explicit := (tg_op = 'INSERT')
    or (new.primary_image_asset_id is distinct from old.primary_image_asset_id);

  if new.client_id is null then
    if v_explicit then
      raise exception using errcode = 'P0001', message = 'ORDER_PRIMARY_IMAGE_REQUIRES_CLIENT';
    end if;
    new.primary_image_asset_id := null;
    return new;
  end if;

  if new.tenant_id is null then
    if v_explicit then
      raise exception using errcode = 'P0001', message = 'ORDER_PRIMARY_IMAGE_REQUIRES_TENANT';
    end if;
    new.primary_image_asset_id := null;
    return new;
  end if;

  select * into v_asset
  from public.client_assets
  where id = new.primary_image_asset_id;

  if v_asset.id is null then
    if v_explicit then
      raise exception using errcode = 'P0001', message = 'ORDER_PRIMARY_IMAGE_ASSET_NOT_FOUND';
    end if;
    new.primary_image_asset_id := null;
    return new;
  end if;

  if v_asset.client_id is distinct from new.client_id then
    if v_explicit then
      raise exception using errcode = 'P0001', message = 'ORDER_PRIMARY_IMAGE_CLIENT_MISMATCH';
    end if;
    new.primary_image_asset_id := null;
    return new;
  end if;

  if v_asset.tenant_id is distinct from new.tenant_id then
    if v_explicit then
      raise exception using errcode = 'P0001', message = 'ORDER_PRIMARY_IMAGE_TENANT_MISMATCH';
    end if;
    new.primary_image_asset_id := null;
    return new;
  end if;

  if coalesce(v_asset.is_archived, false) then
    if v_explicit then
      raise exception using errcode = 'P0001', message = 'ORDER_PRIMARY_IMAGE_ASSET_ARCHIVED';
    end if;
    new.primary_image_asset_id := null;
    return new;
  end if;

  if v_asset.file_url is null or v_asset.file_url !~* '\.(png|jpe?g|webp|gif|avif|svg)(\?|#|$)' then
    if v_explicit then
      raise exception using errcode = 'P0001', message = 'ORDER_PRIMARY_IMAGE_NOT_AN_IMAGE';
    end if;
    new.primary_image_asset_id := null;
    return new;
  end if;

  v_file_urls := case
    when jsonb_typeof(to_jsonb(new.file_urls)) = 'array' then to_jsonb(new.file_urls)
    else '[]'::jsonb
  end;

  select exists (
    select 1 from jsonb_array_elements_text(v_file_urls) as u(url)
    where u.url = v_asset.file_url
  ) into v_url_linked;

  if not v_url_linked then
    if v_explicit then
      raise exception using errcode = 'P0001', message = 'ORDER_PRIMARY_IMAGE_NOT_LINKED_TO_ORDER';
    end if;
    new.primary_image_asset_id := null;
    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_order_primary_image on public.orders;
create trigger trg_validate_order_primary_image
  before insert or update of primary_image_asset_id, file_urls, client_id, tenant_id
  on public.orders
  for each row execute function public.validate_order_primary_image();

-- ═══════════════════════════════════════════════════════════════════
-- 3. Read-only primary-image context RPC
-- ═══════════════════════════════════════════════════════════════════
-- Batched lookup used by the frontend (OrderFilesTab, OrderQuickPrintSheet,
-- Production Summary) to resolve every ClientAsset currently linked to a
-- set of orders. Current linkage is always
-- client_assets.file_url = ANY(orders.file_urls) plus matching
-- client_id/tenant_id - never client_assets.order_id.
--
-- Read-only: no insert/update/delete. Never returns a signed URL - only
-- the raw canonical file_url, same as every other gallery/lightbox
-- surface in this codebase. Tenant-safe: an order is only resolved if the
-- caller can access its tenant (or is an app admin) - security definer
-- bypasses RLS on client_assets/orders directly, so this check is the
-- only gate and must not be dropped.
create or replace function public.get_order_primary_image_context(p_order_ids uuid[])
returns table (
  order_id uuid,
  asset_id uuid,
  file_url text,
  file_type text,
  folder_id uuid,
  folder_name text,
  folder_kind text,
  asset_client_id uuid,
  asset_tenant_id uuid
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_order_ids uuid[];
begin
  if p_order_ids is null or array_length(p_order_ids, 1) is null then
    return;
  end if;

  -- Dedupe, then bound to at most 200 orders per call.
  select array_agg(oid) into v_order_ids
  from (
    select distinct oid from unnest(p_order_ids) as oid limit 200
  ) bounded;

  return query
  select
    o.id as order_id,
    ca.id as asset_id,
    ca.file_url,
    ca.file_type,
    ca.folder_id,
    f.name as folder_name,
    f.folder_kind,
    ca.client_id as asset_client_id,
    ca.tenant_id as asset_tenant_id
  from public.orders o
  join public.client_assets ca
    on ca.client_id = o.client_id
   and ca.tenant_id = o.tenant_id
   and coalesce(ca.is_archived, false) = false
   and exists (
     select 1 from jsonb_array_elements_text(
       case when jsonb_typeof(to_jsonb(o.file_urls)) = 'array' then to_jsonb(o.file_urls) else '[]'::jsonb end
     ) as u(url)
     where u.url = ca.file_url
   )
  left join public.folders f on f.id = ca.folder_id
  where o.id = any(v_order_ids)
    and (public.is_app_admin() or public.can_access_tenant(o.tenant_id));
end;
$$;

revoke all on function public.get_order_primary_image_context(uuid[]) from public, anon;
grant execute on function public.get_order_primary_image_context(uuid[]) to authenticated;

commit;
