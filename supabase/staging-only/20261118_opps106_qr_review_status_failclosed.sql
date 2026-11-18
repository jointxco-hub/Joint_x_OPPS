-- OPPS-106 staging only: immutable audit events and conservative review state.
-- A second staff confirmation is NOT independent PayFast proof and does not
-- authorize a payment, change an order, or release a Cash/Card hold.
create or replace function qr_payments.qs106_deny_review_event_mutation()
returns trigger language plpgsql set search_path='pg_catalog'
as $$
begin
 raise exception using errcode='42501',
  message='QR checkout review history is append-only';
end $$;

drop trigger if exists qs106_review_events_append_only
 on qr_payments.checkout_review_events;
create trigger qs106_review_events_append_only
 before update or delete on qr_payments.checkout_review_events
 for each row execute function qr_payments.qs106_deny_review_event_mutation();

create or replace function public.qs_opps106_get_qr_checkout_review_status(p_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $function$
declare
 v_tenant uuid;
 v_order commerce.service_orders%rowtype;
 v_request qr_payments.payment_requests%rowtype;
 v_report record;
 v_second record;
 v_capture boolean := false;
 v_escalated boolean := false;
 v_events integer := 0;
begin
 if auth.uid() is null or not public.is_opps_staff()
 then raise exception using errcode='42501',message='OPPS staff access required';end if;
 select id into v_tenant from public.tenants
 where slug='quick-solution' and status='active' limit 1;
 if v_tenant is null or not public.has_tenant_capability(v_tenant,'cafe.operations.manage')
 then raise exception using errcode='42501',message='Café operations access required';end if;

 select * into v_request from qr_payments.payment_requests
 where id=p_request_id and tenant_id=v_tenant and target_type='cafe_order';
 if v_request.id is null then return jsonb_build_object('ok',false,'reason','NOT_FOUND');end if;
 select * into v_order from commerce.service_orders
 where id=v_request.target_id and tenant_id=v_tenant;
 if v_order.id is null then return jsonb_build_object('ok',false,'reason','NOT_FOUND');end if;

 select count(*)::integer,
   coalesce(bool_or(event_type='provider_capture_reported'),false),
   coalesce(bool_or(event_type='escalated'),false)
 into v_events,v_capture,v_escalated
 from qr_payments.checkout_review_events
 where payment_request_id=p_request_id and tenant_id=v_tenant;

 select e.actor_user_id,e.provider_reference,e.created_at
 into v_report from qr_payments.checkout_review_events e
 where e.payment_request_id=p_request_id and e.tenant_id=v_tenant
   and e.event_type='provider_no_capture_reported'
 order by e.created_at desc,e.id desc limit 1;

 if v_report.provider_reference is not null then
   select e.actor_user_id,e.created_at
   into v_second from qr_payments.checkout_review_events e
   where e.payment_request_id=p_request_id and e.tenant_id=v_tenant
    and e.event_type='second_review_confirmed'
    and e.provider_reference=v_report.provider_reference
    and e.actor_user_id<>v_report.actor_user_id
    and e.created_at>=v_report.created_at
   order by e.created_at desc,e.id desc limit 1;
 end if;

 return jsonb_build_object(
   'ok',true,'paymentRequestId',v_request.id,'orderNumber',v_order.order_number,
   'paymentStatus',v_order.payment_status,'qrStatus',v_request.status,
   'hasCompletedReceipt',exists(
      select 1 from commerce.service_order_payments cp
      where cp.tenant_id=v_tenant and cp.service_order_id=v_order.id
       and cp.status='completed'),
   'reviewEventCount',v_events,
   'hasReportedCapture',v_capture,
   'escalated',v_escalated,
   'firstReviewRecorded',v_report.actor_user_id is not null,
   'independentSecondReviewRecorded',v_second.actor_user_id is not null,
   'state',case
      when v_request.status='settled' or v_order.payment_status='paid'
      then 'PAYMENT_ALREADY_RECORDED'
      when exists(select 1 from commerce.service_order_payments cp
        where cp.tenant_id=v_tenant and cp.service_order_id=v_order.id and cp.status='completed')
      then 'PAYMENT_ALREADY_RECORDED'
      when v_capture then 'CAPTURE_REPORTED_ESCALATE'
      when v_second.actor_user_id is not null
      then 'TWO_STAFF_REPORTS_RECORDED_PROVIDER_VERIFICATION_STILL_REQUIRED'
      when v_report.actor_user_id is not null
      then 'FIRST_PROVIDER_REPORT_RECORDED_SECOND_REVIEW_REQUIRED'
      when v_escalated then 'ESCALATED_AWAIT_PROVIDER_VERIFICATION'
      else 'AWAITING_PROVIDER_VERIFICATION' end,
   'cashCardHoldReleased',false,
   'gatewayNoCaptureAttested',false
 );
end $function$;
revoke all on function public.qs_opps106_get_qr_checkout_review_status(uuid)
 from public,anon,authenticated;
grant execute on function public.qs_opps106_get_qr_checkout_review_status(uuid)
 to authenticated;
