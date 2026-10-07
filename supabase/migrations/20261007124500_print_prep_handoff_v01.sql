-- PRINT PREP PRODUCTION HANDOFF v0.1
-- Read-only, staff-only, tenant-scoped payload generator for a single
-- frozen production component. OPPS remains the source of truth.
-- No production rows are mutated by this function.

begin;

create or replace function public.get_print_prep_handoff(
  p_order_id uuid,
  p_line_id text,
  p_snapshot_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_order public.orders;
  v_line jsonb;
  v_snapshot public.order_line_component_snapshots;
  v_readiness jsonb;
  v_line_readiness jsonb;
  v_client_name text;
  v_artwork_assets jsonb := '[]'::jsonb;
  v_line_qty numeric := 1;
  v_qty_per_unit numeric := 1;
  v_piece_qty numeric := 1;
begin
  if not public.is_opps_staff() then
    raise exception using errcode = '42501', message = 'PRINT_PREP_HANDOFF_FORBIDDEN: no staff access';
  end if;

  if p_order_id is null or nullif(trim(p_line_id), '') is null or p_snapshot_id is null then
    raise exception using errcode = '22023', message = 'PRINT_PREP_HANDOFF_INVALID_ARGUMENTS';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'PRINT_PREP_HANDOFF_ORDER_NOT_FOUND';
  end if;

  if v_order.tenant_id is null or not public.can_access_tenant(v_order.tenant_id) then
    raise exception using errcode = '42501', message = 'PRINT_PREP_HANDOFF_TENANT_DENIED';
  end if;

  select value
    into v_line
  from jsonb_array_elements(coalesce(v_order.products, '[]'::jsonb))
  where value ->> 'line_id' = p_line_id
  limit 1;

  if v_line is null then
    raise exception using errcode = 'P0001', message = 'PRINT_PREP_HANDOFF_LINE_NOT_FOUND';
  end if;

  select *
    into v_snapshot
  from public.order_line_component_snapshots
  where id = p_snapshot_id
    and order_id = p_order_id
    and line_id = p_line_id
    and is_current = true;

  if not found then
    raise exception using errcode = 'P0001', message = 'PRINT_PREP_HANDOFF_SNAPSHOT_NOT_FOUND';
  end if;

  if v_snapshot.component_type is distinct from 'print_service' then
    raise exception using errcode = 'P0001', message = 'PRINT_PREP_HANDOFF_NOT_PRINT_COMPONENT';
  end if;

  -- Reuse the existing canonical readiness computation. Never duplicate
  -- or reinterpret blocker logic here.
  v_readiness := public._compute_order_line_production_readiness(p_order_id);

  select value
    into v_line_readiness
  from jsonb_array_elements(coalesce(v_readiness -> 'lines', '[]'::jsonb))
  where value ->> 'line_id' = p_line_id
  limit 1;

  if v_line_readiness is null then
    raise exception using errcode = 'P0001', message = 'PRINT_PREP_HANDOFF_LINE_NOT_ELIGIBLE';
  end if;

  if v_line_readiness ->> 'status' = 'blocked' then
    raise exception using
      errcode = 'P0001',
      message = format(
        'PRINT_PREP_HANDOFF_BLOCKED: %s',
        coalesce(
          (
            select string_agg(r ->> 'message', '; ')
            from jsonb_array_elements(coalesce(v_line_readiness -> 'blocking_reasons', '[]'::jsonb)) r
          ),
          'production readiness failed'
        )
      );
  end if;

  select c.name
    into v_client_name
  from public.clients c
  where c.id = v_order.client_id;

  if cardinality(v_snapshot.artwork_revision_ids) > 0 then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'revision_id', a.id,
          'placement', a.placement,
          'display_name', coalesce(a.file_name, 'Artwork'),
          'file_ref', coalesce(a.source_client_asset_id::text, a.file_path),
          'source_client_asset_id', a.source_client_asset_id,
          'file_path', a.file_path,
          'file_type', a.file_type,
          'status', a.status,
          'revision', a.revision
        )
        order by a.created_at, a.id
      ),
      '[]'::jsonb
    )
    into v_artwork_assets
    from public.client_product_artwork a
    where a.id = any (v_snapshot.artwork_revision_ids);
  end if;

  v_line_qty := greatest(coalesce(nullif(v_line ->> 'quantity', '')::numeric, 1), 0);
  v_qty_per_unit := greatest(coalesce(v_snapshot.quantity_per_unit, 1), 0);
  v_piece_qty := v_line_qty * v_qty_per_unit;

  return jsonb_build_object(
    'contract_version', '0.1',
    'handoff_id', gen_random_uuid(),
    'issued_at', now(),
    'tenant_id', v_order.tenant_id,
    'order', jsonb_build_object(
      'id', v_order.id,
      'line_id', p_line_id,
      'line_name', v_line ->> 'name',
      'client_id', v_order.client_id,
      'customer_display_name', coalesce(v_client_name, v_line ->> 'client_name', 'Client'),
      'line_quantity', v_line_qty
    ),
    'production_component', jsonb_build_object(
      'snapshot_id', v_snapshot.id,
      'client_product_id', v_snapshot.client_product_id,
      'label', v_snapshot.label,
      'component_type', v_snapshot.component_type,
      'production_method', v_snapshot.production_method,
      'placement', v_snapshot.placement,
      'production_colour', v_snapshot.production_colour,
      'specification', v_snapshot.specification,
      'production_instructions', v_snapshot.production_instructions,
      'revision', v_snapshot.revision
    ),
    'artwork', jsonb_build_object(
      'revision_ids', to_jsonb(coalesce(v_snapshot.artwork_revision_ids, '{}'::uuid[])),
      'assets', v_artwork_assets
    ),
    'production', jsonb_build_object(
      'target_width_mm', null,
      'target_height_mm', null,
      'resize_mode', 'size_as_one',
      'line_quantity', v_line_qty,
      'quantity_per_unit', v_qty_per_unit,
      'piece_quantity', v_piece_qty
    ),
    'readiness', jsonb_build_object(
      'status', v_line_readiness ->> 'status',
      'warnings', coalesce(v_line_readiness -> 'warnings', '[]'::jsonb)
    ),
    'adapter', jsonb_build_object(
      'preferred', null
    )
  );
end;
$$;

revoke all on function public.get_print_prep_handoff(uuid, text, uuid) from public, anon;
grant execute on function public.get_print_prep_handoff(uuid, text, uuid) to authenticated;

commit;
