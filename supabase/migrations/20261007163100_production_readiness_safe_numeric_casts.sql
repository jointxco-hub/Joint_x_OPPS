-- Harden production readiness against legacy/blank JSON numeric fields.
-- Blank or malformed commercial values become readiness blockers, never RPC crashes.

begin;

create or replace function public._compute_order_line_production_readiness(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_order public.orders;
  v_line jsonb;
  v_line_id text;
  v_client_product_id uuid;
  cp public.client_products;
  v_snapshots jsonb;
  v_snap jsonb;
  v_blockers jsonb;
  v_warnings jsonb;
  v_status text;
  v_lines jsonb := '[]'::jsonb;
  v_order_readiness text := 'ready';
  v_has_current_approval boolean;
  v_frozen_pb jsonb;
  v_live_pb jsonb;
  v_frozen_qty numeric;
  v_frozen_unit numeric;
  v_component_types text[];
  v_ambiguous boolean;
  v_invalid_artwork boolean;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'ORDER_READINESS_ORDER_NOT_FOUND';
  end if;

  for v_line in
    select * from jsonb_array_elements(coalesce(v_order.products, '[]'::jsonb))
    where coalesce(nullif(value ->> 'line_role', ''), 'product') = 'product'
      and nullif(value ->> 'client_product_id', '') is not null
  loop
    v_line_id := v_line ->> 'line_id';
    v_client_product_id := (v_line ->> 'client_product_id')::uuid;
    v_blockers := '[]'::jsonb;
    v_warnings := '[]'::jsonb;

    select coalesce(jsonb_agg(to_jsonb(s.*) order by s.sort_order, s.created_at), '[]'::jsonb)
      into v_snapshots
      from public.order_line_component_snapshots s
      where s.order_id = p_order_id and s.line_id = v_line_id and s.is_current;

    if jsonb_array_length(v_snapshots) = 0 then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'NO_CURRENT_SNAPSHOT',
        'message', 'This line has no current production snapshot — attach a composition before it can go into production.'
      ));
    else
      select array_agg(distinct s ->> 'component_type') into v_component_types
        from jsonb_array_elements(v_snapshots) s;

      if not ('blank_garment' = any (v_component_types)) then
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code', 'MISSING_BASE_COMPONENT',
          'message', 'No base garment component was found in this line''s frozen composition.'
        ));
      end if;

      for v_snap in select * from jsonb_array_elements(v_snapshots) loop
        -- VARIANT_UNRESOLVED — any stock-linked component with no resolved variant.
        if nullif(v_snap ->> 'inventory_product_id', '') is not null
           and nullif(v_snap ->> 'resolved_inventory_variant_id', '') is null then
          v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
            'code', 'VARIANT_UNRESOLVED',
            'message', format('%s: no exact stock variant is resolved.', coalesce(v_snap ->> 'label', v_snap ->> 'component_type'))
          ));
        end if;

        if v_snap ->> 'component_type' = 'print_service' then
          if nullif(v_snap ->> 'production_method', '') is null then
            v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
              'code', 'PRODUCTION_METHOD_MISSING',
              'message', format('%s: no production method set.', coalesce(v_snap ->> 'label', 'Print component'))
            ));
          end if;
          if nullif(v_snap ->> 'placement', '') is null then
            v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
              'code', 'PLACEMENT_MISSING',
              'message', format('%s: no placement set.', coalesce(v_snap ->> 'label', 'Print component'))
            ));
          end if;

          if jsonb_typeof(coalesce(v_snap -> 'artwork_revision_ids', 'null'::jsonb)) <> 'array'
             or jsonb_array_length(v_snap -> 'artwork_revision_ids') = 0 then
            v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
              'code', 'ARTWORK_MISSING',
              'message', format('%s: required artwork is missing.', coalesce(v_snap ->> 'label', 'Print component'))
            ));
          else
            -- ARTWORK_REVISION_INVALID — a frozen id that no longer exists at all.
            select exists (
              select 1 from jsonb_array_elements_text(v_snap -> 'artwork_revision_ids') aid
              where not exists (
                select 1 from public.client_product_artwork a where a.id = aid::uuid
              )
            ) into v_invalid_artwork;
            if v_invalid_artwork then
              v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
                'code', 'ARTWORK_REVISION_INVALID',
                'message', format('%s: a frozen artwork revision no longer exists.', coalesce(v_snap ->> 'label', 'Print component'))
              ));
            end if;

            -- ARTWORK_PLACEMENT_AMBIGUOUS — two frozen ids canonicalize to the same placement.
            select exists (
              select 1
              from jsonb_array_elements_text(v_snap -> 'artwork_revision_ids') aid
              join public.client_product_artwork a on a.id = aid::uuid
              group by public.canonical_placement(a.placement)
              having count(*) > 1
            ) into v_ambiguous;
            if v_ambiguous then
              v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
                'code', 'ARTWORK_PLACEMENT_AMBIGUOUS',
                'message', format('%s: more than one frozen artwork revision resolves to the same placement.', coalesce(v_snap ->> 'label', 'Print component'))
              ));
            end if;
          end if;
        elsif v_snap ->> 'component_type' not in ('setup_fee') then
          -- OPTIONAL_ARTWORK_ABSENT — non-print component with a placement but no artwork (warning only).
          if nullif(v_snap ->> 'placement', '') is not null
             and (jsonb_typeof(coalesce(v_snap -> 'artwork_revision_ids', 'null'::jsonb)) <> 'array'
                  or jsonb_array_length(v_snap -> 'artwork_revision_ids') = 0) then
            v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
              'code', 'OPTIONAL_ARTWORK_ABSENT',
              'message', format('%s: no artwork attached (optional for this component type).', coalesce(v_snap ->> 'label', v_snap ->> 'component_type'))
            ));
          end if;
        end if;

        -- PRODUCTION_NOTES_ABSENT — custom/mixed method with no spec/instructions (warning only).
        if v_snap ->> 'production_method' in ('custom', 'mixed')
           and nullif(v_snap ->> 'specification', '') is null
           and nullif(v_snap ->> 'production_instructions', '') is null then
          v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
            'code', 'PRODUCTION_NOTES_ABSENT',
            'message', format('%s: no specification or production instructions on file for a custom/mixed method.', coalesce(v_snap ->> 'label', v_snap ->> 'component_type'))
          ));
        end if;
      end loop;
    end if;

    -- ── Live carve-out: commercial state + approval (Phase 2 §5) ───────
    select * into cp from public.client_products where id = v_client_product_id;
    if found then
      -- PRICE_UNRESOLVED — either sub-condition alone blocks: the source
      -- commercial state still requires a quote, OR neither the source
      -- nor the already-frozen line carries a usable price.
      if cp.requires_quote is true
         or (cp.client_price is null and coalesce(case when btrim(coalesce(v_line ->> 'price', '')) ~ '^[+-]?[0-9]+([.][0-9]+)?$' then (v_line ->> 'price')::numeric else 0 end, 0) <= 0) then
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code', 'PRICE_UNRESOLVED',
          'message', 'This product still requires a quote or has no usable price.'
        ));
      end if;

      v_has_current_approval := public._client_product_has_current_approval(v_client_product_id, cp.revision);
      if not v_has_current_approval then
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code', 'CUSTOMER_APPROVAL_MISSING',
          'message', 'The current revision of this product has not been approved by the client.'
        ));
      end if;

      -- SOURCE_CLIENT_PRODUCT_EDITED — informational only; never rewrites the frozen line.
      v_frozen_pb := v_line -> 'price_breakdown';
      if v_frozen_pb is not null and v_frozen_pb ->> 'mode' = 'composed' then
        v_frozen_qty := coalesce(case when btrim(coalesce(v_line ->> 'quantity', '')) ~ '^[+-]?[0-9]+([.][0-9]+)?$' then (v_line ->> 'quantity')::numeric else null end, 1);
        v_frozen_unit := case when btrim(coalesce(v_frozen_pb ->> 'unit_price', v_line ->> 'price', '')) ~ '^[+-]?[0-9]+([.][0-9]+)?$' then coalesce(v_frozen_pb ->> 'unit_price', v_line ->> 'price')::numeric else 0 end;
        v_live_pb := public._xos_freeze_client_product_price_breakdown(v_client_product_id, v_frozen_qty, v_frozen_unit);
        if v_live_pb is null
           or (v_live_pb -> 'per_unit') is distinct from (v_frozen_pb -> 'per_unit') then
          v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
            'code', 'SOURCE_CLIENT_PRODUCT_EDITED',
            'message', 'The source client product has changed since this order line was created; this order keeps its original frozen configuration.'
          ));
        end if;
      end if;
    end if;

    if jsonb_array_length(v_blockers) > 0 then
      v_status := 'blocked';
      v_order_readiness := 'blocked';
    elsif jsonb_array_length(v_warnings) > 0 then
      v_status := 'needs_review';
      if v_order_readiness <> 'blocked' then v_order_readiness := 'ready_with_warnings'; end if;
    else
      v_status := 'ready';
    end if;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'line_id', v_line_id,
      'client_product_id', v_client_product_id,
      'status', v_status,
      'blocking_reasons', v_blockers,
      'warnings', v_warnings,
      'component_count', jsonb_array_length(v_snapshots),
      'evaluated_at', now()
    ));
  end loop;

  return jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'order_readiness', v_order_readiness,
    'evaluated_at', now(),
    'lines', v_lines
  );
end;
$$;

commit;
