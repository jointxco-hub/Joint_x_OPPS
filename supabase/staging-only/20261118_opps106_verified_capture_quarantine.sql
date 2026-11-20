-- OPPS-106 staging only: durable audit for verified PayFast ITN captures
-- which do NOT have a matching server-bound checkout environment.
-- No receipt writes, QR activation, or manual-payment release.
alter table qr_payments.payment_exceptions
 drop constraint payment_exceptions_reason_check;
alter table qr_payments.payment_exceptions
 add constraint payment_exceptions_reason_check check (
  reason in ('ADDITIONAL_CAPTURE','CAPTURE_REQUIRES_RECONCILIATION',
    'QR_CHECKOUT_PROVENANCE_REVIEW','GATEWAY_PROVENANCE_MISMATCH')
 );

create or replace function public.qs_opps106_quarantine_verified_qr_capture(
  p_request_id uuid,p_order_id uuid,p_tenant_id uuid,
  p_amount_cents bigint,p_pf_payment_id text,p_reason text
) returns jsonb language plpgsql security definer set search_path='pg_catalog'
as $function$
declare v qr_payments.payment_requests%rowtype;
begin
 if coalesce(auth.role(),'') <> 'service_role'
   and session_user not in ('postgres','supabase_admin')
 then raise exception using errcode='42501',message='Trusted backend required';end if;
 if p_request_id is null or p_order_id is null or p_tenant_id is null
   or p_amount_cents is null or p_amount_cents<=0
   or nullif(btrim(p_pf_payment_id),'') is null
   or p_reason not in ('QR_CHECKOUT_PROVENANCE_REVIEW','GATEWAY_PROVENANCE_MISMATCH')
 then return jsonb_build_object('ok',false,'reason','INVALID_IDENTITY');end if;
 select * into v from qr_payments.payment_requests
  where id=p_request_id for update;
 if v.id is null or v.target_type <> 'cafe_order'
   or v.tenant_id <> p_tenant_id or v.target_id <> p_order_id
 then
   insert into qr_payments.unmatched_captures (
     gateway_payment_id,claimed_request_id,claimed_tenant_id,claimed_target_id,
     claimed_type,amount_cents,reason
   ) values (
     btrim(p_pf_payment_id),p_request_id::text,p_tenant_id::text,p_order_id::text,
     'cafe_order',p_amount_cents,'QR_IDENTITY_MISMATCH'
   ) on conflict(gateway_payment_id) do nothing;
 else
   insert into qr_payments.payment_exceptions
     (payment_request_id,gateway_payment_id,reason,amount_cents)
   values(p_request_id,btrim(p_pf_payment_id),p_reason,p_amount_cents)
   on conflict(payment_request_id,gateway_payment_id,reason) do nothing;
 end if;
 return jsonb_build_object('ok',true,'status','review_required');
end $function$;
revoke all on function public.qs_opps106_quarantine_verified_qr_capture(
 uuid,uuid,uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function public.qs_opps106_quarantine_verified_qr_capture(
 uuid,uuid,uuid,bigint,text,text) to service_role;
