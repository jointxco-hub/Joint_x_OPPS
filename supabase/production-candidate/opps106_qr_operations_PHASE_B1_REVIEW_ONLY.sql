-- PHASE B-1 review-only runtime guard. Depends on Phase A private tables.
-- Built from read-only inspected production manual-payment function (MD5 af0dc64d91f977861a0fa0142bcd5a17).
-- DOES NOT issue QR, create checkout, call PayFast, settle funds, or enable switches.
-- Full live/sandbox settlement is a separate release and is NOT authorized here.
do $expected$
declare
 v_hash text;
begin
 if to_regclass('qr_payments.payment_requests') is null
   or to_regclass('qr_payments.issuance_controls') is null
 then raise exception 'OPPS106_PHASE_A_MISSING'; end if;
 select md5(pg_get_functiondef(p.oid)) into v_hash
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='record_quick_solution_counter_payment'
   and pg_get_function_identity_arguments(p.oid)='p_order_id uuid, p_method text, p_idempotency_key text';
 if v_hash is distinct from 'af0dc64d91f977861a0fa0142bcd5a17'
 then raise exception 'OPPS106_MANUAL_PAYMENT_FUNCTION_DRIFT: review production original';end if;
 if exists(select 1 from qr_payments.issuance_controls where enabled)
 then raise exception 'OPPS106_ISSUER_MUST_BE_OFF'; end if;
end $expected$;


-- Staff preflight from repository: eligibility only, not permission to pay.
-- OPPS-106 · read-only counter QR preflight.
-- This checks eligibility for an authenticated Café staff member only.
-- Preflight is NOT permission to charge; issuer must re-lock and re-check.
create or replace function public.qs_opps106_counter_qr_preflight(p_order_id uuid)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog
as $body$
declare
  v_actor uuid := auth.uid();
  v_order record;
  v_paid numeric;
  v_pending integer;
  v_items integer;
  v_configured integer;
  v_allow_payfast boolean;
  v_min numeric;
  v_total_cents bigint;
  v_paid_cents bigint;
  v_min_cents bigint;
  v_metadata jsonb;
begin
  if v_actor is null or p_order_id is null then
    return jsonb_build_object('ok',false,'reason','NOT_AUTHORIZED');
  end if;

  select so.id, so.tenant_id, so.status, so.payment_status,
         so.total_amount, so.opps_order_id, so.channel,
         so.fulfilment_type, so.source_metadata,
         t.slug, t.status as tenant_status,
         coalesce((t.settings->'qsPayment'->>'payfastMinimumAmount')::numeric,50) as minimum
  into v_order
  from commerce.service_orders so
  join public.tenants t on t.id=so.tenant_id
  where so.id=p_order_id;

  if not found or v_order.slug <> 'quick-solution' or
     v_order.tenant_status <> 'active' or
     not exists (
       select 1 from public.tenant_memberships m
       join public.tenant_capabilities cap on cap.tenant_id=m.tenant_id
       where m.tenant_id=v_order.tenant_id
         and m.auth_user_id=v_actor and m.status='active'
         and m.tenant_role in ('owner','admin','member','counter_staff')
         and cap.capability_key='quick_solution' and cap.enabled=true
     ) then
    return jsonb_build_object('ok',false,'reason','NOT_AUTHORIZED');
  end if;

  select coalesce(sum(p.amount) filter(where p.status='completed'),0),
         count(*) filter(where p.status='pending')::integer
  into v_paid,v_pending
  from commerce.service_order_payments p
  where p.service_order_id=p_order_id and p.tenant_id=v_order.tenant_id;

  select count(*)::integer, count(spc.product_id)::integer,
         coalesce(bool_and(
            coalesce((spc.customer_definition->'paymentEligibility'->>'allowPayfast')::boolean,true)
         ),false)
  into v_items,v_configured,v_allow_payfast
  from commerce.service_order_items soi
  left join commerce.service_product_configs spc
    on spc.tenant_id=soi.tenant_id and spc.product_id=soi.product_id
  where soi.order_id=p_order_id and soi.tenant_id=v_order.tenant_id;

  v_min := v_order.minimum;
  v_metadata := coalesce(v_order.source_metadata,'{}'::jsonb);
  if v_order.total_amount is null or v_paid is null or v_min is null
    or v_order.total_amount < 0 or v_paid < 0 or v_min < 0
    or v_order.total_amount > 100000000
    or v_paid > 100000000 then
    return jsonb_build_object('ok',false,'reason','NOT_PAYABLE');
  end if;
  v_total_cents := round(v_order.total_amount*100);
  v_paid_cents := round(v_paid*100);
  v_min_cents := round(v_min*100);

  if v_order.channel <> 'counter' or v_order.opps_order_id is not null
     or v_order.payment_status not in ('unpaid','pending')
     or v_order.status in ('draft','cancelled','completed')
     or v_total_cents <= 0 or v_paid_cents <> 0
     or v_total_cents < v_min_cents or v_pending <> 0
     or v_items <= 0 or v_items <> v_configured or not v_allow_payfast
     or v_metadata->>'quoteRequired' = 'true'
     or v_metadata#>>'{paymentProjectionReview,required}' = 'true'
     or (v_order.fulfilment_type='delivery'
         and v_metadata->>'deliveryFeeStatus' is distinct from 'confirmed')
  then
    return jsonb_build_object('ok',false,'reason','NOT_PAYABLE');
  end if;

  return jsonb_build_object(
    'ok',true,'targetType','cafe_order','targetId',v_order.id,
    'amountCents',v_total_cents,'currency','ZAR',
    'status','eligible','note','Preflight only; issuer must recheck in a transaction'
  );
