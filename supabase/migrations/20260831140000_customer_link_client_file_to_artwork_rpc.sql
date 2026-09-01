-- Phase 1F-C3 (PR-C) — customer links an existing Client File to a
-- required artwork placement.
--
-- Lets an authenticated X LAB customer attach one of their OWN
-- client_assets to a required artwork placement on their OWN
-- client_product, instead of uploading the same file again. Linking is
-- NOT approval — the new revision is 'pending' and staff approval remains
-- required before it counts toward reorder readiness.
--
-- The browser supplies ONLY: product id, asset id, placement. Client id,
-- tenant id, approval state, uploaded_by are all derived server-side.
--
-- Revision / supersede / idempotency / concurrency semantics are a direct
-- reuse of the proven staff linker
-- find_or_create_client_product_artwork_from_asset(...):
--   * if this exact asset is already the CURRENT artwork for this
--     placement -> return that row, no new revision (idempotent no-op);
--   * otherwise the current revision is marked is_current=false (same as
--     the staff linker — only is_current is flipped, status is left as-is;
--     _compute_artwork_readiness keys off is_current+status), a new
--     revision = max(revision)+1 row is inserted is_current=true /
--     status='pending' / uploaded_by_type='client' /
--     source_client_asset_id set;
--   * a unique_violation from a concurrent winner is caught and the
--     winner's row is returned.
-- Additionally this function takes pg_advisory_xact_lock keyed on
-- (product, placement) so two near-simultaneous link attempts serialise
-- and cannot both create a "current" row.
--
-- The two partial unique indexes on client_product_artwork back all of
-- this at the storage layer:
--   client_product_artwork_current_unique_idx
--     UNIQUE (client_product_id, placement, coalesce(treatment_id,0)) WHERE is_current
--   client_product_artwork_current_source_asset_uidx
--     UNIQUE (client_product_id, placement, coalesce(treatment_id,0), source_client_asset_id)
--       WHERE is_current AND source_client_asset_id IS NOT NULL
--
-- Placement rule: p_placement must be a member of the product's
-- explicitly-confirmed client_products.required_artwork_placements. If
-- that column is NULL (the legacy "infer from upload history" model) the
-- call FAILS CLOSED — a customer may not link against an unconfirmed
-- placement set. Trimming matches the staff linker
-- (nullif(btrim(coalesce(...)),'')); no case folding, same as
-- _compute_artwork_readiness' exact string comparison.
--
-- Asset validity: rejects an archived asset, an empty/blob: file_url, a
-- mockup asset (tag 'mockup' or any client_products.primary_mockup_asset_id).
-- A private-upload:// asset that is otherwise valid IS accepted —
-- "resolvable=false" from get_my_linkable_client_files() means "not
-- previewable in the browser", not "not linkable".
--
-- Does NOT modify: find_or_create_client_product_artwork_from_asset,
-- _compute_artwork_readiness, get_client_product_reorder_readiness,
-- start_client_product_order, any RLS policy, any storage policy, or any
-- table schema. Approval stays a staff action.

begin;

create or replace function public.link_my_client_file_to_artwork(
  p_client_product_id uuid,
  p_client_asset_id   uuid,
  p_placement         text
)
returns table (
  id                     uuid,
  client_product_id      uuid,
  placement              text,
  revision               integer,
  file_name              text,
  file_type              text,
  status                 text,
  is_current             boolean,
  source_client_asset_id uuid,
  created_at             timestamptz
)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
#variable_conflict use_column
declare
  v_client_id     uuid := public.get_my_client_identity();
  v_tenant_id     uuid;
  v_product       public.client_products;
  v_asset         public.client_assets;
  v_placement     text := nullif(btrim(coalesce(p_placement, '')), '');
  v_next_revision integer;
  v_row           public.client_product_artwork;
