-- QS-10 Quick Solution Cafe staff manual-order RPCs
-- Function bodies exported from validated staging.
-- No tenant UUIDs or environment project refs are embedded.

begin;

do $qs10_preflight$
begin
  if to_regclass('public.tenants') is null then
    raise exception
      'QS10 prerequisite missing: public.tenants';
  end if;

  if to_regclass(
    'commerce.service_product_configs'
  ) is null then
    raise exception
      'QS10 prerequisite missing: commerce.service_product_configs';
  end if;

  if to_regclass(
    'commerce.products'
  ) is null then
    raise exception
      'QS10 prerequisite missing: commerce.products';
  end if;

  if to_regprocedure(
    'public.has_tenant_permission(uuid,text)'
  ) is null then
    raise exception
      'QS10 prerequisite missing: public.has_tenant_permission(uuid,text)';
  end if;

  if not exists (
    select 1
    from public.tenants
    where slug = 'quick-solution'
      and status = 'active'
  ) then
    raise exception
      'QS10 prerequisite missing: active quick-solution tenant';
  end if;
end
$qs10_preflight$;

CREATE OR REPLACE FUNCTION "public"."get_quick_solution_staff_catalog"("p_tenant_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_slug text;
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'Staff sign-in is required.';
  end if;

  select t.slug
  into v_slug
  from public.tenants t
  where t.id = p_tenant_id
    and t.status = 'active'
  limit 1;

  if v_slug is distinct from 'quick-solution' then
    raise exception using
      errcode = '22023',
      message = 'Quick Solution workspace was not found.';
  end if;

  if not public.has_tenant_permission(
    p_tenant_id,
    'orders.write'
  ) then
    raise exception using
      errcode = '42501',
      message = 'You do not have permission to create Quick Solution orders.';
  end if;

  return jsonb_build_object(
    'tenantId', p_tenant_id,
    'products', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', c.source_key,
          'commerceProductId', p.id,
          'name', p.name,
          'description', coalesce(
            p.description,
            c.customer_definition->>'description'
          ),
          'pricingVersion', c.pricing_version,
          'customerDefinition', c.customer_definition,
          'operationsDefinition', c.operations_definition
        )
        order by c.sort_order, p.name
      )
      from commerce.service_product_configs c
      join commerce.products p
        on p.id = c.product_id
       and p.tenant_id = c.tenant_id
      where c.tenant_id = p_tenant_id
        and c.status = 'published'
        and p.status = 'published'
        and p.availability = 'available'
    ), '[]'::jsonb)
  );
end
$$;

