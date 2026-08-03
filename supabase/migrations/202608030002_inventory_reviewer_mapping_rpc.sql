-- Lets an authorized reviewer (tenant owner/admin, or app admin) map one
-- legacy public.inventory row to an internal product/variant and an exact
-- supplier product/variant, in a single interactive step.
--
-- The Phase 1 foundation (03-06) deliberately routed *suggesting* a mapping
-- through inventory_stage_legacy_mapping(), which is service_role-only (for
-- a future bulk/parser import pipeline), while *deciding* a suggested
-- mapping went through inventory_decide_legacy_mapping(), authenticated but
-- requiring an existing 'suggested' row. That leaves no path for a human
-- reviewer to map a row interactively through the app today, since nothing
-- has ever staged a suggestion. This function is additive: it does not
-- change either existing function, table, or policy. It reuses the exact
-- same hierarchy-compatibility checks as inventory_decide_legacy_mapping(),
-- and inserts a row that is immediately 'approved' with the caller recorded
-- as reviewer (a human doing their own review in one step, not a silent
-- auto-approval — inventory_can_review_tenant() still gates it).
--
-- Does not touch public.inventory or current_stock.

create or replace function public.inventory_reviewer_map_legacy_item(
  p_tenant_id uuid,
  p_legacy_inventory_id uuid,
  p_inventory_product_id uuid,
  p_inventory_variant_id uuid,
  p_inventory_supplier_product_id uuid,
  p_inventory_supplier_variant_id uuid,
  p_review_notes text default null
)
returns public.inventory_legacy_mappings
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_inventory public.inventory%rowtype;
  v_supplier_name text;
  v_internal_variant_product uuid;
  v_supplier_product_internal_product uuid;
  v_supplier_variant_internal_variant uuid;
  v_mapping public.inventory_legacy_mappings%rowtype;
begin
  if not public.inventory_can_review_tenant(p_tenant_id) then
    raise exception 'Not authorized to map inventory identities for this tenant.' using errcode = '42501';
  end if;
  if p_inventory_product_id is null or p_inventory_variant_id is null
    or p_inventory_supplier_product_id is null or p_inventory_supplier_variant_id is null then
    raise exception 'Internal product, internal variant, supplier product, and supplier variant are all required.' using errcode = '23514';
  end if;

  select * into v_inventory
  from public.inventory
  where id = p_legacy_inventory_id and tenant_id = p_tenant_id;

  if not found then
    raise exception 'Legacy inventory row does not exist in the supplied tenant.' using errcode = '23503';
  end if;

  select inventory_product_id into v_internal_variant_product
  from public.inventory_variants
  where tenant_id = p_tenant_id and id = p_inventory_variant_id;

  select inventory_product_id into v_supplier_product_internal_product
  from public.inventory_supplier_products
  where tenant_id = p_tenant_id and id = p_inventory_supplier_product_id;

  select inventory_variant_id into v_supplier_variant_internal_variant
  from public.inventory_supplier_variants
  where tenant_id = p_tenant_id
    and id = p_inventory_supplier_variant_id
    and inventory_supplier_product_id = p_inventory_supplier_product_id;

  if v_internal_variant_product is distinct from p_inventory_product_id
    or v_supplier_product_internal_product is distinct from p_inventory_product_id
    or v_supplier_variant_internal_variant is distinct from p_inventory_variant_id then
    raise exception 'Internal and supplier identities are not one compatible hierarchy.' using errcode = '23514';
  end if;

  if v_inventory.preferred_supplier_id is not null then
    select coalesce(to_jsonb(s)->>'name', to_jsonb(s)->>'vendor')
      into v_supplier_name
    from public.suppliers s
    where s.id = v_inventory.preferred_supplier_id and s.tenant_id = p_tenant_id;
  end if;

  insert into public.inventory_legacy_mappings (
    tenant_id, legacy_inventory_id,
    original_name, original_sku, original_supplier_id, original_supplier_name,
    original_category, original_sizes, original_colours, original_location,
    original_unit, original_recorded_quantity,
    proposed_inventory_product_id, proposed_inventory_variant_id,
    proposed_supplier_product_id, proposed_supplier_variant_id,
    parser_version, review_status, reviewer_auth_user_id, reviewer_email,
    review_notes, reviewed_at, mapping_version, batch_id, idempotency_key
  ) values (
    p_tenant_id, v_inventory.id,
    v_inventory.name, v_inventory.sku, v_inventory.preferred_supplier_id, v_supplier_name,
    v_inventory.category, coalesce(v_inventory.sizes_available, '{}'),
    coalesce(v_inventory.colors_available, '{}'), v_inventory.location,
    v_inventory.unit, v_inventory.current_stock,
    p_inventory_product_id, p_inventory_variant_id,
    p_inventory_supplier_product_id, p_inventory_supplier_variant_id,
    'manual_reviewer_v1', 'approved', auth.uid(), auth.jwt() ->> 'email',
    p_review_notes, now(),
    coalesce((
      select max(m.mapping_version) + 1
      from public.inventory_legacy_mappings m
      where m.tenant_id = p_tenant_id and m.legacy_inventory_id = p_legacy_inventory_id
    ), 1),
    gen_random_uuid(), gen_random_uuid()::text
  )
  returning * into v_mapping;

  return v_mapping;
end;
$$;

revoke all on function public.inventory_reviewer_map_legacy_item(uuid, uuid, uuid, uuid, uuid, uuid, text)
  from public, anon;
grant execute on function public.inventory_reviewer_map_legacy_item(uuid, uuid, uuid, uuid, uuid, uuid, text)
  to authenticated;
