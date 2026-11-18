-- OPPS-106 PRODUCTION CANDIDATE. REVIEW-ONLY: NEVER AUTO-APPLY.
-- Does not enable merchant policy, issuer controls or production Edge routes.
-- Disabling new issuance must not block verified ITNs for prior initiated checkouts.
create table if not exists qr_payments.live_gateway_policy(
 target_type text primary key,merchant_id text,
 enabled boolean not null default false,
 approved_at timestamptz,approved_by uuid,
 created_at timestamptz not null default now(),
 check(merchant_id is null or merchant_id ~ '^[0-9]{6,20}$'),
 check(not enabled or
  (merchant_id is not null and approved_at is not null and approved_by is not null))
);
alter table qr_payments.live_gateway_policy enable row level security;
revoke all on qr_payments.live_gateway_policy from public,anon,authenticated;
insert into qr_payments.live_gateway_policy(target_type,enabled)
values('cafe_order',false) on conflict(target_type) do nothing;
alter table qr_payments.payment_requests
 drop constraint qr_payment_environment_evidence_pair;
alter table qr_payments.payment_requests add constraint qr_payment_environment_evidence_pair
 check((gateway_environment is null and gateway_environment_evidence is null)
  or (gateway_environment='sandbox' and gateway_environment_evidence='sandbox_only_verified_itn')
  or (gateway_environment='live' and gateway_environment_evidence='payfast_itn_validated_live'));
