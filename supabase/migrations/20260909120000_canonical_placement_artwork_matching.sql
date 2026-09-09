-- Canonical placement matching for client_product_artwork <-> component
-- resolution.
--
-- Problem (confirmed on staging): product_components.placement is Title
-- Case (staff pick from PLACEMENT_PRESETS - "Front", "Back", "Left
-- Chest"), while client_product_artwork.placement / required_artwork_
-- placements are frequently lowercase ("front", "back"). The attach-time
-- lookup and find_or_create_client_product_artwork_from_asset both match
-- placement with an EXACT string comparison, so:
--   * a print component's approved current artwork is silently missed at
--     attach time (shows "none linked yet");
--   * the per-snapshot "Link artwork" recovery button passes the
--     component's Title-Case placement to
--     find_or_create_client_product_artwork_from_asset, which then fails
--     to match / supersede the existing lowercase current row and inserts
--     a SECOND is_current row for the same real placement.
--
-- This migration is ADDITIVE and reversible:
--   1. canonical_placement(text) IMMUTABLE - trims, collapses internal
--      whitespace, lowercases. Folds case + whitespace ONLY: it never
--      maps synonyms and never merges two placements a human would call
--      different ("Front" vs "Back" stay distinct). Mirrors the frontend
--      helper src/features/orders/placement.js exactly.
--   2. find_or_create_client_product_artwork_from_asset - the EXACT
--      existing signature and body from
--      202608220006_client_product_artwork_asset_linking.sql, with the
--      three placement comparisons (dedup select, max(revision), and the
--      is_current supersede) changed from `placement = v_clean_placement`
--      to `canonical_placement(placement) = canonical_placement(v_clean_placement)`.
--      The row is still INSERTed with the placement string exactly as
--      passed - matching is canonical, storage/display is verbatim. Every
--      other line - is_opps_staff() gate, tenant/client checks, asset
--      validation, the unique_violation concurrency catch, grants - is
--      unchanged.
--   3. A NON-UNIQUE lookup index on (client_product_id,
--      canonical_placement(placement)) WHERE is_current.
--
-- NOT done here (deliberately):
--   * No bulk rewrite of historical client_product_artwork rows.
--   * No UNIQUE constraint / index on the canonical key - existing
--     canonical collisions (two is_current rows folding to the same
--     placement) must be reviewed on staging AND production first (see
--     the read-only reports at the end of this file). Staging report at
--     time of writing: 0 collisions.
--   * link_my_client_file_to_artwork (the CUSTOMER-facing linker) is not
--     touched - it validates p_placement against
--     client_products.required_artwork_placements, so its own placement
--     set is internally consistent; changing it is out of this slice's
--     scope and would touch the customer portal.
--
-- Depends on: 202608220006_client_product_artwork_asset_linking.sql.
-- NOT MODIFIED: client_product_artwork columns / RLS / the two existing
-- unique indexes (client_product_artwork_current_unique_idx,
-- client_product_artwork_current_source_asset_uidx), any order table,
-- PayFast / payments / sync.
--
-- PREPARED FOR REVIEW + STAGING APPLICATION ONLY. Do not apply to
-- production until the collision reports below are run there.

begin;

-- ===================================================================
-- 1. Canonical placement helper (IMMUTABLE - safe to index).
--    Matches src/features/orders/placement.js:
--      String(raw).trim().replace(/\s+/g, " ").toLowerCase()
-- ===================================================================
create or replace function public.canonical_placement(p_placement text)
returns text
language sql
immutable
parallel safe
set search_path to 'pg_catalog', 'public'
as $$
  select lower(btrim(regexp_replace(coalesce(p_placement, ''), '\s+', ' ', 'g')));
$$;

comment on function public.canonical_placement(text) is
  'Case/whitespace-folded placement key for matching client_product_artwork against product_components.placement. Folds case + whitespace only; never merges distinct placements. Mirror of src/features/orders/placement.js.';

revoke all on function public.canonical_placement(text) from public, anon;
grant execute on function public.canonical_placement(text) to authenticated;

-- ===================================================================
-- 2. find_or_create_client_product_artwork_from_asset - verbatim from
--    202608220006 with ONLY the three placement comparisons made
--    canonical (marked "-- canonical:" below). Storage of the placement
--    string is still verbatim (v_clean_placement).
-- ===================================================================
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
    and public.canonical_placement(placement) = public.canonical_placement(v_clean_placement)  -- canonical:
    and source_client_asset_id = p_client_asset_id
    and is_current = true
  limit 1;

  if found then
    return v_existing;
  end if;

  select coalesce(max(revision), 0) + 1 into v_next_revision
  from public.client_product_artwork
  where client_product_id = p_client_product_id
    and public.canonical_placement(placement) = public.canonical_placement(v_clean_placement);  -- canonical:

  update public.client_product_artwork
  set is_current = false
  where client_product_id = p_client_product_id
    and public.canonical_placement(placement) = public.canonical_placement(v_clean_placement)  -- canonical:
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
      and public.canonical_placement(placement) = public.canonical_placement(v_clean_placement)  -- canonical:
      and source_client_asset_id = p_client_asset_id
      and is_current = true
    limit 1;
  end;

  return v_new;
end;
$$;

revoke all on function public.find_or_create_client_product_artwork_from_asset(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.find_or_create_client_product_artwork_from_asset(uuid, uuid, uuid, text) to authenticated;

-- ===================================================================
-- 3. Non-unique lookup index for the canonical match above. NOT unique -
--    existing canonical collisions must be reviewed before any
--    uniqueness constraint is considered.
-- ===================================================================
create index if not exists client_product_artwork_current_canonical_idx
  on public.client_product_artwork (client_product_id, public.canonical_placement(placement))
  where is_current;

commit;

-- ===================================================================
-- READ-ONLY collision reports - run on STAGING and PRODUCTION before
-- considering any uniqueness constraint. Each returns 0 rows when clean.
-- ===================================================================
--
-- (a) Two or more is_current artwork revisions that fold to the same
--     canonical placement for one client product + treatment scope:
--
-- select client_product_id,
--        coalesce(treatment_id::text, '(family)') as treatment,
--        public.canonical_placement(placement)     as canonical_placement,
--        count(*)                                  as current_rows,
--        jsonb_agg(jsonb_build_object('id', id, 'placement', placement, 'status', status)) as rows
-- from public.client_product_artwork
-- where is_current
-- group by client_product_id, treatment_id, public.canonical_placement(placement)
-- having count(*) > 1;
--
-- (b) product_components whose Title-Case placement only case-mismatches
--     a current artwork row (informational - these are the rows this
--     migration starts resolving correctly):
--
-- select pc.client_product_id, pc.id as component_id, pc.placement as component_placement,
--        a.id as artwork_id, a.placement as artwork_placement
-- from public.product_components pc
-- join public.client_product_artwork a
--   on a.client_product_id = pc.client_product_id
--  and a.is_current
--  and a.placement <> pc.placement
--  and public.canonical_placement(a.placement) = public.canonical_placement(pc.placement)
-- where pc.placement is not null;

-- ===================================================================
-- ROLLBACK (manual):
--   drop index if exists public.client_product_artwork_current_canonical_idx;
--   -- then CREATE OR REPLACE find_or_create_client_product_artwork_from_asset
--   -- with the body from 202608220006_client_product_artwork_asset_linking.sql
--   -- (exact-match placement), and:
--   drop function if exists public.canonical_placement(text);
-- No data is written by this migration, so rollback is clean.
-- ===================================================================
