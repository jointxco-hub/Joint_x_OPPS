-- Artwork linking: lets a print component's artwork reference an existing
-- client_assets row (the canonical client file library already used by
-- OrderFilesTab's ClientLibraryPickerModal) instead of duplicating the
-- upload into client_product_artwork's own free-text file_path/file_name.
-- Additive only - no existing column, table, or RLS policy is altered.

alter table public.client_product_artwork
  add column if not exists source_client_asset_id uuid references public.client_assets(id);

-- Dedup/lookup index: find_or_create_client_product_artwork_from_asset
-- below reuses the current revision for a given (client_product,
-- placement, source asset) rather than creating a duplicate. Partial
-- unique so this invariant is enforced by the database itself, not just
-- application logic - matches the "exactly one current row" pattern
-- already used for inventory_variant_reservations/production_pricing_defaults.
create unique index if not exists client_product_artwork_current_source_asset_uidx
  on public.client_product_artwork (client_product_id, placement, source_client_asset_id)
  where is_current and source_client_asset_id is not null;

-- anon has no legitimate use for this table: the client-portal artwork
-- policy (client_product_artwork's own "Client can view current approved
-- artwork on own products" policy) resolves via current_client_id(),
-- which requires auth.uid() - anon sessions never have one. Full DML
-- grant to anon was never load-bearing; revoking matches every other
-- table built this session (see 202608220005's fix for the same class
-- of unnecessary-grant issue on a different set of tables).
revoke insert, update, delete on public.client_product_artwork from anon;

create or replace function public.find_or_create_client_product_artwork_from_asset(
  p_tenant_id uuid,
  p_client_product_id uuid,
  p_client_asset_id uuid,
  p_placement text
)
returns public.client_product_artwork
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_client_product public.client_products;
  v_client_asset public.client_assets;
  v_existing public.client_product_artwork;
  v_new public.client_product_artwork;
  v_next_revision int;
  v_clean_placement text := nullif(btrim(coalesce(p_placement, '')), '');
begin
  if not public.is_opps_staff() then
    raise exception using errcode = 'P0001', message = 'ARTWORK_FORBIDDEN: staff access required';
  end if;
  if p_tenant_id is null or not public.can_access_tenant(p_tenant_id) then
    raise exception using errcode = 'P0001', message = 'ARTWORK_FORBIDDEN: tenant access denied';
  end if;
  if v_clean_placement is null then
    raise exception using errcode = 'P0001', message = 'ARTWORK_INVALID_PLACEMENT: placement is required';
  end if;

  select * into v_client_product from public.client_products where id = p_client_product_id;
  if not found or v_client_product.tenant_id is distinct from p_tenant_id then
    raise exception using errcode = 'P0001', message = 'ARTWORK_CLIENT_PRODUCT_NOT_FOUND: does not belong to this tenant';
  end if;

  select * into v_client_asset from public.client_assets where id = p_client_asset_id;
  if not found or v_client_asset.tenant_id is distinct from p_tenant_id then
    raise exception using errcode = 'P0001', message = 'ARTWORK_ASSET_NOT_FOUND: does not belong to this tenant';
  end if;
  if v_client_asset.client_id is distinct from v_client_product.client_id then
    raise exception using errcode = 'P0001', message = 'ARTWORK_ASSET_CLIENT_MISMATCH: asset does not belong to the same client as this product';
  end if;

  select * into v_existing
  from public.client_product_artwork
  where client_product_id = p_client_product_id
    and placement = v_clean_placement
    and source_client_asset_id = p_client_asset_id
    and is_current = true
  limit 1;

  if found then
    return v_existing;
  end if;

  select coalesce(max(revision), 0) + 1 into v_next_revision
  from public.client_product_artwork
  where client_product_id = p_client_product_id and placement = v_clean_placement;

  update public.client_product_artwork
  set is_current = false
  where client_product_id = p_client_product_id
    and placement = v_clean_placement
    and is_current = true;

  begin
    insert into public.client_product_artwork (
      client_product_id, revision, placement, file_path, file_name, file_type,
      uploaded_by_type, uploaded_by, status, is_current, source_client_asset_id
    )
    values (
      p_client_product_id, v_next_revision, v_clean_placement,
      v_client_asset.file_url, v_client_asset.title, v_client_asset.file_type,
      'staff', auth.uid()::text, 'pending', true, p_client_asset_id
    )
    returning * into v_new;
  exception when unique_violation then
    -- Another concurrent call already created the same (product, placement,
    -- asset) current revision - reuse it instead of erroring, same
    -- concurrency-safe pattern as get_or_create_client_asset_folder.
    select * into v_new
    from public.client_product_artwork
    where client_product_id = p_client_product_id
      and placement = v_clean_placement
      and source_client_asset_id = p_client_asset_id
      and is_current = true
    limit 1;
  end;

  return v_new;
end;
$$;

revoke all on function public.find_or_create_client_product_artwork_from_asset(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.find_or_create_client_product_artwork_from_asset(uuid, uuid, uuid, text) to authenticated;
