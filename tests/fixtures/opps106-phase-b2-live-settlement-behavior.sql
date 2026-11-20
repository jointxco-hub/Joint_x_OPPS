-- Fully isolated Phase A+B1+B2 live DB-settlement behavior.
-- Signed source, remote PayFast VALID, and callback IP validation are separate
-- Edge requirements; this test deliberately does not claim to verify them.
\set ON_ERROR_STOP on
update qr_payments.live_gateway_policy
 set merchant_id='15000100',approved_at=now(),
     approved_by='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
 where target_type='cafe_order';
do $test$
declare
 v_request uuid:='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 v_order uuid:='00000000-0000-4000-8000-000000000005';
 v_tenant uuid:='11111111-1111-4111-8111-111111111111';
 v_itn jsonb:=jsonb_build_object(
   'merchant_id','15000100',
   'm_payment_id','JXQR-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   'payment_status','COMPLETE','custom_str2','jointx_qr_v1',
   'custom_str4','cafe_order');
 v_result jsonb;
begin
 -- The new-issuance policy stays OFF while a previously-bound verified
 -- checkout may still settle via a delayed callback.
 if (select enabled from qr_payments.live_gateway_policy where target_type='cafe_order')
   is distinct from false then raise exception 'LIVE_ISSUER_POLICY_ON';end if;

 v_result:=public.qs_opps106_settle_counter_qr_live_candidate(
   v_request,v_order,v_tenant,6000,'fake-live-complete-0001',v_itn);
 if v_result->>'status'<>'settled'
 then raise exception 'MOCK_SETTLEMENT_FAILED: %',v_result;end if;
 if (select status from qr_payments.payment_requests where id=v_request)<>'settled'
   or (select gateway_payment_id from qr_payments.payment_requests where id=v_request)
      <>'fake-live-complete-0001'
   or (select gateway_environment from qr_payments.payment_requests where id=v_request)<>'live'
   or (select gateway_environment_evidence from qr_payments.payment_requests where id=v_request)
      <>'payfast_itn_validated_live'
 then raise exception 'VERIFIED_QR_EVIDENCE_MISSING';end if;
 if (select payment_status from commerce.service_orders where id=v_order)<>'paid'
 then raise exception 'MOCK_ORDER_UNPAID';end if;
 if (select count(*) from commerce.service_order_payments
   where service_order_id=v_order and status='completed'
     and pf_payment_id='fake-live-complete-0001')<>1
 then raise exception 'EXPECTED_ONE_CANONICAL_RECEIPT';end if;

 v_result:=public.qs_opps106_settle_counter_qr_live_candidate(
   v_request,v_order,v_tenant,6000,'fake-live-complete-0001',v_itn);
 if v_result->>'status'<>'replayed'
 then raise exception 'EXACT_REPLAY_NOT_IDEMPOTENT: %',v_result;end if;

 v_result:=public.qs_opps106_settle_counter_qr_live_candidate(
   v_request,v_order,v_tenant,6000,'fake-live-second-0002',v_itn);
 if v_result->>'status'<>'review_required'
 then raise exception 'SECOND_CAPTURE_NOT_QUARANTINED: %',v_result;end if;
 if not exists(select 1 from qr_payments.payment_exceptions
     where payment_request_id=v_request and gateway_payment_id='fake-live-second-0002'
       and reason='ADDITIONAL_CAPTURE')
 then raise exception 'ADDITIONAL_CAPTURE_LEDGER_MISSING';end if;
 if (select count(*) from commerce.service_order_payments
     where service_order_id=v_order and status='completed')<>1
 then raise exception 'DUPLICATE_CANONICAL_RECEIPT';end if;
 if (select count(*) from qr_payments.issuance_controls where enabled)<>0
 then raise exception 'QR_ISSUANCE_CHANGED';end if;
 raise notice 'PASS Phase B2: one mock live payment, evidence persisted, exact replay safe, second capture quarantined, issuer OFF';
end $test$;