end
$body$;
revoke all on function public.qs_opps106_counter_qr_preflight(uuid)
  from public,anon,authenticated;
grant execute on function public.qs_opps106_counter_qr_preflight(uuid) to authenticated;

-- Preserve existing live-production manual Cash/Card behavior except one
-- authoritative QR/PayFast conflict check before insert.
CREATE OR REPLACE FUNCTION public.record_quick_solution_counter_payment(p_order_id uuid, p_method text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid;
  v_tenant_id uuid;
  v_key text;
  v_stored_key text;
  v_order commerce.service_orders;
  v_existing commerce.service_order_payments;
  v_block text;
  v_amount numeric;
  v_paid numeric;
  v_payment_id uuid;
  v_paid_at timestamptz;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Staff sign-in is required.';
  end if;

  select t.id
  into v_tenant_id
  from public.tenants t
  where t.slug = 'quick-solution'
    and t.status = 'active'
  limit 1;

  if v_tenant_id is null then
    raise exception using errcode = '22023', message = 'Quick Solution tenant was not found.';
  end if;

  if not public.has_tenant_capability(v_tenant_id, 'cafe.counter.operate') then
    raise exception using errcode = '42501', message = 'You do not have access to the Quick Solution counter.';
  end if;

  if not exists (
    select 1
    from public.tenant_capabilities tc
    where tc.tenant_id = v_tenant_id
      and tc.capability_key = 'quick_solution'
      and tc.enabled = true
  ) then
    raise exception using errcode = '22023', message = 'Quick Solution counter is not active.';
  end if;

  -- input: exactly the two supported methods, no mapping, no case folding
  if p_method is null or p_method not in ('cash', 'card') then
    raise exception using errcode = '22023', message = 'Payment method is not supported.';
  end if;
  v_key := trim(coalesce(p_idempotency_key, ''));
  if length(v_key) < 8 then
    raise exception using errcode = '22023', message = 'Payment idempotency key is required.';
  end if;
  if length(v_key) > 128 then
    raise exception using errcode = '22023', message = 'Payment idempotency key is not valid.';
  end if;
  if p_order_id is null then
    raise exception using errcode = '22023', message = 'Counter order was not found.';
  end if;

  -- serialize on the key, then on the order (always in this order, so two callers cannot deadlock)
  v_stored_key := 'counter-payment:' || v_actor::text || ':' || v_key;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_tenant_id::text || '|' || v_stored_key, 0));

  select so.*
  into v_order
  from commerce.service_orders so
  where so.id = p_order_id
    and so.tenant_id = v_tenant_id
    and (
      so.channel = 'counter'
      or exists (
        select 1 from commerce.service_order_payments p
        where p.service_order_id = so.id
          and p.provider = 'counter'
          and p.status = 'pending'
      )
    )
  for update;

  -- a retry of a payment this actor already recorded returns the original, whatever the order looks like now
  select p.*
  into v_existing
  from commerce.service_order_payments p
  where p.tenant_id = v_tenant_id
    and p.idempotency_key = v_stored_key;

  if v_existing.id is not null then
    if v_existing.service_order_id is distinct from p_order_id
       or v_existing.provider is distinct from p_method
       or v_existing.recorded_by is distinct from v_actor then
      raise exception using errcode = '23505', message = 'This payment key was already used for a different payment request.';
    end if;
    return jsonb_build_object(
      'ok', true,
      'replayed', true,
      'alreadyPaid', false,
      'orderId', v_existing.service_order_id,
      'orderNumber', v_order.order_number,
      'paymentId', v_existing.id,
      'method', v_existing.provider,
      'amount', v_existing.amount,
      'paidAt', v_existing.completed_at,
      'paymentStatus', v_order.payment_status,
      'totalAmount', v_order.total_amount,
      'amountPaid', commerce._qs_order_amount_paid(v_order.id),
      'outstanding', greatest(round(v_order.total_amount - commerce._qs_order_amount_paid(v_order.id), 2), 0)
    );
  end if;

  if v_order.id is null then
    raise exception using errcode = '22023', message = 'Counter order was not found.';
  end if;

  v_block := commerce._qs_counter_payment_block(v_order);
  if v_block = 'already_paid' then
    return jsonb_build_object(
      'ok', false,
      'reason', 'already_paid',
      'orderId', v_order.id,
      'orderNumber', v_order.order_number,
      'paymentStatus', v_order.payment_status
    );
  elsif v_block = 'sent_to_production' then
    raise exception using errcode = '22023', message = 'This order has already been sent to production and cannot take a counter payment.';
  elsif v_block = 'nothing_outstanding' then
    raise exception using errcode = '22023', message = 'This order has nothing outstanding.';
  elsif v_block is not null then
    raise exception using errcode = '22023', message = 'This order cannot take a payment.';
  end if;

  -- OPPS-106 Phase B: order is FOR UPDATE locked above.
  -- Block cash/card while a QR is active or hosted PayFast checkout might
  -- still settle. Never lift the hold on QR expiry or browser return alone.
  if exists(
    select 1 from qr_payments.payment_requests r
    where r.tenant_id=v_tenant_id
      and r.target_type='cafe_order'
      and r.target_id=v_order.id
      and (r.status='active' or r.checkout_started_at is not null)
  ) or exists(
    select 1 from commerce.service_order_payments p
    where p.tenant_id=v_tenant_id and p.service_order_id=v_order.id
      and p.provider='payfast' and p.status='pending'
  ) then
    raise exception using errcode='22023',
      message='An online QR/PayFast payment may still settle. Verify the original order before recording Cash/Card.';
  end if;

  -- the server decides the amount: everything still outstanding
  v_amount := round(v_order.total_amount - commerce._qs_order_amount_paid(v_order.id), 2);
  v_paid_at := clock_timestamp();

  insert into commerce.service_order_payments (
    tenant_id, service_order_id, provider, status, amount, initiated_at, completed_at, recorded_by, idempotency_key
  )
  values (
    v_tenant_id, v_order.id, p_method, 'completed', v_amount, v_paid_at, v_paid_at, v_actor, v_stored_key
  )
  returning id into v_payment_id;

  v_paid := commerce._qs_order_amount_paid(v_order.id);
  if round(v_order.total_amount - v_paid, 2) <> 0 then
    raise exception using errcode = '22023', message = 'The recorded amount does not settle the order.';
  end if;

  update commerce.service_order_payments
  set status = 'cancelled', updated_at = now()
  where service_order_id = v_order.id
    and provider = 'counter'
    and status = 'pending';

  update commerce.service_orders
  set payment_status = 'paid',
      source_metadata = coalesce(source_metadata, '{}'::jsonb) ||
        jsonb_build_object('payment', jsonb_build_object('provider', p_method, 'status', 'paid', 'paidAt', v_paid_at)),
      updated_at = now()
  where id = v_order.id;

  perform commerce.qs_project_manual_receipt(v_order.id);

  return jsonb_build_object(
    'ok', true,
    'replayed', false,
    'alreadyPaid', false,
    'orderId', v_order.id,
    'orderNumber', v_order.order_number,
    'paymentId', v_payment_id,
    'method', p_method,
    'amount', v_amount,
    'paidAt', v_paid_at,
    'paymentStatus', 'paid',
    'totalAmount', v_order.total_amount,
    'amountPaid', v_paid,
    'outstanding', 0
  );
end
$function$
;
-- ISSUER DENIED BY DESIGN. No generated staging or live PayFast URL.
create or replace function public.qs_opps106_issue_counter_qr(
  p_order_id uuid,p_operation_key text
) returns jsonb language plpgsql security definer set search_path=''
as $issuer$
declare v_actor uuid:=auth.uid();
begin
  if v_actor is null then return jsonb_build_object('ok',false,'reason','NOT_AUTHORIZED');end if;
  return jsonb_build_object('ok',false,'reason','QR_ISSUANCE_DISABLED');
end $issuer$;
revoke all on function public.qs_opps106_issue_counter_qr(uuid,text) from public,anon,authenticated;
grant execute on function public.qs_opps106_issue_counter_qr(uuid,text) to authenticated;

-- No changes to existing Finance/OPPS projection functions, triggers or transactions.
