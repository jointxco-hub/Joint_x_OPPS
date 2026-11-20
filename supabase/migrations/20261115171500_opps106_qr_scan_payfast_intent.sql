-- OPPS-106: private sandbox QR scan → canonical Café PayFast intent.
-- The existing issuance flag remains FALSE. No checkout is enabled by this migration.
alter table qr_payments.payment_requests
  add column if not exists checkout_intent_id uuid
    references commerce.service_order_payments(id),
  add column if not exists checkout_started_at timestamptz;

create unique index if not exists qr_payment_request_unique_checkout_intent
  on qr_payments.payment_requests(checkout_intent_id)
  where checkout_intent_id is not null;

alter table qr_payments.payment_requests
  add constraint qr_checkout_intent_pair
  check ((checkout_intent_id is null and checkout_started_at is null)
      or (checkout_intent_id is not null and checkout_started_at is not null));

create or replace function public.qs_opps106_start_counter_qr_checkout(p_request_id uuid)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog
as $function$
declare
  v_request qr_payments.payment_requests%rowtype;
  v_order commerce.service_orders%rowtype;
  v_intent commerce.service_order_payments%rowtype;
  v_tenant record;
  v_completed numeric;
  v_pending_count integer;
  v_item_count integer;
  v_configured_count integer;
  v_allow boolean;
  v_now timestamptz := clock_timestamp();
begin
  if coalesce(auth.role(),'') <> 'service_role'
    and session_user not in ('postgres','supabase_admin')
  then raise exception using errcode='42501',message='Trusted backend required';end if;
  if p_request_id is null then return jsonb_build_object('ok',false,'reason','INVALID');end if;

  -- Consistent order -> request lock order, matching staff QR issuance.
  select so.* into v_order from commerce.service_orders so
  where so.id=(select r.target_id from qr_payments.payment_requests r
    where r.id=p_request_id and r.target_type='cafe_order')
  for update;
  if not found then return jsonb_build_object('ok',false,'reason','INVALID');end if;

  select * into v_request from qr_payments.payment_requests r
    where r.id=p_request_id and r.target_type='cafe_order'
    and r.target_id=v_order.id and r.tenant_id=v_order.tenant_id
    for update;
  if not found then return jsonb_build_object('ok',false,'reason','INVALID');end if;

  if v_request.status <> 'active' or v_request.expires_at<=v_now then
    return jsonb_build_object('ok',false,'reason','EXPIRED_OR_REVOKED');
  end if;
  if not exists(select 1 from qr_payments.issuance_controls
    where target_type='cafe_order' and enabled=true)
  then return jsonb_build_object('ok',false,'reason','QR_ISSUANCE_DISABLED');end if;

  select t.slug,t.status,coalesce((t.settings->'qsPayment'->>'payfastMinimumAmount')::numeric,50) as minimum
  into v_tenant from public.tenants t where t.id=v_order.tenant_id;
  if not found or v_tenant.slug <> 'quick-solution' or v_tenant.status <> 'active'
    or v_order.channel <> 'counter' or v_order.opps_order_id is not null
    or v_order.payment_status not in ('unpaid','pending')
    or v_order.status in ('draft','cancelled','completed')
    or v_order.total_amount is null or v_order.total_amount<=0
    or round(v_order.total_amount*100)<>v_request.amount_cents
    or v_order.total_amount < v_tenant.minimum
    or coalesce((v_order.source_metadata->>'quoteRequired')::boolean,false)
    or coalesce((v_order.source_metadata#>>'{paymentProjectionReview,required}')::boolean,false)
    or (v_order.fulfilment_type='delivery'
      and coalesce(v_order.source_metadata->>'deliveryFeeStatus','')<>'confirmed')
  then return jsonb_build_object('ok',false,'reason','NOT_PAYABLE');end if;

  select coalesce(sum(p.amount) filter(where p.status='completed'),0),
         count(*) filter(where p.status='pending')::integer
    into v_completed,v_pending_count
    from commerce.service_order_payments p
    where p.tenant_id=v_order.tenant_id and p.service_order_id=v_order.id;

  select count(*)::integer,count(spc.product_id)::integer,
    coalesce(bool_and(coalesce((spc.customer_definition->'paymentEligibility'->>'allowPayfast')::boolean,true)),false)
    into v_item_count,v_configured_count,v_allow
    from commerce.service_order_items soi
    left join commerce.service_product_configs spc
      on spc.tenant_id=soi.tenant_id and spc.product_id=soi.product_id
    where soi.order_id=v_order.id and soi.tenant_id=v_order.tenant_id;

  if v_completed<>0 or v_item_count<=0 or v_item_count<>v_configured_count or not v_allow
  then return jsonb_build_object('ok',false,'reason','NOT_PAYABLE');end if;

  if v_request.checkout_intent_id is not null then
    select * into v_intent from commerce.service_order_payments
      where id=v_request.checkout_intent_id and service_order_id=v_order.id
        and tenant_id=v_order.tenant_id and provider='payfast' and status='pending';
    if not found or round(v_intent.amount*100)<>v_request.amount_cents or v_pending_count<>1
    then return jsonb_build_object('ok',false,'reason','PAYMENT_REVIEW_REQUIRED');end if;
  else
    if v_pending_count<>0 then
      return jsonb_build_object('ok',false,'reason','PAYMENT_IN_PROGRESS');end if;
    insert into commerce.service_order_payments
      (tenant_id,service_order_id,provider,status,amount)
    values (v_order.tenant_id,v_order.id,'payfast','pending',v_order.total_amount)
    returning * into v_intent;
    update qr_payments.payment_requests
      set checkout_intent_id=v_intent.id,checkout_started_at=v_now,updated_at=v_now
      where id=v_request.id;
  end if;

  return jsonb_build_object('ok',true,'requestId',v_request.id,
    'orderId',v_order.id,'tenantId',v_order.tenant_id,
    'orderNumber',v_order.order_number,'amountCents',v_request.amount_cents,
    'paymentIntentId',v_intent.id,'currency','ZAR',
    'customerName',v_order.customer_name,'customerEmail',v_order.customer_email);
end
$function$;
revoke all on function public.qs_opps106_start_counter_qr_checkout(uuid)
  from public,anon,authenticated;
grant execute on function public.qs_opps106_start_counter_qr_checkout(uuid) to service_role;
