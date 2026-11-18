-- OPPS-106 staging-only: persist immutable issuing checkout identity.
-- This does not enable QR or live mode; caller must be service_role.
alter table qr_payments.payment_requests
 add column checkout_environment text,
 add column checkout_merchant_id text,
 add column checkout_gateway_reference text,
 add column checkout_contract_version text;
alter table qr_payments.payment_requests
 add constraint qs106_checkout_provenance_bundle
 check (
   (checkout_environment is null and checkout_merchant_id is null
    and checkout_gateway_reference is null and checkout_contract_version is null)
   or
   (checkout_environment in ('sandbox','live')
    and checkout_merchant_id ~ '^[0-9]{6,20}$'
    and checkout_gateway_reference is not null
    and checkout_contract_version = 'jointx_qr_v2')
 );
-- No existing started QR records are silently backfilled. Unbound
-- historical attempts remain review-required.

-- Deprecate unsafe original one-argument scanner initiation.
create or replace function public.qs_opps106_start_counter_qr_checkout(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = 'pg_catalog'
as $$
begin
 return jsonb_build_object('ok',false,'reason','SERVER_PROVENANCE_REQUIRED');
end $$;
revoke all on function public.qs_opps106_start_counter_qr_checkout(uuid) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.qs_opps106_start_counter_qr_checkout_verified(p_request_id uuid, p_checkout_environment text, p_merchant_id text)
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
  if p_checkout_environment is distinct from 'sandbox'
     or p_merchant_id is null or p_merchant_id !~ '^[0-9]{6,20}$'
  then return jsonb_build_object('ok',false,'reason','SERVER_PROVENANCE_REQUIRED');end if;
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
revoke all on function public.qs_opps106_start_counter_qr_checkout_verified(uuid,text,text) from public,anon,authenticated;
grant execute on function public.qs_opps106_start_counter_qr_checkout_verified(uuid,text,text) to service_role;

-- Trusted read-only context for the separately verified PayFast callback.
create or replace function public.qs_opps106_get_counter_qr_checkout_identity(p_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path = 'pg_catalog'
as $$
declare v qr_payments.payment_requests%rowtype;
begin
 if coalesce(auth.role(),'')<>'service_role'
    and session_user not in ('postgres','supabase_admin')
 then raise exception using errcode='42501',message='Trusted backend required';end if;
 select * into v from qr_payments.payment_requests
 where id=p_request_id and target_type='cafe_order';
 if v.id is null or v.checkout_started_at is null
    or v.checkout_environment is null or v.checkout_merchant_id is null
    or v.checkout_gateway_reference is null or v.checkout_contract_version<>'jointx_qr_v2'
 then return jsonb_build_object('ok',false,'reason','PROVENANCE_REVIEW_REQUIRED');end if;
 return jsonb_build_object('ok',true,
   'requestId',v.id,'orderId',v.target_id,'tenantId',v.tenant_id,
   'amountCents',v.amount_cents,'environment',v.checkout_environment,
   'merchantId',v.checkout_merchant_id,
   'gatewayReference',v.checkout_gateway_reference);
end $$;
revoke all on function public.qs_opps106_get_counter_qr_checkout_identity(uuid)
 from public,anon,authenticated;
grant execute on function public.qs_opps106_get_counter_qr_checkout_identity(uuid) to service_role;

CREATE OR REPLACE FUNCTION public.qs_opps106_settle_counter_qr(p_request_id uuid, p_order_id uuid, p_tenant_id uuid, p_amount_cents bigint, p_pf_payment_id text, p_raw_itn jsonb)
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
  if v_request.checkout_environment is distinct from 'sandbox'
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
    gateway_environment='sandbox',
    gateway_environment_evidence='sandbox_only_verified_itn',
    updated_at=now()
  where id=p_request_id;
  return jsonb_build_object('ok',true,'status','settled',
    'projectionReviewRequired',coalesce((v_result->>'projectionReviewRequired')::boolean,false));
end
$function$
;
-- No QR issued; all controls stay OFF.
