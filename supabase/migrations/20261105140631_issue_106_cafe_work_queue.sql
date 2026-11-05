-- ISSUE #106: reviewed locally only; do not deploy to staging/production until authorized.
-- This migration has not been applied to remote Supabase projects.
-- This RPC only reads existing OPPS orders/invoices; it creates no payments.
-- Pages over unique work cards: one order card nests its invoices; invoices
-- without a matching same-tenant order remain independent read-only cards.
create or replace function public.qs_cafe_list_work_queue(
  p_cursor text default null,
  p_limit integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_tenant_id uuid;
  v_cursor jsonb;
  v_at timestamptz;
  v_type text;
  v_id uuid;
  v_items jsonb := '[]'::jsonb;
  v_next text;
  v_count integer;
begin
  if auth.uid() is null then
    raise exception using errcode='42501', message='Staff sign-in is required.';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception using errcode='22023', message='Invalid work queue page size.';
  end if;

  select t.id into v_tenant_id
  from public.tenants t
  where t.slug = 'quick-solution' and t.status = 'active'
  limit 1;

  if v_tenant_id is null then
    raise exception using errcode='42501', message='Café work queue unavailable.';
  end if;

  if public.has_tenant_capability(v_tenant_id, 'cafe.counter.operate') is distinct from true then
    raise exception using errcode='42501', message='Café staff access required.';
  end if;

  if not exists (
    select 1 from public.tenant_capabilities tc
    where tc.tenant_id = v_tenant_id
      and tc.capability_key = 'quick_solution'
      and tc.enabled = true
  ) then
    raise exception using errcode='42501', message='Café work queue unavailable.';
  end if;

  if p_cursor is not null then
    if length(p_cursor) > 512 then
      raise exception using errcode='22023', message='Invalid work queue cursor.';
    end if;
    begin
      v_cursor := p_cursor::jsonb;
      if jsonb_typeof(v_cursor) is distinct from 'object'
        or jsonb_typeof(v_cursor->'at') is distinct from 'string'
        or jsonb_typeof(v_cursor->'type') is distinct from 'string'
        or jsonb_typeof(v_cursor->'id') is distinct from 'string'
        or (v_cursor->>'type') not in ('order', 'invoice')
      then
        raise exception using errcode='22023', message='Invalid work queue cursor.';
      end if;
      v_at := (v_cursor->>'at')::timestamptz;
      v_type := v_cursor->>'type';
      v_id := (v_cursor->>'id')::uuid;
      if v_at is null or v_id is null then
        raise exception using errcode='22023', message='Invalid work queue cursor.';
      end if;
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      raise exception using errcode='22023', message='Invalid work queue cursor.';
    end;
  end if;

  with records as (
    select
      'order'::text as kind,
      o.id,
      coalesce(o.updated_at, 'epoch'::timestamptz) as sort_at,
      jsonb_build_object(
        'type', 'order', 'id', o.id,
        'number', o.order_number, 'customerName', o.client_name,
        'status', o.status, 'total', o.total_amount,
        'balanceDue', null, 'reviewRequired', true,
        'sourceOrderId', o.id, 'updatedAt', o.updated_at,
        'invoices', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'id', i.id, 'number', i.invoice_number,
                'status', i.status, 'total', i.total,
                'balanceDue',
                  case when i.status in ('draft','void') or i.balance_due is null or i.balance_due < 0
                    then null else i.balance_due end,
                'reviewRequired',
                  i.status in ('draft','void') or i.status is null or i.balance_due is null or i.balance_due < 0,
                'sourceOrderId', i.source_order_id, 'updatedAt', i.updated_at
              ) order by i.updated_at desc nulls last, i.id desc
            ), '[]'::jsonb
          )
          from public.opps_invoices i
          where i.tenant_id = v_tenant_id
            and i.source_order_id = o.id
        )
      ) as data
    from public.orders o
    where o.tenant_id = v_tenant_id

    union all

    select
      'invoice'::text as kind,
      i.id,
      coalesce(i.updated_at, 'epoch'::timestamptz) as sort_at,
      jsonb_build_object(
        'type', 'invoice', 'id', i.id,
        'number', i.invoice_number, 'customerName', i.customer_name,
        'status', i.status, 'total', i.total,
        'balanceDue',
          case when i.status in ('draft','void') or i.balance_due is null or i.balance_due < 0
            then null else i.balance_due end,
        'reviewRequired',
          i.status in ('draft','void') or i.status is null or i.balance_due is null or i.balance_due < 0,
        'sourceOrderId', i.source_order_id, 'updatedAt', i.updated_at
      ) as data
    from public.opps_invoices i
    where i.tenant_id = v_tenant_id
      and not exists (
        select 1 from public.orders linked_order
        where linked_order.id = i.source_order_id
          and linked_order.tenant_id = v_tenant_id
      )
  ), slice as (
    select r.kind, r.id, r.sort_at, r.data
    from records r
    where p_cursor is null or (r.sort_at,r.kind,r.id) < (v_at,v_type,v_id)
    order by r.sort_at desc, r.kind desc, r.id desc
    limit p_limit + 1
  ), numbered as (
    select s.*, row_number() over (order by s.sort_at desc,s.kind desc,s.id desc) as rn
    from slice s
  )
  select
    coalesce(jsonb_agg(n.data order by n.rn) filter (where n.rn <= p_limit), '[]'::jsonb),
    count(*)::integer,
    max(case when n.rn = p_limit then
      jsonb_build_object('at',n.sort_at,'type',n.kind,'id',n.id)::text
    end)
  into v_items, v_count, v_next
  from numbered n;

  return jsonb_build_object(
    'items',v_items,
    'nextCursor',case when v_count > p_limit then v_next else null end
  );
end
$function$;

revoke all on function public.qs_cafe_list_work_queue(text,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.qs_cafe_list_work_queue(text,integer)
  to authenticated;
