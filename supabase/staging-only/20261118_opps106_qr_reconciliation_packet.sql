-- OPPS-106 STAGING ONLY. Read-only reconciliation packet for merchant
-- Transaction History / PayFast support. It does not attest "no capture".
-- Never includes checkout URLs, passphrases, raw ITN, customer PII or tokens.
create or replace function public.qs_opps106_get_qr_reconciliation_packet(p_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $function$
declare
 v_tenant uuid;
 v_request qr_payments.payment_requests%rowtype;
 v_order commerce.service_orders%rowtype;
 v_receipts integer;
 v_gateway_completed integer;
 v_payfast_pending integer;
 v_exception_count integer;
 v_noncomplete_count integer;
 v_review_count integer;
begin
 if auth.uid() is null or not public.is_opps_staff() then
   raise exception using errcode='42501',message='OPPS staff access required';
 end if;
 select id into v_tenant from public.tenants
 where slug='quick-solution' and status='active' limit 1;
 if v_tenant is null
   or not public.has_tenant_capability(v_tenant,'cafe.operations.manage') then
   raise exception using errcode='42501',message='Café operations access required';
 end if;
 if p_request_id is null then
   return jsonb_build_object('ok',false,'reason','INVALID_REQUEST');
 end if;
 select * into v_request from qr_payments.payment_requests
 where id=p_request_id and tenant_id=v_tenant and target_type='cafe_order';
 if v_request.id is null then
   return jsonb_build_object('ok',false,'reason','NOT_FOUND');
 end if;
 select * into v_order from commerce.service_orders
 where id=v_request.target_id and tenant_id=v_tenant;
 if v_order.id is null then
   return jsonb_build_object('ok',false,'reason','NOT_FOUND');
 end if;
 select count(*)::integer,
   count(*) filter(where provider='payfast' and status='completed')::integer,
   count(*) filter(where provider='payfast' and status='pending')::integer
 into v_receipts,v_gateway_completed,v_payfast_pending
 from commerce.service_order_payments
 where tenant_id=v_tenant and service_order_id=v_order.id and status in ('pending','completed');
 select count(*)::integer into v_exception_count
 from qr_payments.payment_exceptions where payment_request_id=v_request.id;
 select count(*)::integer into v_noncomplete_count
 from qr_payments.noncomplete_events
 where claimed_request_id=v_request.id and claimed_tenant_id=v_tenant;
 select count(*)::integer into v_review_count
 from qr_payments.checkout_review_events
 where payment_request_id=v_request.id and tenant_id=v_tenant;
 return jsonb_build_object(
   'ok',true,'orderNumber',v_order.order_number,
   'paymentRequestId',v_request.id,
   'gatewayReference',coalesce(v_request.checkout_gateway_reference,
                                      'JXQR-'||v_request.id::text),
   'gatewayReferenceProvenance',case when v_request.checkout_gateway_reference is not null
                                 then 'server_bound' else 'legacy_derived' end,
   'merchantId',v_request.checkout_merchant_id,
   'checkoutEnvironment',v_request.checkout_environment,
   'currency',v_request.currency_code,
   'amountCents',v_request.amount_cents,
   'qrStatus',v_request.status,
   'orderPaymentStatus',v_order.payment_status,
   'checkoutStartedAt',v_request.checkout_started_at,
   'qrExpiresAt',v_request.expires_at,
   'gatewayPaymentId',v_request.gateway_payment_id,
   'completedReceipts',v_gateway_completed,
   'pendingPayfastIntents',v_payfast_pending,
   'allPaymentRecords',v_receipts,
   'exceptionEvents',v_exception_count,
   'noncompleteNotifications',v_noncomplete_count,
   'staffReviewEvents',v_review_count,
   'providerOutcomeVerified',false,
   'noCaptureVerified',false,
   'cashCardHoldReleased',false,
   'instruction','Match the exact gateway reference, merchant and amount in PayFast Transaction History or support. Missing records or expired QR alone are not proof of no capture.'
 );
end $function$;
revoke all on function public.qs_opps106_get_qr_reconciliation_packet(uuid)
 from public,anon,authenticated;
grant execute on function public.qs_opps106_get_qr_reconciliation_packet(uuid)
 to authenticated;