begin
  if p_client_product_id is null or p_client_asset_id is null then
    raise exception using errcode = 'P0001', message = 'ARTWORK_LINK_INVALID: product and file are required';
  end if;
  if v_placement is null then
    raise exception using errcode = 'P0001', message = 'ARTWORK_LINK_INVALID: placement is required';
  end if;

  select c.tenant_id into v_tenant_id from public.clients c where c.id = v_client_id;
  if v_tenant_id is null then
    raise exception using errcode = 'P0001', message = 'ARTWORK_LINK_FORBIDDEN: no tenant for this account';
  end if;

  -- Product must belong to the caller and be a customer-visible product
  -- (same visibility + lifecycle set as get_my_client_product()).
  select * into v_product from public.client_products where id = p_client_product_id;
  if not found or v_product.client_id is distinct from v_client_id then
    raise exception using errcode = 'P0001', message = 'ARTWORK_LINK_PRODUCT_NOT_FOUND';
  end if;
  if v_product.visible_in_account is not true
     or v_product.status not in (
       'ready_for_client_review', 'client_changes_requested',
       'client_approved', 'ready_to_order', 'active'
     ) then
    raise exception using errcode = 'P0001', message = 'ARTWORK_LINK_PRODUCT_NOT_AVAILABLE';
  end if;

  -- Placement must be an explicitly confirmed required placement.
  -- Fail closed if the product still uses the legacy inferred model.
  if v_product.required_artwork_placements is null then
    raise exception using errcode = 'P0001',
      message = 'ARTWORK_LINK_PLACEMENTS_UNCONFIRMED: Joint X has not confirmed this product''s artwork placements yet';
  end if;
  if not (v_placement = any (v_product.required_artwork_placements)) then
    raise exception using errcode = 'P0001', message = 'ARTWORK_LINK_PLACEMENT_NOT_REQUIRED';
  end if;

  -- Asset must belong to the caller AND the caller's tenant. A same-tenant
  -- other-client asset fails on client_id; a cross-tenant / null-tenant
  -- asset fails on tenant_id.
  select * into v_asset from public.client_assets where id = p_client_asset_id;
  if not found or v_asset.client_id is distinct from v_client_id then
    raise exception using errcode = 'P0001', message = 'ARTWORK_LINK_FILE_NOT_FOUND';
  end if;
  if v_asset.tenant_id is distinct from v_tenant_id then
    raise exception using errcode = 'P0001', message = 'ARTWORK_LINK_FILE_NOT_FOUND';
  end if;
  if coalesce(v_asset.is_archived, false) then
    raise exception using errcode = 'P0001', message = 'ARTWORK_LINK_FILE_ARCHIVED';
  end if;
  if v_asset.file_url is null or btrim(v_asset.file_url) = '' or v_asset.file_url like 'blob:%' then
    raise exception using errcode = 'P0001', message = 'ARTWORK_LINK_FILE_UNUSABLE';
  end if;
  if coalesce(v_asset.tags, '{}'::text[]) @> array['mockup']::text[]
     or exists (select 1 from public.client_products cp where cp.primary_mockup_asset_id = v_asset.id) then
    raise exception using errcode = 'P0001', message = 'ARTWORK_LINK_FILE_IS_MOCKUP';
  end if;

  -- Serialise concurrent link attempts for the same (product, placement).
  perform pg_advisory_xact_lock(hashtext('cpa_link:' || p_client_product_id::text || ':' || v_placement));

  -- Idempotent no-op: this exact asset is already the current artwork for
  -- this placement -> return it, do not spin a new revision.
  select cpa.* into v_row
  from public.client_product_artwork cpa
  where cpa.client_product_id = p_client_product_id
    and cpa.placement = v_placement
    and cpa.treatment_id is null
    and cpa.source_client_asset_id = p_client_asset_id
    and cpa.is_current = true
  limit 1;
  if found then
    return query select v_row.id, v_row.client_product_id, v_row.placement, v_row.revision,
                        v_row.file_name, v_row.file_type, v_row.status, v_row.is_current,
                        v_row.source_client_asset_id, v_row.created_at;
    return;
  end if;

  select coalesce(max(cpa.revision), 0) + 1 into v_next_revision
  from public.client_product_artwork cpa
  where cpa.client_product_id = p_client_product_id and cpa.placement = v_placement;

  -- Supersede the current revision (is_current only — matches the staff
  -- linker; no explicit 'superseded' status write).
  update public.client_product_artwork cpa
  set is_current = false
  where cpa.client_product_id = p_client_product_id
    and cpa.placement = v_placement
    and cpa.treatment_id is null
    and cpa.is_current = true;

  begin
    insert into public.client_product_artwork (
      client_product_id, revision, placement, file_path, file_name, file_type,
      uploaded_by_type, uploaded_by, status, is_current, source_client_asset_id, treatment_id
    ) values (
      p_client_product_id, v_next_revision, v_placement,
      v_asset.file_url, v_asset.title, v_asset.file_type,
      'client', auth.uid()::text, 'pending', true, p_client_asset_id, null
    )
    returning * into v_row;
  exception when unique_violation then
    -- A concurrent call won the race for this (product, placement, asset)
    -- -> reuse its current row instead of erroring.
    select cpa.* into v_row
    from public.client_product_artwork cpa
    where cpa.client_product_id = p_client_product_id
      and cpa.placement = v_placement
      and cpa.treatment_id is null
      and cpa.source_client_asset_id = p_client_asset_id
      and cpa.is_current = true
    limit 1;
    if not found then
      raise;
    end if;
  end;

  return query select v_row.id, v_row.client_product_id, v_row.placement, v_row.revision,
                      v_row.file_name, v_row.file_type, v_row.status, v_row.is_current,
                      v_row.source_client_asset_id, v_row.created_at;
end;
$$;

revoke all on function public.link_my_client_file_to_artwork(uuid, uuid, text) from public, anon;
grant execute on function public.link_my_client_file_to_artwork(uuid, uuid, text) to authenticated;

commit;
