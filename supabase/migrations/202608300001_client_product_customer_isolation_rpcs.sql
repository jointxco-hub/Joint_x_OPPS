-- Phase 1F-C1 — Customer Product privacy isolation.
--
-- Live incident: a customer whose Supabase Auth identity is ALSO Joint X
-- tenant staff (e.g. jointx.co@gmail.com) saw every Joint X client's
-- Client Products in "My Products", not just their own. Root cause: the
-- customer surface issued a raw `select * from client_products` on the
-- customer auth client, so RLS was the only gate — and the permissive
-- "Staff manage client products" policy (is_opps_staff()/can_access_tenant
-- based, FOR ALL, so it also grants SELECT) matched every row in a tenant
-- that identity can access. Unfiltered select + permissive-policy union =
-- the whole tenant's catalogue.
--
-- Fix (this migration): move every customer-facing Client Product read
-- onto SECURITY DEFINER RPCs that resolve the caller's client identity
-- SOLELY from auth.uid(), require EXACTLY ONE matching client row (fail
-- closed on zero or many), and scope + project server-side. Because the
-- reads no longer touch the table directly from the customer session, the
-- staff policy can never participate in a customer read.
--
-- Explicitly NOT in this migration (deferred to later 1F-C / 1G-A passes):
--   * No change to any RLS policy (staff or customer) on client_products,
--     client_product_artwork, or client_product_order_links.
--   * No clients.xlab_auth_user_id UNIQUE constraint (production pre-check
--     confirmed no duplicate non-null mappings today; durability hardening
--     is Phase 1G-A).
--   * No client merge / data repair.
--   * No PayFast / order / paid-state / sync-to-opps involvement — none of
--     those objects are referenced below.
--
-- The customer-visible lifecycle set and the "visible_in_account = true"
-- gate below are the SAME conditions the existing customer SELECT policy
-- "Client can view own visible products" (202608120004) already enforces —
-- re-stated here so the RPC is self-contained and correct even if it is
-- ever called from a context where that policy would not apply.

begin;

-- ---------------------------------------------------------------------
-- 1. Identity resolution — auth.uid() -> exactly one clients row.
-- ---------------------------------------------------------------------
-- No client_id argument anywhere in this feature: identity is derived,
-- never supplied. current_client_id() (202608110001) is deliberately NOT
-- reused here — it does `limit 1` with no ORDER BY and no uniqueness
-- guarantee, so it would silently pick one of several rows. This function
-- fails closed instead: zero rows OR more than one row both raise
-- CLIENT_IDENTITY_UNRESOLVED, and callers render "no products" rather
-- than anyone else's data.
create or replace function public.get_my_client_identity()
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_ids uuid[];
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'CLIENT_IDENTITY_UNRESOLVED';
  end if;

  select array_agg(c.id) into v_ids
  from public.clients c
  where c.xlab_auth_user_id = auth.uid();

  if v_ids is null or array_length(v_ids, 1) is distinct from 1 then
    raise exception using errcode = '42501', message = 'CLIENT_IDENTITY_UNRESOLVED';
  end if;

  return v_ids[1];
end;
$$;

revoke all on function public.get_my_client_identity() from public, anon;
grant execute on function public.get_my_client_identity() to authenticated;

