-- OPPS-106 STAGING CANARY ONLY. Not a generic production payment gateway
-- environment oracle. This callback can only process sandbox merchant ITNs.
alter table qr_payments.payment_requests
  add column gateway_environment text,
  add column gateway_environment_evidence text;
alter table qr_payments.payment_requests
  add constraint qr_payment_environment_evidence_pair
  check (
    (gateway_environment is null and gateway_environment_evidence is null)
    or (gateway_environment in ('sandbox','live')
        and gateway_environment_evidence in ('sandbox_only_verified_itn'))
  );
-- Historical records: only backfill proven completed sandbox-canary captures
-- on this dedicated staging project. No other QR requests qualify.
update qr_payments.payment_requests r
set gateway_environment='sandbox',
    gateway_environment_evidence='sandbox_only_verified_itn'
from commerce.service_order_payments p
where r.status='settled' and r.target_type='cafe_order'
  and p.service_order_id=r.target_id and p.tenant_id=r.tenant_id
  and p.status='completed' and p.provider='payfast'
  and p.pf_payment_id=r.gateway_payment_id
  and round(p.amount*100)::bigint=r.amount_cents
  and p.raw_itn->>'payment_status'='COMPLETE'
  and p.raw_itn->>'custom_str2'='jointx_qr_v1'
  and p.raw_itn->>'m_payment_id'='JXQR-'||r.id::text;

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
CREATE OR REPLACE FUNCTION commerce.qs_opps106_verified_sandbox_qr_link(p_service_order_id uuid, p_opps_order_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
 select exists (
  select 1 from commerce.service_orders so
  join public.orders o on o.id=so.opps_order_id and o.tenant_id=so.tenant_id
    and o.source='quick_solution'
  join qr_payments.payment_requests r on r.target_id=so.id
    and r.target_type='cafe_order' and r.tenant_id=so.tenant_id
    and r.status='settled' and r.gateway_payment_id is not null
    and r.gateway_environment='sandbox'
    and r.gateway_environment_evidence='sandbox_only_verified_itn'
    and r.checkout_started_at is not null
    and r.amount_cents=round(so.total_amount*100)::bigint
  join commerce.service_order_payments p on p.service_order_id=so.id
    and p.tenant_id=so.tenant_id and p.status='completed'
    and p.provider='payfast' and p.pf_payment_id=r.gateway_payment_id
    and round(p.amount*100)::bigint=r.amount_cents
    and p.raw_itn->>'payment_status'='COMPLETE'
    and p.raw_itn->>'m_payment_id'='JXQR-'||r.id::text
  where so.id=p_service_order_id and o.id=p_opps_order_id
    and so.payment_status='paid'
 );
$function$
;
