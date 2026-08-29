-- XOS 2.7C — QA/test order hygiene.
--
-- Adds explicit, durable classification for orders, independent of the
-- existing is_archived (visibility/lifecycle) concept:
--   is_test               - what this order IS (a QA/proof/test row, not
--                            a real customer order). Classification only.
--   excluded_from_reports - whether this order PARTICIPATES in
--                            operational/reporting calculations
--                            (counts, revenue, outstanding, production
--                            queues, XOS client-facing views).
--
-- The two are deliberately independent - a staff member can mark an
-- order is_test=true while still keeping it excluded_from_reports=false
-- (visible operationally, clearly flagged), or vice versa. Neither
-- automatically changes the other, and neither automatically changes
-- is_archived.
--
-- No backfill. Both columns default false for every existing row -
-- confirmed no automatic name/email/prefix/source pattern classification
-- and no UPDATE statement targets any existing order in this file.
-- Known candidate rows (XL-2026-647263, XL-2026-268006, ORD-MQNGCL25,
-- ...) remain completely unchanged; classification is an explicit,
-- later, separate staff decision.
--
-- Phase 0 write-authorization preflight (checked live before writing
-- this): public.orders already has TWO OR'd RLS UPDATE policies for
-- `authenticated` - tenant_manage_orders (is_app_admin() OR
-- can_access_tenant(tenant_id)) and xos1_require_opps_staff
-- (is_opps_staff()). can_access_tenant() is satisfied by ANY member of
-- that tenant, not staff-only - an ordinary GSB/client tenant member can
-- already UPDATE arbitrary columns on their own tenant's orders via the
-- existing policy. Exposing is_test/excluded_from_reports through the
-- generic order-update path would let a tenant customer hide their own
-- order from reporting. This migration therefore does NOT rely on that
-- path: the two columns are additive (no RLS/grant change - reads
-- follow the existing SELECT policies unchanged, appropriate since
-- reading these flags isn't more sensitive than reading any other order
-- field already visible to a tenant member), and the ONLY write path is
-- the new set_order_test_classification() RPC below, guarded by
-- is_opps_staff() specifically (not can_access_tenant()) - so only
-- Joint X internal staff can ever change classification, regardless of
-- who owns the order's tenant. The frontend additionally never sends
-- these two fields through the generic Order.update() call (see
-- src/api/dataClient.js's Order.serialize - deliberately does not
-- whitelist them), so there is no code path that could accidentally
-- route a classification change through the ordinary tenant-writable
-- update RPC/table path even by mistake.

begin;

alter table public.orders
  add column if not exists is_test boolean not null default false,
  add column if not exists excluded_from_reports boolean not null default false;