CREATE OR REPLACE FUNCTION public.qs_opps106_start_counter_qr_checkout_live_candidate(p_request_id uuid, p_checkout_environment text, p_merchant_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
  -- Staging scanner only; configuration is supplied by private service-role edge.
  if p_checkout_environment is distinct from 'live'
     or p_merchant_id is null or p_merchant_id !~ '^[0-9]{6,20}$'
  then return jsonb_build_object('ok',false,'reason','SERVER_PROVENANCE_REQUIRED');end if;
  if not exists (select 1 from qr_payments.live_gateway_policy cfg
    where cfg.target_type='cafe_order' and cfg.enabled is true
      and cfg.merchant_id=p_merchant_id and cfg.approved_at is not null)
  then return jsonb_build_object('ok',false,'reason','LIVE_GATEWAY_POLICY_DISABLED');end if;
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

  if v_request.checkout_intent_id is not null and
     (v_request.checkout_environment is distinct from p_checkout_environment
      or v_request.checkout_merchant_id is distinct from p_merchant_id
      or v_request.checkout_gateway_reference is distinct from 'JXQR-'||v_request.id::text)
  then return jsonb_build_object('ok',false,'reason','PROVENANCE_REVIEW_REQUIRED');end if;
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
      set checkout_intent_id=v_intent.id,checkout_started_at=v_now,
          checkout_environment=p_checkout_environment,checkout_merchant_id=p_merchant_id,
          checkout_gateway_reference='JXQR-'||v_request.id::text,
          checkout_contract_version='jointx_qr_v2',updated_at=v_now
      where id=v_request.id;
  end if;

  return jsonb_build_object('ok',true,'requestId',v_request.id,
    'orderId',v_order.id,'tenantId',v_order.tenant_id,
    'orderNumber',v_order.order_number,'amountCents',v_request.amount_cents,
    'paymentIntentId',v_intent.id,'currency','ZAR',
    'customerName',v_order.customer_name,'customerEmail',v_order.customer_email);
end
$function$
;
CREATE OR REPLACE FUNCTION public.qs_opps106_settle_counter_qr_live_candidate(p_request_id uuid, p_order_id uuid, p_tenant_id uuid, p_amount_cents bigint, p_pf_payment_id text, p_raw_itn jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_order commerce.service_orders%rowtype;
  v_request qr_payments.payment_requests%rowtype;
  v_intent commerce.service_order_payments%rowtype;
  v_paid commerce.service_order_payments%rowtype;
  v_result jsonb;
  v_reason text;
begin
  if coalesce(auth.role(),'')<>'service_role' and session_user not in ('postgres','supabase_admin')
  then raise exception using errcode='42501',message='Trusted backend required';end if;
  if p_request_id is null or p_order_id is null or p_tenant_id is null
    or p_amount_cents is null or p_amount_cents<=0
    or nullif(btrim(p_pf_payment_id),'') is null then
    return jsonb_build_object('ok',false,'reason','INVALID_IDENTITY');
  end if;

  -- Lock order then QR, consistent with issuance and scan initiator.
  select * into v_order from commerce.service_orders where id=p_order_id for update;
  select * into v_request from qr_payments.payment_requests r
    where r.id=p_request_id for update;
  if not found or v_order.id is null or v_request.tenant_id<>p_tenant_id
    or v_request.target_id<>p_order_id or v_request.target_type<>'cafe_order'
    or v_order.tenant_id<>p_tenant_id or v_request.amount_cents<>p_amount_cents
    or round(v_order.total_amount*100)<>p_amount_cents
  then
    insert into qr_payments.unmatched_captures
      (gateway_payment_id,claimed_request_id,claimed_tenant_id,claimed_target_id,
       claimed_type,amount_cents,reason)
    values (btrim(p_pf_payment_id),p_request_id::text,p_tenant_id::text,
      p_order_id::text,'cafe_order',p_amount_cents,'QR_IDENTITY_MISMATCH')
    on conflict(gateway_payment_id) do nothing;
    return jsonb_build_object('ok',true,'status','review_required');
  end if;

  if v_request.checkout_environment is distinct from 'live'
    or v_request.checkout_merchant_id is distinct from p_raw_itn->>'merchant_id'
    or v_request.checkout_gateway_reference is distinct from p_raw_itn->>'m_payment_id'
    or v_request.checkout_contract_version is distinct from 'jointx_qr_v2'
    or p_raw_itn->>'payment_status' is distinct from 'COMPLETE'
    or not exists (
      select 1 from qr_payments.live_gateway_policy cfg
      where cfg.target_type='cafe_order' and cfg.merchant_id is not null
        and cfg.merchant_id=v_request.checkout_merchant_id
        and cfg.approved_at is not null)
  then
    insert into qr_payments.payment_exceptions
       (payment_request_id,gateway_payment_id,reason,amount_cents)
    values(p_request_id,btrim(p_pf_payment_id),'GATEWAY_PROVENANCE_MISMATCH',p_amount_cents)
    on conflict(payment_request_id,gateway_payment_id,reason) do nothing;
    return jsonb_build_object('ok',true,'status','review_required');
  end if;
  if v_request.status='settled' then
    if v_request.gateway_payment_id=btrim(p_pf_payment_id) then
      return jsonb_build_object('ok',true,'status','replayed'); end if;
    insert into qr_payments.payment_exceptions
      (payment_request_id,gateway_payment_id,reason,amount_cents)
    values (p_request_id,btrim(p_pf_payment_id),'ADDITIONAL_CAPTURE',p_amount_cents)
    on conflict(payment_request_id,gateway_payment_id,reason) do nothing;
    return jsonb_build_object('ok',true,'status','review_required');
  end if;

  -- Require trusted, persisted checkout identity before any new receipt.
  if v_request.checkout_environment is distinct from 'live'
     or v_request.checkout_merchant_id is null
     or v_request.checkout_merchant_id is distinct from p_raw_itn->>'merchant_id'
     or v_request.checkout_gateway_reference is distinct from p_raw_itn->>'m_payment_id'
     or v_request.checkout_contract_version is distinct from 'jointx_qr_v2'
     or p_raw_itn->>'payment_status' is distinct from 'COMPLETE'
     or p_raw_itn->>'custom_str2' is distinct from 'jointx_qr_v1'
  then
    insert into qr_payments.payment_exceptions
      (payment_request_id,gateway_payment_id,reason,amount_cents)
    values(p_request_id,btrim(p_pf_payment_id),'QR_CHECKOUT_PROVENANCE_REVIEW',p_amount_cents)
    on conflict(payment_request_id,gateway_payment_id,reason) do nothing;
    return jsonb_build_object('ok',true,'status','review_required');
  end if;
  select * into v_intent from commerce.service_order_payments
  where id=v_request.checkout_intent_id and tenant_id=p_tenant_id
    and service_order_id=p_order_id and provider='payfast';

  -- Verified late/changed captures MUST remain auditable, not credited blindly.
  if v_request.checkout_started_at is null
    or v_request.checkout_started_at>v_request.expires_at
    or v_request.checkout_started_at>clock_timestamp()
    or clock_timestamp()>v_request.checkout_started_at+interval '60 minutes'
    or v_request.status<>'active'
    or v_intent.id is null or v_intent.status<>'pending'
    or round(v_intent.amount*100)<>p_amount_cents
    or v_order.payment_status not in ('unpaid','pending')
    or v_order.status in ('cancelled','completed')
    or exists(select 1 from commerce.service_order_payments p
       where p.service_order_id=p_order_id and p.tenant_id=p_tenant_id
         and p.status='completed')
  then
    insert into qr_payments.payment_exceptions
      (payment_request_id,gateway_payment_id,reason,amount_cents)
    values(p_request_id,btrim(p_pf_payment_id),'CAPTURE_REQUIRES_RECONCILIATION',p_amount_cents)
    on conflict(payment_request_id,gateway_payment_id,reason) do nothing;
    if v_request.status='active' then
      update qr_payments.payment_requests
      set status='revoked',checkout_url=null,updated_at=now()
      where id=p_request_id;
    end if;
    return jsonb_build_object('ok',true,'status','review_required');
  end if;

  -- Canonical Café ledger updates and linked OPPS projection remain inside
  -- THIS transaction, not after a separate API call.
  v_result := commerce.qs_apply_payfast_payment(p_order_id,
    p_amount_cents::numeric/100,btrim(p_pf_payment_id),coalesce(p_raw_itn,'{}'::jsonb));
  if v_result->>'ok' is distinct from 'true' or v_result->>'ignored'='true'
  then raise exception using errcode='P0001',message='Canonical receipt not committed';end if;

  select * into v_paid from commerce.service_order_payments
  where tenant_id=p_tenant_id and service_order_id=p_order_id
    and provider='payfast' and status='completed'
    and pf_payment_id=btrim(p_pf_payment_id) limit 1;
  if v_paid.id is null or round(v_paid.amount*100)<>p_amount_cents
  then raise exception using errcode='P0001',message='Canonical receipt missing';end if;

  update qr_payments.payment_requests set status='settled',
    checkout_url=null,gateway_payment_id=btrim(p_pf_payment_id),
    gateway_environment='live',
    gateway_environment_evidence='payfast_itn_validated_live',
    updated_at=now()
  where id=p_request_id;
  return jsonb_build_object('ok',true,'status','settled',
    'projectionReviewRequired',coalesce((v_result->>'projectionReviewRequired')::boolean,false));
end
$function$
;
CREATE OR REPLACE FUNCTION public.qs_opps106_record_counter_qr_noncomplete_live_candidate(p_request_id uuid, p_order_id uuid, p_tenant_id uuid, p_amount_cents bigint, p_pf_payment_id text, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_order commerce.service_orders%rowtype;
  v_request qr_payments.payment_requests%rowtype;
  v_intent commerce.service_order_payments%rowtype;
  v_handling text;
begin
  if coalesce(auth.role(),'')<>'service_role'
     and session_user not in ('postgres','supabase_admin')
  then raise exception using errcode='42501',message='Trusted backend required';end if;
  if p_request_id is null or p_order_id is null or p_tenant_id is null
    or p_amount_cents is null or p_amount_cents<=0
    or p_status not in ('failed','cancelled')
    or nullif(btrim(p_pf_payment_id),'') is null then
    return jsonb_build_object('ok',false,'reason','INVALID_INPUT');end if;

  -- Same order -> QR row lock discipline as issue and settle.
  select * into v_order from commerce.service_orders
   where id=p_order_id for update;
  select * into v_request from qr_payments.payment_requests
   where id=p_request_id for update;

  if v_order.id is null or v_request.id is null
    or v_order.tenant_id<>p_tenant_id or v_request.tenant_id<>p_tenant_id
    or v_request.target_type<>'cafe_order'
    or v_request.checkout_environment is distinct from 'live'
    or v_request.checkout_merchant_id is null
    or not exists(select 1 from qr_payments.live_gateway_policy cfg
       where cfg.target_type='cafe_order' and cfg.merchant_id is not null
         and cfg.merchant_id=v_request.checkout_merchant_id
         and cfg.approved_at is not null)
    or v_request.target_id<>p_order_id
    or v_request.amount_cents<>p_amount_cents
    or round(v_order.total_amount*100)<>p_amount_cents
  then
    v_handling:='mismatched';
  elsif v_request.status='settled' then
    v_handling:='already_settled';
  else
    select * into v_intent from commerce.service_order_payments
    where id=v_request.checkout_intent_id
      and service_order_id=p_order_id and tenant_id=p_tenant_id
      and provider='payfast';
    if v_intent.id is null or
      round(v_intent.amount*100)<>p_amount_cents or
      v_request.checkout_started_at is null or
      v_request.checkout_started_at>v_request.expires_at or
      v_intent.status<>'pending'
    then v_handling:='late_or_stale';
    else
      update commerce.service_order_payments
       set status=p_status,updated_at=now()
       where id=v_intent.id and status='pending';
      if v_request.status='active' then
        update qr_payments.payment_requests
          set status='revoked',checkout_url=null,updated_at=now()
          where id=v_request.id;
      end if;
      v_handling:='closed';
    end if;
  end if;

  -- Record even mismatched/orphan events, without customer PII.
  -- Unique identity guarantees repeated delivery cannot create more rows.
  insert into qr_payments.noncomplete_events
    (gateway_payment_id,event_status,claimed_request_id,claimed_order_id,
     claimed_tenant_id,amount_cents,handling)
  values (btrim(p_pf_payment_id),p_status,p_request_id,p_order_id,
     p_tenant_id,p_amount_cents,v_handling)
  on conflict(gateway_payment_id,event_status,claimed_request_id) do nothing;

  return jsonb_build_object('ok',true,'status',v_handling);
end
$function$
;
revoke all on function public.qs_opps106_start_counter_qr_checkout_live_candidate(uuid,text,text) from public,anon,authenticated;
grant execute on function public.qs_opps106_start_counter_qr_checkout_live_candidate(uuid,text,text) to service_role;
revoke all on function public.qs_opps106_settle_counter_qr_live_candidate(uuid,uuid,uuid,bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.qs_opps106_settle_counter_qr_live_candidate(uuid,uuid,uuid,bigint,text,jsonb) to service_role;
revoke all on function public.qs_opps106_record_counter_qr_noncomplete_live_candidate(uuid,uuid,uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function public.qs_opps106_record_counter_qr_noncomplete_live_candidate(uuid,uuid,uuid,bigint,text,text) to service_role;
-- Issuance remains disabled by default. No production deployment authorized.
