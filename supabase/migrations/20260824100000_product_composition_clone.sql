-- Product Composition clone primitive (Phase 2A of the reusable
-- client-product/variant architecture). Staff currently have no way to
-- reuse an existing product_components setup - every new configuration
-- with a near-identical production structure has to be rebuilt from
-- scratch. This becomes unacceptable once variant families (e.g. SFR
-- across multiple GSMs/colours) are introduced.
--
-- duplicate_product_composition(source, target) is one atomic,
-- authorization-checked, tenant/client-scoped clone of a client_product's
-- product_components rows onto another client_product. Deliberately
-- narrow: v1 clones the full composition only, refuses if the target
-- already has any rows (active or inactive), and never touches artwork,
-- pricing, or lifecycle state on either product_component itself.
--
-- Explicitly NOT built here: garment variants, treatments, basket, size
-- matrix. This is the reusable structural primitive those will build on
-- top of later - the RPC takes two arbitrary client_product ids, not
-- anything JET-specific.

begin;

create or replace function public.duplicate_product_composition(
  p_source_client_product_id uuid,
  p_target_client_product_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_source public.client_products;
  v_target public.client_products;
  v_actor_email text;
  v_actor_name text;
  v_actor_uid uuid;
  v_source_component_count integer;
  v_target_component_count integer;
  v_cloned_ids uuid[];
  v_cloned_count integer;
  v_event_id uuid;
begin
  -- ── Authenticated staff actor, resolved server-side only ──────────
  -- Same pattern as inventory_consume_reservation (202608220002-family):
  -- never trust a client-supplied identity, never accept an
  -- unresolvable auth.uid().
  v_actor_uid := auth.uid();
  select u.user_email, u.full_name into v_actor_email, v_actor_name
  from public.users u
  where u.auth_user_id = v_actor_uid and coalesce(u.is_active, true)
  order by u.created_at asc
  limit 1;
  if v_actor_email is null then
    raise exception 'COMPOSITION_CLONE_ACTOR_UNRESOLVED: authenticated user does not resolve to a valid OPPS staff identity';
  end if;

  -- ── Source / target existence ──────────────────────────────────────
  select * into v_source from public.client_products where id = p_source_client_product_id;
  if not found then
    raise exception 'COMPOSITION_CLONE_SOURCE_NOT_FOUND: source client_product % does not exist', p_source_client_product_id;
  end if;

  select * into v_target from public.client_products where id = p_target_client_product_id;
  if not found then
    raise exception 'COMPOSITION_CLONE_TARGET_NOT_FOUND: target client_product % does not exist', p_target_client_product_id;
  end if;

  -- ── Reviewer/admin permission against BOTH tenant contexts ─────────
  -- inventory_can_review_tenant() is the exact function
  -- product_components' own INSERT/UPDATE RLS policies already require
  -- (owner/admin tenant membership or app admin) - reused, not
  -- reinvented, and checked against both sides so a staff member with
  -- access to only one of the two tenants cannot clone across.
  if v_source.tenant_id is null or not public.inventory_can_review_tenant(v_source.tenant_id) then
    raise exception 'COMPOSITION_CLONE_FORBIDDEN: no reviewer access to source tenant';
  end if;
  if v_target.tenant_id is null or not public.inventory_can_review_tenant(v_target.tenant_id) then
    raise exception 'COMPOSITION_CLONE_FORBIDDEN: no reviewer access to target tenant';
  end if;

  -- ── Structural guards ────────────────────────────────────────────
  if p_source_client_product_id = p_target_client_product_id then
    raise exception 'COMPOSITION_CLONE_SAME_PRODUCT: source and target must be different client products';
  end if;

  if v_source.tenant_id is distinct from v_target.tenant_id then
    raise exception 'COMPOSITION_CLONE_CROSS_TENANT: source and target must belong to the same tenant';
  end if;

  -- v1 deliberately also requires the same client, not just the same
  -- tenant - nothing in product_components is client-specific today
  -- (no price, no artwork), so there is no correctness reason to permit
  -- cross-client cloning yet, and narrowing this is strictly safer than
  -- widening it later. No override flag in this phase.
  if v_source.client_id is distinct from v_target.client_id then
    raise exception 'COMPOSITION_CLONE_CROSS_CLIENT: source and target must belong to the same client';
  end if;

  select count(*) into v_target_component_count
  from public.product_components
  where client_product_id = p_target_client_product_id;
  if v_target_component_count > 0 then
    raise exception 'Target product already has a composition.';
  end if;

  select count(*) into v_source_component_count
  from public.product_components
  where client_product_id = p_source_client_product_id;
  if v_source_component_count = 0 then
    raise exception 'COMPOSITION_CLONE_EMPTY_SOURCE: source product has no components to clone';
  end if;

  -- ── Clone: one INSERT ... SELECT, atomic by construction - no loop,
  -- no partial-clone window, nothing to retry into a half-done state ──
  insert into public.product_components (
    id, tenant_id, client_product_id, component_type, production_method,
    placement, production_colour, specification, production_instructions,
    default_sell_price, quantity_per_unit, sort_order, inventory_product_id,
    fixed_inventory_variant_id, label, notes, is_active, created_by,
    created_at, updated_at, billing_mode
  )
  select
    gen_random_uuid(), v_target.tenant_id, p_target_client_product_id, component_type, production_method,
    placement, production_colour, specification, production_instructions,
    default_sell_price, quantity_per_unit, sort_order, inventory_product_id,
    fixed_inventory_variant_id, label, notes, is_active, v_actor_uid,
    now(), now(), billing_mode
  from public.product_components
  where client_product_id = p_source_client_product_id;

  select array_agg(id) into v_cloned_ids
  from public.product_components
  where client_product_id = p_target_client_product_id;
  v_cloned_count := coalesce(array_length(v_cloned_ids, 1), 0);

  -- ── Activity event - same transaction as the clone, existing generic
  -- log, no new audit subsystem ───────────────────────────────────────
  insert into public.opps_activity_events (
    tenant_id, actor_email, actor_name, event_type, entity_type, entity_id, summary, metadata
  ) values (
    v_target.tenant_id, v_actor_email, v_actor_name, 'product_composition_cloned', 'client_products', p_target_client_product_id,
    format('%s cloned %s composition component(s) from %s to %s', coalesce(v_actor_name, 'Staff'), v_cloned_count, v_source.client_facing_name, v_target.client_facing_name),
    jsonb_build_object(
      'source_client_product_id', p_source_client_product_id,
      'target_client_product_id', p_target_client_product_id,
      'cloned_component_count', v_cloned_count,
      'cloned_component_ids', to_jsonb(v_cloned_ids)
    )
  )
  returning id into v_event_id;

  return jsonb_build_object(
    'ok', true,
    'source_client_product_id', p_source_client_product_id,
    'target_client_product_id', p_target_client_product_id,
    'cloned_count', v_cloned_count,
    'component_ids', to_jsonb(v_cloned_ids),
    'activity_event_id', v_event_id
  );
end;
$function$;

revoke execute on function public.duplicate_product_composition(uuid, uuid) from public, anon;
grant execute on function public.duplicate_product_composition(uuid, uuid) to authenticated;

commit;