create or replace function public.set_order_test_classification(
  p_order_id uuid,
  p_is_test boolean default null,
  p_excluded_from_reports boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_actor_uid uuid;
  v_actor_email text;
  v_actor_name text;
  v_old public.orders;
  v_new public.orders;
  v_changed_fields jsonb;
  v_event_id uuid;
begin
  -- ── 1. Resolve actor ────────────────────────────────────────────────
  v_actor_uid := auth.uid();
  select u.user_email, u.full_name into v_actor_email, v_actor_name
  from public.users u
  where u.auth_user_id = v_actor_uid and coalesce(u.is_active, true)
  order by u.created_at asc
  limit 1;
  if v_actor_email is null then
    raise exception 'ORDER_CLASSIFICATION_ACTOR_UNRESOLVED: authenticated user does not resolve to a valid OPPS staff identity';
  end if;

  -- ── 2. Validate ───────────────────────────────────────────────────────
  if p_order_id is null then
    raise exception 'ORDER_CLASSIFICATION_ORDER_ID_REQUIRED: p_order_id is required';
  end if;
  if p_is_test is null and p_excluded_from_reports is null then
    raise exception 'ORDER_CLASSIFICATION_NO_CHANGE: at least one of p_is_test or p_excluded_from_reports must be provided';
  end if;

  -- ── 3. Lock the order - this is the ONLY read of it, so authorization
  -- and the changed-field diff both observe the identical locked row ────
  select * into v_old from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'ORDER_CLASSIFICATION_NOT_FOUND: order % does not exist', p_order_id;
  end if;

  -- ── 4. Authorize - is_opps_staff() specifically, never
  -- can_access_tenant() - this is the entire point of this RPC existing
  -- rather than an ordinary column update ─────────────────────────────
  if not public.is_opps_staff() then
    raise exception 'ORDER_CLASSIFICATION_FORBIDDEN: no staff access';
  end if;

  -- ── 5. Effective values computed once, used identically for both the
  -- persisted UPDATE and the audit diff - never two different sources of
  -- truth for what "the new value" is. Each toggle is independent: a
  -- null parameter means "leave this field unchanged", never "clear it"
  -- and never inferred from the other parameter. ──────────────────────
  v_changed_fields := jsonb_strip_nulls(jsonb_build_object(
    'is_test', case when p_is_test is not null and p_is_test is distinct from v_old.is_test
      then jsonb_build_object('before', v_old.is_test, 'after', p_is_test) end,
    'excluded_from_reports', case when p_excluded_from_reports is not null and p_excluded_from_reports is distinct from v_old.excluded_from_reports
      then jsonb_build_object('before', v_old.excluded_from_reports, 'after', p_excluded_from_reports) end
  ));

  update public.orders
  set is_test = coalesce(p_is_test, is_test),
      excluded_from_reports = coalesce(p_excluded_from_reports, excluded_from_reports),
      updated_at = now()
  where id = p_order_id
  returning * into v_new;

  -- ── 6. One activity event, only when something actually changed ─────
  if v_changed_fields <> '{}'::jsonb then
    insert into public.opps_activity_events (
      tenant_id, actor_email, actor_name, event_type, entity_type, entity_id, summary, metadata
    ) values (
      v_new.tenant_id, v_actor_email, v_actor_name, 'order_classification_changed', 'orders', v_new.id,
      format('%s changed test/report classification for order %s', coalesce(v_actor_name, 'Staff'), v_new.order_number),
      jsonb_build_object('changed_fields', v_changed_fields)
    )
    returning id into v_event_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'order_id', v_new.id,
    'is_test', v_new.is_test,
    'excluded_from_reports', v_new.excluded_from_reports,
    'activity_event_id', v_event_id
  );
end;
$function$;

revoke all on function public.set_order_test_classification(uuid, boolean, boolean) from public;
revoke all on function public.set_order_test_classification(uuid, boolean, boolean) from anon;
grant execute on function public.set_order_test_classification(uuid, boolean, boolean)
  to authenticated, service_role, postgres;

-- ---------------------------------------------------------------------
-- XOS client-facing exclusion (Phase C5). Adds
-- coalesce(o.excluded_from_reports, false) = false alongside the
-- existing coalesce(o.is_archived, false) = false filter on both
-- functions. Every other line is byte-identical to what's currently
-- deployed (confirmed via pg_get_functiondef before writing this):
-- tenant resolution, tenant scoping, the 2.7A/B fulfillment_type/
-- payment_status projection, the 2.6 thumbnail/unit_price fallback,
-- SECURITY DEFINER, search_path, and grants are all unchanged. An
-- excluded order returns the same "Order not found." as a genuinely
-- nonexistent or cross-tenant one - no distinguishing signal leaked.
-- ---------------------------------------------------------------------

create or replace function public.get_xos_orders_for_host(p_hostname text, p_limit integer DEFAULT 20)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  resolved_tenant_id uuid;
  safe_limit int := least(greatest(coalesce(p_limit, 20), 1), 50);
  result jsonb;
