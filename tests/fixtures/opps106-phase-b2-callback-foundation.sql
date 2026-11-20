-- Phase B2 integration against Phase A + production-derived Phase B1 (disposable).
-- Synthetic provider claims ONLY: this is NOT proof of PayFast VALID, and no money.
\set ON_ERROR_STOP on
insert into commerce.service_orders(id,tenant_id,total_amount,order_number)
values('00000000-0000-4000-8000-000000000005',
 '11111111-1111-4111-8111-111111111111',60,'QS-FAKE-VERIFIED');
insert into commerce.service_order_payments(id,tenant_id,service_order_id,provider,status,amount)
values('88888888-8888-4888-8888-888888888888',
 '11111111-1111-4111-8111-111111111111',
 '00000000-0000-4000-8000-000000000005','payfast','pending',60);
insert into qr_payments.payment_requests(
 id,tenant_id,target_type,target_id,operation_key,amount_cents,status,
 checkout_url,created_at,expires_at,checkout_intent_id,checkout_started_at,
 checkout_environment,checkout_merchant_id,checkout_gateway_reference,checkout_contract_version
) values (
 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 '11111111-1111-4111-8111-111111111111','cafe_order',
 '00000000-0000-4000-8000-000000000005','fake_verified_0005',6000,
 'active','https://example.invalid/fake',now()-interval '1 minute',
 now()+interval '3 minutes','88888888-8888-4888-8888-888888888888',
 now()-interval '30 seconds','live','15000100',
 'JXQR-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','jointx_qr_v2'
);
do $test$
declare
 v_request uuid:='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 v_order uuid:='00000000-0000-4000-8000-000000000005';
 v_tenant uuid:='11111111-1111-4111-8111-111111111111';
 v_before integer;
 v_return jsonb;
begin
 if has_function_privilege('anon','public.qs_opps106_get_counter_qr_checkout_identity(uuid)','EXECUTE')
   or has_function_privilege('authenticated','public.qs_opps106_get_counter_qr_checkout_identity(uuid)','EXECUTE')
   or has_function_privilege('anon','public.qs_opps106_quarantine_verified_qr_capture(uuid,uuid,uuid,bigint,text,text)','EXECUTE')
   or has_function_privilege('authenticated','public.qs_opps106_quarantine_verified_qr_capture(uuid,uuid,uuid,bigint,text,text)','EXECUTE')
 then raise exception 'CALLBACK_PRIVILEGES_PUBLIC';end if;

 v_return:=public.qs_opps106_get_counter_qr_checkout_identity(v_request);
 if v_return->>'ok' <> 'true'
   or v_return->>'environment'<>'live'
   or v_return->>'merchantId'<>'15000100'
   or v_return->>'amountCents'<>'6000'
   or v_return->>'gatewayReference'<>'JXQR-'||v_request::text
 then raise exception 'CHECKOUT_IDENTITY_UNSAFE: %',v_return;end if;

 v_return:=public.qs_opps106_get_counter_qr_checkout_identity(
 'aaaa0000-0000-4000-8000-000000000002');
 if v_return->>'ok'<>'false'
 then raise exception 'HISTORIC_UNBOUND_QR_TREATED_AS_VERIFIED';end if;

 select count(*) into v_before from qr_payments.payment_exceptions;
 v_return:=public.qs_opps106_quarantine_verified_qr_capture(
   v_request,v_order,v_tenant,6000,'fake-itn-mismatch-0001',
   'GATEWAY_PROVENANCE_MISMATCH');
 if v_return->>'status'<>'review_required' then raise exception 'QUARANTINE_FAILED';end if;
 perform public.qs_opps106_quarantine_verified_qr_capture(
   v_request,v_order,v_tenant,6000,'fake-itn-mismatch-0001',
   'GATEWAY_PROVENANCE_MISMATCH');
 if (select count(*) from qr_payments.payment_exceptions)<>v_before+1
 then raise exception 'DUPLICATE_EXCEPTION';end if;

 perform public.qs_opps106_quarantine_verified_qr_capture(
   v_request,'00000000-0000-4000-8000-000000000003',v_tenant,
   6000,'fake-itn-unmatched-0001','QR_CHECKOUT_PROVENANCE_REVIEW');
 perform public.qs_opps106_quarantine_verified_qr_capture(
   v_request,'00000000-0000-4000-8000-000000000003',v_tenant,
   6000,'fake-itn-unmatched-0001','QR_CHECKOUT_PROVENANCE_REVIEW');
 if (select count(*) from qr_payments.unmatched_captures
     where gateway_payment_id='fake-itn-unmatched-0001')<>1
 then raise exception 'UNMATCHED_CAPTURE_NOT_DURABLE';end if;

 if (select status from qr_payments.payment_requests where id=v_request)<>'active'
   or (select count(*) from commerce.service_order_payments
      where service_order_id=v_order and status='completed')<>0
   or (select payment_status from commerce.service_orders where id=v_order)<>'unpaid'
 then raise exception 'QUARANTINE_CHANGED_PAYMENT_STATE';end if;
 if (select count(*) from qr_payments.issuance_controls where enabled)<>0
 then raise exception 'ISSUER_TOGGLED_ON';end if;

 v_return:=public.qs_opps106_quarantine_verified_qr_capture(
   v_request,v_order,v_tenant,0,'fake-itn-invalid','GATEWAY_PROVENANCE_MISMATCH');
 if v_return->>'reason'<>'INVALID_IDENTITY'
 then raise exception 'INVALID_AMOUNT_ACCEPTED';end if;
 raise notice 'PASS Phase B2: identity scoped, legacy unbound denied, private RPC permissions, durable idempotent quarantine, no settlement/issuer';
end $test$;
