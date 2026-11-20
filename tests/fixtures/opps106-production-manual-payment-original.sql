-- Disposable test fixture: function definition read from production on 20 Nov 2026.
-- This snapshot is never executed against production and contains no user data.
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