begin
  select tenant_id
  into resolved_tenant_id
  from public.resolve_authenticated_tenant_host(p_hostname, 'xos_admin')
  limit 1;

  if resolved_tenant_id is null then
    raise exception 'XOS access denied.';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'order_number', order_row.order_number,
      'client_name', order_row.client_name,
      'status', order_row.status,
      'stage', order_row.stage,
      'created_at', order_row.created_at,
      'due_date', order_row.due_date,
      'total_amount', order_row.total_amount,
      'fulfillment_type', order_row.fulfillment_type,
      'payment_status', order_row.payment_status,
      'item_count', order_row.item_count,
      'tracking_reference', order_row.tracking_reference,
      'summary', order_row.summary
    )
    order by order_row.created_at desc
  ), '[]'::jsonb)
  into result
  from (
    select
      o.order_number,
      left(coalesce(o.client_name, 'Client'), 160)::text as client_name,
      coalesce(o.status, 'confirmed')::text as status,
      left(coalesce(o.production_detail_stage, o.pipeline_stage, o.status, 'confirmed'), 80)::text as stage,
      o.created_at,
      o.due_date,
      o.total_amount,
      o.fulfillment_type,
      coalesce(o.payment_status, 'pending')::text as payment_status,
      case
        when jsonb_typeof(coalesce(o.products, '[]'::jsonb)) = 'array'
          then jsonb_array_length(coalesce(o.products, '[]'::jsonb))
        else 0
      end as item_count,
      nullif(left(coalesce(o.tracking_number, ''), 80), '')::text as tracking_reference,
      left(coalesce(o.production_client_update, 'Client-facing progress update pending.'), 280)::text as summary
    from public.orders o
    where o.tenant_id = resolved_tenant_id
      and coalesce(o.is_archived, false) = false
      and coalesce(o.excluded_from_reports, false) = false
    order by o.created_at desc
    limit safe_limit
  ) order_row;

  return result;
end;
$function$;

revoke all on function public.get_xos_orders_for_host(text, integer) from public;
revoke all on function public.get_xos_orders_for_host(text, integer) from anon;
grant execute on function public.get_xos_orders_for_host(text, integer)
  to authenticated, service_role, postgres;

create or replace function public.get_xos_order_detail_for_host(
  p_hostname text,
  p_order_number text
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  resolved_tenant_id uuid;
  clean_order_number text := left(trim(coalesce(p_order_number, '')), 80);
  order_row public.orders%rowtype;
  items jsonb;
  result jsonb;
begin
  select tenant_id
  into resolved_tenant_id
  from public.resolve_authenticated_tenant_host(p_hostname, 'xos_admin')
  limit 1;

  if resolved_tenant_id is null then
    raise exception 'XOS access denied.';
  end if;

  if clean_order_number = '' then
    raise exception 'Order number is required.';
  end if;

  select *
  into order_row
  from public.orders o
  where o.order_number = clean_order_number
    and o.tenant_id = resolved_tenant_id
    and coalesce(o.is_archived, false) = false
    and coalesce(o.excluded_from_reports, false) = false
  limit 1;

  if order_row.order_number is null then
    raise exception 'Order not found.';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'name', left(coalesce(item->>'name', 'Item'), 160),
      'size', nullif(left(coalesce(item->>'size', ''), 40), ''),
      'color', nullif(left(coalesce(item->>'color', ''), 40), ''),
      'quantity', nullif(item->>'quantity', '')::numeric,
      'image_url', coalesce(
        nullif(item->>'image_url', ''),
        (
          select nullif(product.primary_image_url, '')
          from commerce.products product
          where product.id::text = nullif(item->>'commerce_product_id', '')
            and product.tenant_id = resolved_tenant_id
          limit 1
        )
      ),
      'price', coalesce(
        nullif(item->>'price', ''),
        nullif(item->>'unit_price', '')
      )::numeric
    )
    order by ord
  ), '[]'::jsonb)
  into items
  from jsonb_array_elements(
    coalesce(order_row.products, '[]'::jsonb)
  ) with ordinality as t(item, ord);

  result := jsonb_build_object(
    'order_number', order_row.order_number,
    'client_name', left(coalesce(order_row.client_name, 'Client'), 160),
    'status', coalesce(order_row.status, 'confirmed'),
    'stage', left(coalesce(
      order_row.production_detail_stage,
      order_row.pipeline_stage,
      order_row.status,
      'confirmed'
    ), 80),
    'created_at', order_row.created_at,
    'due_date', order_row.due_date,
    'total_amount', order_row.total_amount,
    'fulfillment_type', order_row.fulfillment_type,
    'payment_status', coalesce(order_row.payment_status, 'pending'),
    'tracking_reference',
      nullif(left(coalesce(order_row.tracking_number, ''), 80), ''),
    'items', items
  );

  return result;
end;
$function$;

revoke all on function public.get_xos_order_detail_for_host(text, text) from public;
revoke all on function public.get_xos_order_detail_for_host(text, text) from anon;
grant execute on function public.get_xos_order_detail_for_host(text, text)
  to authenticated, service_role, postgres;

commit;
