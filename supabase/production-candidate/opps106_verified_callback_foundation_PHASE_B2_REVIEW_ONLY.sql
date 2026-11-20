-- OPPS-106 PHASE B2: callback identity and exception-logging foundation.
-- REVIEW ONLY / NEVER APPLY TO PRODUCTION OR STAGING AUTOMATICALLY.
-- Depends on clean Phase A private QR schema and reviewed Phase B1 Counter guard.
-- No issuer enable, no scanner URLs, no PayFast request, no receipt/Finance mutation.
do $prereq$
begin
 if to_regclass('qr_payments.payment_requests') is null
   or to_regclass('qr_payments.payment_exceptions') is null
   or to_regclass('qr_payments.unmatched_captures') is null
   or to_regclass('qr_payments.issuance_controls') is null
 then raise exception 'OPPS106_PHASE_A_REQUIRED';end if;
 if to_regprocedure('public.qs_opps106_counter_qr_preflight(uuid)') is null
   or to_regprocedure('public.qs_opps106_issue_counter_qr(uuid,text)') is null
 then raise exception 'OPPS106_PHASE_B1_REQUIRED';end if;
 if exists(select 1 from qr_payments.issuance_controls where enabled)
 then raise exception 'OPPS106_ISSUANCE_MUST_REMAIN_OFF';end if;
 if to_regprocedure('public.qs_opps106_settle_counter_qr_live_candidate(uuid,uuid,uuid,bigint,text,jsonb)') is not null
 then raise exception 'OPPS106_LIVE_SETTLEMENT_ALREADY_PRESENT_REVIEW';end if;
end $prereq$;

-- Expand Phase A exception reasons before any verified mismatch is handled.
-- Using the actual Phase A constraint name; never disable RLS.
alter table qr_payments.payment_exceptions
 drop constraint payment_exceptions_reason_check;
alter table qr_payments.payment_exceptions
 add constraint payment_exceptions_reason_check check (
   reason in (
     'ADDITIONAL_CAPTURE','CAPTURE_REQUIRES_RECONCILIATION',
     'QR_CHECKOUT_PROVENANCE_REVIEW','GATEWAY_PROVENANCE_MISMATCH'
   )
 );

-- Private callback-only checkout identity. Does not claim provider confirmation
-- or a final no-capture result. It returns only server-issued identity.
create or replace function public.qs_opps106_get_counter_qr_checkout_identity(
 p_request_id uuid
) returns jsonb
language plpgsql stable security definer set search_path='pg_catalog'
as $identity$
declare v qr_payments.payment_requests%rowtype;
begin
 if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role'
    and session_user not in ('postgres','supabase_admin')
 then raise exception using errcode='42501',message='Trusted backend required';end if;
 if p_request_id is null then
   return jsonb_build_object('ok',false,'reason','INVALID_IDENTITY');end if;
 select * into v from qr_payments.payment_requests
 where id=p_request_id and target_type='cafe_order';
 if v.id is null or v.checkout_started_at is null
    or v.checkout_intent_id is null
    or v.checkout_environment not in ('sandbox','live')
    or nullif(v.checkout_merchant_id,'') is null
    or v.checkout_gateway_reference is distinct from 'JXQR-'||v.id::text
    or v.checkout_contract_version is distinct from 'jointx_qr_v2'
 then return jsonb_build_object('ok',false,'reason','PROVENANCE_REVIEW_REQUIRED');end if;
 return jsonb_build_object(
   'ok',true,'requestId',v.id,'orderId',v.target_id,
   'tenantId',v.tenant_id,'amountCents',v.amount_cents,
   'environment',v.checkout_environment,
   'merchantId',v.checkout_merchant_id,
   'gatewayReference',v.checkout_gateway_reference
 );
end $identity$;
revoke all on function public.qs_opps106_get_counter_qr_checkout_identity(uuid)
 from public,anon,authenticated;
grant execute on function public.qs_opps106_get_counter_qr_checkout_identity(uuid)
 to service_role;

-- Provider-verified mismatch only; the Edge Function MUST verify source,
-- signature and remote PayFast VALID before calling. No receipt is created.
create or replace function public.qs_opps106_quarantine_verified_qr_capture(
 p_request_id uuid,p_order_id uuid,p_tenant_id uuid,p_amount_cents bigint,
 p_pf_payment_id text,p_reason text
) returns jsonb language plpgsql security definer set search_path='pg_catalog'
as $quarantine$
declare v qr_payments.payment_requests%rowtype;
  v_order uuid;
  v_ref text:=nullif(btrim(coalesce(p_pf_payment_id,'')),'');
begin
 if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role'
    and session_user not in ('postgres','supabase_admin')
 then raise exception using errcode='42501',message='Trusted backend required';end if;
 if p_request_id is null or p_order_id is null or p_tenant_id is null
   or p_amount_cents is null or p_amount_cents<=0
   or v_ref is null or length(v_ref)>180
   or p_reason not in ('QR_CHECKOUT_PROVENANCE_REVIEW','GATEWAY_PROVENANCE_MISMATCH')
 then return jsonb_build_object('ok',false,'reason','INVALID_IDENTITY');end if;
 -- Match canonical order -> QR lock order used by issuer and settlement.
 select so.id into v_order from commerce.service_orders so
 where so.id=p_order_id and so.tenant_id=p_tenant_id for update;
 select * into v from qr_payments.payment_requests
 where id=p_request_id for update;
 if v_order is null or v.id is null
    or v.target_type<>'cafe_order'
    or v.tenant_id is distinct from p_tenant_id
    or v.target_id is distinct from p_order_id
 then
   insert into qr_payments.unmatched_captures(
     gateway_payment_id,claimed_request_id,claimed_tenant_id,claimed_target_id,
     claimed_type,amount_cents,reason
   ) values(
     v_ref,p_request_id::text,p_tenant_id::text,p_order_id::text,
     'cafe_order',p_amount_cents,'QR_IDENTITY_MISMATCH'
   ) on conflict(gateway_payment_id) do nothing;
 else
   insert into qr_payments.payment_exceptions(
     payment_request_id,gateway_payment_id,reason,amount_cents
   ) values(p_request_id,v_ref,p_reason,p_amount_cents)
   on conflict(payment_request_id,gateway_payment_id,reason) do nothing;
 end if;
 return jsonb_build_object('ok',true,'status','review_required');
end $quarantine$;
revoke all on function public.qs_opps106_quarantine_verified_qr_capture(
 uuid,uuid,uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function public.qs_opps106_quarantine_verified_qr_capture(
 uuid,uuid,uuid,bigint,text,text) to service_role;

-- This phase adds no settled checkout; legacy/unknown captures stay on hold.
do $invariant$
begin
 if exists(select 1 from qr_payments.issuance_controls where enabled)
 then raise exception 'OPPS106_ISSUER_ENABLED_DURING_B2';end if;
end $invariant$;