CREATE OR REPLACE FUNCTION "public"."quote_quick_solution_staff_item"("p_tenant_id" "uuid", "p_product_key" "text", "p_configuration" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_slug text;
  v_product_id uuid;
  v_product_name text;
  v_pricing_version text;
  v_pricing jsonb;
  v_strategy text;
  v_total numeric := 0;
  v_summary text := '';
  v_lines jsonb := '[]'::jsonb;
  v_metrics jsonb := '{}'::jsonb;

  v_width numeric;
  v_height numeric;
  v_raw_area numeric;
  v_billable_area numeric;
  v_base numeric;
  v_service_fees numeric;
  v_turn_mult numeric;

  v_pages integer;
  v_copies integer;
  v_rate numeric;
  v_side_mult numeric;
  v_finish_fee numeric;
  v_printed_pages numeric;

  v_quantity integer;
  v_unit numeric;
  v_discount numeric;

  v_material text;
  v_finishing text;
  v_artwork text;
  v_turnaround text;
  v_print_mode text;
  v_sides text;
  v_finish text;
  v_stock text;
  v_garment text;
  v_front text;
  v_back text;
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'Staff sign-in is required.';
  end if;

  select t.slug
  into v_slug
  from public.tenants t
  where t.id = p_tenant_id
    and t.status = 'active'
  limit 1;

  if v_slug is distinct from 'quick-solution' then
    raise exception using
      errcode = '22023',
      message = 'Quick Solution workspace was not found.';
  end if;

  if not public.has_tenant_permission(
    p_tenant_id,
    'orders.write'
  ) then
    raise exception using
      errcode = '42501',
      message = 'You do not have permission to price Quick Solution orders.';
  end if;

  if nullif(trim(coalesce(p_product_key, '')), '') is null then
    raise exception using
      errcode = '22023',
      message = 'Quick Solution service is required.';
  end if;

  if p_configuration is null
     or jsonb_typeof(p_configuration) is distinct from 'object' then
    raise exception using
      errcode = '22023',
      message = 'Configuration must be a JSON object.';
  end if;

  select
    p.id,
    p.name,
    c.pricing_version,
    c.pricing_definition
  into
    v_product_id,
    v_product_name,
    v_pricing_version,
    v_pricing
  from commerce.service_product_configs c
  join commerce.products p
    on p.id = c.product_id
   and p.tenant_id = c.tenant_id
  where c.tenant_id = p_tenant_id
    and c.source_key = trim(p_product_key)
    and c.status = 'published'
    and p.status = 'published'
    and p.availability = 'available'
  limit 1;

  if v_product_id is null then
    raise exception using
      errcode = '22023',
      message = 'Product is not available.';
  end if;

  v_strategy := upper(coalesce(v_pricing->>'strategy', ''));

  if v_strategy = 'PER_AREA' then
    begin
      v_width := (p_configuration->>'width')::numeric;
      v_height := (p_configuration->>'height')::numeric;
    exception when others then
      raise exception using
        errcode = '22023',
        message = 'Width and height must be valid numbers.';
    end;

    if v_width <= 0
       or v_height <= 0
       or v_width > 20
       or v_height > 20 then
      raise exception using
        errcode = '22023',
        message = 'Banner dimensions are outside the supported range.';
    end if;

    v_material := coalesce(
      nullif(p_configuration->>'material',''),
      'standard'
    );
    v_finishing := coalesce(
      nullif(p_configuration->>'finishing',''),
      'hem-eyelets'
    );
    v_artwork := coalesce(
      nullif(p_configuration->>'artwork',''),
      'ready'
    );
    v_turnaround := coalesce(
      nullif(p_configuration->>'turnaround',''),
      'standard'
    );

    if not coalesce((v_pricing->'materials') ? v_material, false)
       or not coalesce((v_pricing->'finishing') ? v_finishing, false)
       or not coalesce((v_pricing->'artwork') ? v_artwork, false)
       or not coalesce((v_pricing->'turnaround') ? v_turnaround, false) then
      raise exception using
        errcode = '22023',
        message = 'One or more banner options are invalid.';
    end if;

    v_raw_area := v_width * v_height;
    v_billable_area := greatest(
      v_raw_area,
      coalesce(
        (v_pricing->>'minimumBillableArea')::numeric,
        0
      )
    );

    v_base :=
      v_billable_area *
      coalesce((v_pricing->>'baseRate')::numeric, 0) *
      coalesce(
        (v_pricing->'materials'->v_material->>'multiplier')::numeric,
        1
      );

    v_service_fees :=
      coalesce(
        (v_pricing->'finishing'->v_finishing->>'fee')::numeric,
        0
      ) +
      coalesce(
        (v_pricing->'artwork'->v_artwork->>'fee')::numeric,
        0
      );

    v_turn_mult := coalesce(
      (v_pricing->'turnaround'->v_turnaround->>'multiplier')::numeric,
      1
    );

    v_total := round(
      (v_base + v_service_fees) * v_turn_mult,
      2
    );

    v_summary :=
      to_char(v_raw_area, 'FM999990.00') ||
      'm² actual · ' ||
      to_char(v_billable_area, 'FM999990.00') ||
      'm² billable';

    v_lines := jsonb_build_array(
      jsonb_build_object(
        'label','Print + material',
        'value',round(v_base,2)
      ),
      jsonb_build_object(
        'label','Finishing + artwork',
        'value',round(v_service_fees,2)
      ),
      jsonb_build_object(
        'label','Turnaround',
        'text',v_turnaround
      )
    );

    v_metrics := jsonb_build_object(
      'rawArea',v_raw_area,
      'billableArea',v_billable_area
    );

  elsif v_strategy = 'PER_PAGE' then
    begin
      v_pages := greatest(
        coalesce((p_configuration->>'pages')::integer, 1),
        1
      );
      v_copies := greatest(
        coalesce((p_configuration->>'copies')::integer, 1),
        1
      );
    exception when others then
      raise exception using
        errcode = '22023',
        message = 'Pages and copies must be whole numbers.';
    end;

    if v_pages > 1000 or v_copies > 500 then
      raise exception using
        errcode = '22023',
        message = 'Document quantity is outside the supported range.';
    end if;

    v_print_mode := coalesce(
      nullif(p_configuration->>'printMode',''),
      'bw'
    );
    v_sides := coalesce(
      nullif(p_configuration->>'sides',''),
      'single'
    );
    v_finish := coalesce(
      nullif(p_configuration->>'finish',''),
      'none'
    );

    if not coalesce((v_pricing->'rates') ? v_print_mode, false)
       or not coalesce((v_pricing->'sides') ? v_sides, false)
       or not coalesce((v_pricing->'finishes') ? v_finish, false) then
      raise exception using
        errcode = '22023',
        message = 'One or more document options are invalid.';
    end if;

    v_rate := coalesce(
      (v_pricing->'rates'->v_print_mode->>'rate')::numeric,
      0
    );
    v_side_mult := coalesce(
      (v_pricing->'sides'->v_sides->>'multiplier')::numeric,
      1
    );
    v_finish_fee := coalesce(
      (v_pricing->'finishes'->v_finish->>'fee')::numeric,
      0
    );

    v_printed_pages := v_pages * v_copies;
    v_base := v_printed_pages * v_rate * v_side_mult;
    v_service_fees := v_finish_fee * v_copies;
    v_total := round(v_base + v_service_fees, 2);

    v_summary :=
      v_pages::text ||
      ' page' ||
      case when v_pages = 1 then '' else 's' end ||
      ' × ' ||
      v_copies::text ||
      ' cop' ||
      case when v_copies = 1 then 'y' else 'ies' end;

    v_lines := jsonb_build_array(
      jsonb_build_object(
        'label',v_print_mode,
        'value',round(v_base,2)
      ),
      jsonb_build_object(
        'label',v_sides,
        'text',
        case
          when v_sides='double' then 'paper-saving option'
          else 'standard'
        end
      ),
      jsonb_build_object(
        'label',v_finish,
        'value',round(v_service_fees,2)
      )
    );

    v_metrics := jsonb_build_object(
      'pages',v_pages,
      'copies',v_copies,
      'printedPages',v_printed_pages
    );

  elsif v_strategy = 'TIERED' then
    begin
      v_quantity := greatest(
        coalesce(
          nullif(p_configuration->>'quantity','')::integer,
          100
        ),
        1
      );
    exception when others then
      raise exception using
        errcode = '22023',
        message = 'Quantity must be a whole number.';
    end;

    v_stock := coalesce(
      nullif(p_configuration->>'stock',''),
      'standard'
    );
    v_finish := coalesce(
      nullif(p_configuration->>'finish',''),
      'standard'
    );
    v_artwork := coalesce(
      nullif(p_configuration->>'artwork',''),
      'ready'
    );

    if not coalesce(
         (v_pricing->'quantities') ? v_quantity::text,
         false
       )
       or not coalesce((v_pricing->'stock') ? v_stock, false)
       or not coalesce((v_pricing->'finishes') ? v_finish, false)
       or not coalesce((v_pricing->'artwork') ? v_artwork, false) then
      raise exception using
        errcode = '22023',
        message = 'One or more business-card options are invalid.';
    end if;

    v_base :=
      coalesce(
        (v_pricing->'quantities'->v_quantity::text->>'total')::numeric,
        0
      ) *
      coalesce(
        (v_pricing->'stock'->v_stock->>'multiplier')::numeric,
        1
      );

    v_service_fees :=
      coalesce(
        (v_pricing->'finishes'->v_finish->>'fee')::numeric,
        0
      ) +
      coalesce(
        (v_pricing->'artwork'->v_artwork->>'fee')::numeric,
        0
      );

    v_total := round(v_base + v_service_fees, 2);
    v_summary := v_quantity::text || ' cards · ' || v_stock;

    v_lines := jsonb_build_array(
      jsonb_build_object(
        'label','Cards',
        'value',round(v_base,2)
      ),
      jsonb_build_object(
        'label',v_finish,
        'value',
        coalesce(
          (v_pricing->'finishes'->v_finish->>'fee')::numeric,
          0
        )
      ),
      jsonb_build_object(
        'label',v_artwork,
        'value',
        coalesce(
          (v_pricing->'artwork'->v_artwork->>'fee')::numeric,
          0
        )
      )
    );

    v_metrics := jsonb_build_object(
      'quantity',v_quantity
    );

  elsif v_strategy = 'CONFIGURABLE' then
    begin
      v_quantity := greatest(
        coalesce((p_configuration->>'quantity')::integer, 1),
        1
      );
    exception when others then
      raise exception using
        errcode = '22023',
        message = 'Quantity must be a whole number.';
    end;

    if v_quantity > 250 then
      raise exception using
        errcode = '22023',
        message = 'T-shirt quantity is outside the supported range.';
    end if;

    v_garment := coalesce(
      nullif(p_configuration->>'garment',''),
      'jointx-220'
    );
    v_front := coalesce(
      nullif(p_configuration->>'frontPrint',''),
      'a4'
    );
    v_back := coalesce(
      nullif(p_configuration->>'backPrint',''),
      'none'
    );
    v_artwork := coalesce(
      nullif(p_configuration->>'artwork',''),
      'ready'
    );

    if not coalesce((v_pricing->'garments') ? v_garment, false)
       or not coalesce((v_pricing->'frontPrint') ? v_front, false)
       or not coalesce((v_pricing->'backPrint') ? v_back, false)
       or not coalesce((v_pricing->'artwork') ? v_artwork, false) then
      raise exception using
        errcode = '22023',
        message = 'One or more T-shirt options are invalid.';
    end if;

    v_unit :=
      coalesce(
        (v_pricing->'garments'->v_garment->>'unitFee')::numeric,
        0
      ) +
      coalesce(
        (v_pricing->'frontPrint'->v_front->>'unitFee')::numeric,
        0
      ) +
      coalesce(
        (v_pricing->'backPrint'->v_back->>'unitFee')::numeric,
        0
      );

    v_discount :=
      case
        when v_quantity >= 25 then 0.90
        when v_quantity >= 10 then 0.95
        else 1
      end;

    v_base := v_unit * v_quantity * v_discount;

    v_service_fees := coalesce(
      (v_pricing->'artwork'->v_artwork->>'fee')::numeric,
      0
    );

    v_total := round(v_base + v_service_fees, 2);

    v_summary :=
      v_quantity::text ||
      ' shirt' ||
      case when v_quantity=1 then '' else 's' end ||
      ' · ' ||
      v_garment;

    v_lines := jsonb_build_array(
      jsonb_build_object(
        'label','Garment + print',
        'value',round(v_base,2)
      ),
      jsonb_build_object(
        'label','Artwork support',
        'value',round(v_service_fees,2)
      ),
      jsonb_build_object(
        'label','Quantity pricing',
        'text',
        case
          when v_discount < 1
            then round((1-v_discount)*100)::text ||
                 '% quantity saving'
          else 'standard'
        end
      )
    );

    v_metrics := jsonb_build_object(
      'quantity',v_quantity,
      'unit',v_unit,
      'discount',v_discount
    );

  else
    raise exception using
      errcode = '22023',
      message = 'Unsupported pricing strategy.';
  end if;

  return jsonb_build_object(
    'productId', v_product_id,
    'productKey', trim(p_product_key),
    'productName', v_product_name,
    'total', v_total,
    'summary', v_summary,
    'lines', v_lines,
    'metrics', v_metrics,
    'snapshot', jsonb_build_object(
      'pricingVersion', v_pricing_version,
      'productKey', trim(p_product_key),
      'productName', v_product_name,
      'pricingStrategy', v_strategy,
      'configuration', p_configuration,
      'pricingDefinition', v_pricing,
      'calculation', jsonb_build_object(
        'lines', v_lines,
        'metrics', v_metrics,
        'total', v_total
      ),
      'capturedAt', now()
    )
  );
end
$$;

REVOKE ALL ON FUNCTION "public"."get_quick_solution_staff_catalog"("p_tenant_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_quick_solution_staff_catalog"("p_tenant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_quick_solution_staff_catalog"("p_tenant_id" "uuid") TO "service_role";
REVOKE ALL ON FUNCTION "public"."quote_quick_solution_staff_item"("p_tenant_id" "uuid", "p_product_key" "text", "p_configuration" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."quote_quick_solution_staff_item"("p_tenant_id" "uuid", "p_product_key" "text", "p_configuration" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."quote_quick_solution_staff_item"("p_tenant_id" "uuid", "p_product_key" "text", "p_configuration" "jsonb") TO "service_role";

do $qs10_acl_check$
begin
  if to_regprocedure(
    'public.get_quick_solution_staff_catalog(uuid)'
  ) is null then
    raise exception
      'QS10 RPC missing: get_quick_solution_staff_catalog';
  end if;

  if to_regprocedure(
    'public.quote_quick_solution_staff_item(uuid,text,jsonb)'
  ) is null then
    raise exception
      'QS10 RPC missing: quote_quick_solution_staff_item';
  end if;

  if has_function_privilege(
    'anon',
    'public.get_quick_solution_staff_catalog(uuid)',
    'EXECUTE'
  ) then
    raise exception
      'QS10 ACL failure: anon can execute catalog RPC';
  end if;

  if has_function_privilege(
    'anon',
    'public.quote_quick_solution_staff_item(uuid,text,jsonb)',
    'EXECUTE'
  ) then
    raise exception
      'QS10 ACL failure: anon can execute pricing RPC';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.get_quick_solution_staff_catalog(uuid)',
    'EXECUTE'
  ) then
    raise exception
      'QS10 ACL failure: authenticated catalog execute missing';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.quote_quick_solution_staff_item(uuid,text,jsonb)',
    'EXECUTE'
  ) then
    raise exception
      'QS10 ACL failure: authenticated pricing execute missing';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.get_quick_solution_staff_catalog(uuid)',
    'EXECUTE'
  ) then
    raise exception
      'QS10 ACL failure: service_role catalog execute missing';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.quote_quick_solution_staff_item(uuid,text,jsonb)',
    'EXECUTE'
  ) then
    raise exception
      'QS10 ACL failure: service_role pricing execute missing';
  end if;
end
$qs10_acl_check$;

commit;
