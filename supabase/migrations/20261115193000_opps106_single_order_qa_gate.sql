-- OPPS-106 isolated sandbox activation: never enable a whole tenant.
-- Every access checks the EXACT order ID and an absolute expiry.
alter table qr_payments.issuance_controls
 add column if not exists allowed_order_id uuid,
 add column if not exists active_until timestamptz;
alter table qr_payments.issuance_controls
 add constraint qr_issuance_requires_scope
 check (not enabled or (allowed_order_id is not null and active_until is not null));
-- Force a secure OFF state on migration, do not inherit an uncontrolled ON.
update qr_payments.issuance_controls set enabled=false,
 allowed_order_id=null, active_until=null, updated_at=now()
 where target_type='cafe_order';
create or replace function public.qs_opps106_issue_counter_qr(
  p_order_id uuid, p_operation_key text
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog
as $function$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_ready jsonb;
  v_amount bigint;
  v_existing qr_payments.payment_requests%rowtype;
  v_new uuid;
  v_now timestamptz := clock_timestamp();
  v_expiry timestamptz;
  v_url text;
begin
  if v_actor is null or p_order_id is null or
     p_operation_key is null or
     p_operation_key !~ '^[A-Za-z0-9_-]{8,128}$' then
    return jsonb_build_object('ok',false,'reason','NOT_AUTHORIZED');
  end if;

  -- Strict serial lock on the canonical order. Call preflight AFTER lock.
  select so.tenant_id into v_tenant
    from commerce.service_orders so
    where so.id = p_order_id
    for update;
  if not found then
    return jsonb_build_object('ok',false,'reason','NOT_AUTHORIZED');
  end if;

  v_ready := public.qs_opps106_counter_qr_preflight(p_order_id);
  if v_ready->>'ok' is distinct from 'true' then
    return jsonb_build_object('ok',false,'reason',coalesce(v_ready->>'reason','NOT_PAYABLE'));
  end if;

  -- Disabled until dedicated scan redirect and verified PayFast QR
  -- callback reconciliation have both been approved.
  if not exists(
    select 1 from qr_payments.issuance_controls
    where target_type='cafe_order' and enabled=true
      and allowed_order_id=p_order_id and active_until>clock_timestamp()
  ) then
    return jsonb_build_object('ok',false,'reason','QR_ISSUANCE_DISABLED');
  end if;

  v_amount := (v_ready->>'amountCents')::bigint;
  -- Resolve canonical same-tenant order, independently of caller claims.
  select * into v_existing
    from qr_payments.payment_requests
    where tenant_id=v_tenant and target_type='cafe_order'
      and target_id=p_order_id and operation_key=p_operation_key
    for update;
  if found then
    if v_existing.amount_cents <> v_amount then
      return jsonb_build_object('ok',false,'reason','STALE_OPERATION_KEY');
    end if;
    if v_existing.status='active' and v_existing.expires_at>v_now then
      return jsonb_build_object('ok',true,'paymentRequestId',v_existing.id,
        'amountCents',v_amount,'currency','ZAR',
        'expiresAt',v_existing.expires_at,'status','active',
        'scanUrl',v_existing.checkout_url,'reused',true);
    end if;
    return jsonb_build_object('ok',false,'reason','OPERATION_KEY_ALREADY_USED');
  end if;

  -- Reuse one outstanding request across two staff devices, even if
  -- their operation keys differ. Never issue a second simultaneous QR.
  select * into v_existing
    from qr_payments.payment_requests
    where tenant_id=v_tenant and target_type='cafe_order'
      and target_id=p_order_id and status='active'
    for update;
  if found then
    if v_existing.expires_at>v_now and
       v_existing.amount_cents=v_amount then
      return jsonb_build_object('ok',true,'paymentRequestId',v_existing.id,
        'amountCents',v_amount,'currency','ZAR',
        'expiresAt',v_existing.expires_at,'status','active',
        'scanUrl',v_existing.checkout_url,'reused',true);
    end if;
    update qr_payments.payment_requests
      set status=case when expires_at<=v_now then 'expired' else 'revoked' end,
          checkout_url=null, updated_at=v_now
      where id=v_existing.id;
  end if;

  v_new := gen_random_uuid();
  v_expiry := v_now + interval '2 minutes';
  -- This is an intermediate URL, NOT a PayFast checkout URL.
  -- The scanner will refuse redirects until the gateway is wired.
  v_url := 'https://tijiamrfnxrbitafiflj.supabase.co/functions/v1/quick-solution-qr-opps106-scan?rid='
    || v_new::text;

  insert into qr_payments.payment_requests
    (id,tenant_id,target_type,target_id,operation_key,
     amount_cents,status,checkout_url,created_at,expires_at)
  values
    (v_new,v_tenant,'cafe_order',p_order_id,p_operation_key,
     v_amount,'active',v_url,v_now,v_expiry);

  return jsonb_build_object('ok',true,'paymentRequestId',v_new,
     'amountCents',v_amount,'currency','ZAR','expiresAt',v_expiry,
     'status','active','scanUrl',v_url,'reused',false);
end
$function$;

revoke all on function public.qs_opps106_issue_counter_qr(uuid,text)
  from public,anon,authenticated;
grant execute on function public.qs_opps106_issue_counter_qr(uuid,text)
  to authenticated;

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
    where target_type='cafe_order' and enabled=true
      and allowed_order_id=v_order.id and active_until>clock_timestamp())
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