-- ---------------------------------------------------------------------
-- 2. Customer-safe Client Product list.
-- ---------------------------------------------------------------------
-- Explicit column projection only — never `select *`. Deliberately
-- EXCLUDES: internal_name, internal_notes, production_instructions,
-- packaging_instructions, special_instructions, tenant_id, xlab_product_id,
-- opps_product_id, primary_mockup_asset_id, created_by/updated_by/
-- approved_by/approved_at, created_from_order_id, revision, last_ordered_at.
-- The Start Order RPC (start_client_product_order, 202608170003) re-reads
-- the product server-side for pricing/spec/instructions, so the client
-- never needs the withheld fields.
create or replace function public.get_my_client_products()
returns table (
  id                 uuid,
  client_id          uuid,
  client_facing_name text,
  status             text,
  client_price       numeric,
  currency           text,
  requires_quote     boolean,
  reorder_enabled    boolean,
  visible_in_account boolean,
  primary_mockup_url text,
  available_variants jsonb,
  default_variants   jsonb,
  print_method       text,
  placement          text,
  garment_material   text,
  garment_gsm        text,
  garment_color      text,
  print_size         text,
  print_locations    integer,
  updated_at         timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_client_id uuid := public.get_my_client_identity();
begin
  return query
  select
    cp.id,
    cp.client_id,
    cp.client_facing_name,
    cp.status,
    cp.client_price,
    cp.currency,
    cp.requires_quote,
    cp.reorder_enabled,
    cp.visible_in_account,
    cp.primary_mockup_url,
    cp.available_variants,
    cp.default_variants,
    cp.print_method,
    cp.placement,
    cp.garment_material,
    cp.garment_gsm,
    cp.garment_color,
    cp.print_size,
    cp.print_locations,
    cp.updated_at
  from public.client_products cp
  where cp.client_id = v_client_id
    and cp.visible_in_account = true
    and cp.status in (
      'ready_for_client_review',
      'client_changes_requested',
      'client_approved',
      'ready_to_order',
      'active'
    )
  order by cp.updated_at desc;
end;
$$;

revoke all on function public.get_my_client_products() from public, anon;
grant execute on function public.get_my_client_products() to authenticated;

-- ---------------------------------------------------------------------
-- 3. Customer-safe single Client Product by id.
-- ---------------------------------------------------------------------
-- p_id is the ONLY argument and is never trusted for ownership: the row
-- is returned only when it also belongs to the resolved identity and
-- passes the same visibility/lifecycle gate. A foreign id, or an id for a
-- draft/archived product, yields zero rows (caller treats that as
-- "not found").
create or replace function public.get_my_client_product(p_id uuid)
returns table (
  id                 uuid,
  client_id          uuid,
  client_facing_name text,
  status             text,
  client_price       numeric,
  currency           text,
  requires_quote     boolean,
  reorder_enabled    boolean,
  visible_in_account boolean,
  primary_mockup_url text,
  available_variants jsonb,
  default_variants   jsonb,
  print_method       text,
  placement          text,
  garment_material   text,
  garment_gsm        text,
  garment_color      text,
  print_size         text,
  print_locations    integer,
  updated_at         timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_client_id uuid := public.get_my_client_identity();
begin
  if p_id is null then
    return;
  end if;

  return query
  select
    cp.id,
    cp.client_id,
    cp.client_facing_name,
    cp.status,
    cp.client_price,
    cp.currency,
    cp.requires_quote,
    cp.reorder_enabled,
    cp.visible_in_account,
    cp.primary_mockup_url,
    cp.available_variants,
    cp.default_variants,
    cp.print_method,
    cp.placement,
    cp.garment_material,
    cp.garment_gsm,
    cp.garment_color,
    cp.print_size,
    cp.print_locations,
    cp.updated_at
  from public.client_products cp
  where cp.id = p_id
    and cp.client_id = v_client_id
    and cp.visible_in_account = true
    and cp.status in (
      'ready_for_client_review',
      'client_changes_requested',
      'client_approved',
      'ready_to_order',
      'active'
    );
end;
$$;

revoke all on function public.get_my_client_product(uuid) from public, anon;
grant execute on function public.get_my_client_product(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Customer-safe current/approved artwork for one owned product.
-- ---------------------------------------------------------------------
-- Ownership is re-checked server-side against the parent client_products
-- row (resolved identity + visibility + lifecycle) BEFORE any artwork row
-- is returned. Mirrors the existing customer artwork SELECT policy exactly:
-- only is_current = true AND status = 'approved' rows are ever returned,
-- so a pending client-uploaded revision (or a superseded/rejected one) is
-- never exposed. file_path is returned as-is (a storage reference); the
-- client resolves it to a signed URL through the existing
-- getMyClientArtworkSignedUrl path — no change to that here.
create or replace function public.get_my_client_product_artwork(p_client_product_id uuid)
returns table (
  id                uuid,
  client_product_id uuid,
  placement         text,
  revision          integer,
  file_path         text,
  file_name         text,
  file_type         text,
  status            text,
  is_current        boolean,
  created_at        timestamptz
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
    a.created_at
  from public.client_product_artwork a
  where a.client_product_id = p_client_product_id
    and a.is_current = true
    and a.status = 'approved'
  order by a.placement;
end;
$$;

revoke all on function public.get_my_client_product_artwork(uuid) from public, anon;
grant execute on function public.get_my_client_product_artwork(uuid) to authenticated;

commit;
