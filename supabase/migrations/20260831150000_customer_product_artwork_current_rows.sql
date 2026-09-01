-- Phase 1F-C3 (PR-D fix) — get_my_client_product_artwork returns the
-- CURRENT artwork row regardless of approval status.
--
-- Before: the RPC returned only rows where
--   is_current = true AND status = 'approved'
-- so a placement the customer has just filled with an existing file
-- (link_my_client_file_to_artwork inserts is_current=true / status
-- 'pending') had no server-visible file identity — X LAB had to cache the
-- linked filename in React, which is lost on refresh / re-login.
--
-- After: the RPC returns every current row for the owned/visible product
--   is_current = true            (any status: pending, approved, rejected)
-- and additionally projects source_client_asset_id so the UI can show
-- "linked from your files" provenance.
--
-- This is a DISPLAY PROJECTION ONLY. It does NOT change
-- _compute_artwork_readiness, get_client_product_reorder_readiness,
-- start_client_product_order, any approval rule, any linking rule, or any
-- RLS / storage policy. Pending stays pending; approved stays approved;
-- reorder readiness authority stays server-side. The ownership +
-- visible_in_account + lifecycle guard is unchanged.
--
-- Adding a column to the RETURNS TABLE changes the function's OUT-parameter
-- row type, which CREATE OR REPLACE cannot do -- an explicit DROP is
-- required. Safe: get_my_client_product_artwork has no catalog dependents
-- (it is only ever called as a PostgREST RPC), and the drop + recreate +
-- grants run in one transaction.
--
-- Still deliberately NOT projected: uploaded_by / uploaded_by_type (staff
-- identity), notes, treatment_id, tenant. No cost / margin / supplier data
-- exists on this table.

begin;

drop function if exists public.get_my_client_product_artwork(uuid);

create function public.get_my_client_product_artwork(p_client_product_id uuid)
returns table (
  id                     uuid,
  client_product_id      uuid,
  placement              text,
  revision               integer,
  file_path              text,
  file_name              text,
  file_type              text,
  status                 text,
  is_current             boolean,
  source_client_asset_id uuid,
  created_at             timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_client_id uuid := public.get_my_client_identity();
begin
  if p_client_product_id is null then
    return;
  end if;

  -- Unchanged ownership / visibility / lifecycle guard.
  if not exists (
    select 1
    from public.client_products cp
    where cp.id = p_client_product_id
      and cp.client_id = v_client_id
      and cp.visible_in_account = true
      and cp.status in (
        'ready_for_client_review',
        'client_changes_requested',
        'client_approved',
        'ready_to_order',
        'active'
      )
  ) then
    return;
  end if;

  return query
  select
    a.id,
    a.client_product_id,
    a.placement,
    a.revision,
    a.file_path,
    a.file_name,
    a.file_type,
    a.status,
    a.is_current,
    a.source_client_asset_id,
    a.created_at
  from public.client_product_artwork a
  where a.client_product_id = p_client_product_id
    and a.is_current = true
  order by a.placement;
end;
$$;

revoke all on function public.get_my_client_product_artwork(uuid) from public, anon;
grant execute on function public.get_my_client_product_artwork(uuid) to authenticated;

commit;
