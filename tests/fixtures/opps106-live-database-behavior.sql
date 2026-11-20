-- Disposable PostgreSQL ONLY, run after live candidate SQL is parsed.
-- Simulated provider data; never a real PayFast charge/ITN.
\set ON_ERROR_STOP on
do $test$
declare
  v_tenant uuid:='11111111-1111-4111-8111-111111111111';
  v_order uuid:='00000000-0000-4000-8000-000000000006';
  v_order2 uuid:='00000000-0000-4000-8000-000000000007';
  v_request uuid:='22222222-2222-4222-8222-222222222222';
  v_request2 uuid:='33333333-3333-4333-8333-333333333333';
  v_intent uuid:='44444444-4444-4444-8444-444444444444';
  v_intent2 uuid:='55555555-5555-4555-8555-555555555555';
  v_ref text:='JXQR-22222222-2222-4222-8222-222222222222';
  v_result jsonb;
  v_before integer;
  v_after integer;
begin
  insert into commerce.service_orders(id,tenant_id,channel,payment_status,status,total_amount,order_number)
  values (v_order,v_tenant,'counter','unpaid','submitted',60,'QS-ISOLATED-LIVE-6'),
         (v_order2,v_tenant,'counter','unpaid','submitted',60,'QS-ISOLATED-LIVE-7');
  insert into qr_payments.payment_requests
    (id,tenant_id,target_type,target_id,status,checkout_started_at,checkout_intent_id,
     checkout_environment,checkout_merchant_id,checkout_gateway_reference,checkout_contract_version,
     expires_at,amount_cents)
  values(v_request,v_tenant,'cafe_order',v_order,'active',now()-interval '5 minutes',v_intent,
    'live','15000100',v_ref,'jointx_qr_v2',now()+interval '2 minutes',6000),
  (v_request2,v_tenant,'cafe_order',v_order2,'active',now()-interval '5 minutes',v_intent2,
    'live','15000100','JXQR-'||v_request2::text,'jointx_qr_v2',now()+interval '2 minutes',6000);
  insert into commerce.service_order_payments
    (id,tenant_id,service_order_id,provider,status,amount)
  values(v_intent,v_tenant,v_order,'payfast','pending',60),
        (v_intent2,v_tenant,v_order2,'payfast','pending',60);
  update qr_payments.live_gateway_policy
  set merchant_id='15000100',approved_at=now(),approved_by='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  where target_type='cafe_order'; -- policy remains disabled

  select public.qs_opps106_start_counter_qr_checkout_live_candidate(v_request,'live','15000100')
    into v_result;
  if v_result->>'reason' <> 'LIVE_GATEWAY_POLICY_DISABLED' then
    raise exception 'ISSUE_GUARD_FAILED: %',v_result;end if;

  select count(*) into v_before from qr_payments.payment_exceptions;
  select public.qs_opps106_settle_counter_qr_live_candidate(
    v_request,v_order,v_tenant,6000,'fake-provider-mismatch',
    jsonb_build_object('merchant_id','99999999','m_payment_id',v_ref,
      'payment_status','COMPLETE','custom_str2','jointx_qr_v1')) into v_result;
  if v_result->>'status' <> 'review_required' then raise exception 'MERCHANT_MISMATCH_ACCEPTED: %',v_result;end if;
  select count(*) into v_after from qr_payments.payment_exceptions;
  if v_after<>v_before+1 then raise exception 'EXCEPTION_MISSING';end if;

  -- Replay same mismatch must not create duplicate exceptions.
  perform public.qs_opps106_settle_counter_qr_live_candidate(
    v_request,v_order,v_tenant,6000,'fake-provider-mismatch',
    jsonb_build_object('merchant_id','99999999','m_payment_id',v_ref,
      'payment_status','COMPLETE','custom_str2','jointx_qr_v1'));
  if (select count(*) from qr_payments.payment_exceptions)<>v_after then
    raise exception 'DUPLICATE_EXCEPTION_CREATED';end if;

  -- A valid-looking synthetic payload cannot settle a real receipt:
  -- the disposable gateway projection intentionally denies canonical capture.
  begin
    perform public.qs_opps106_settle_counter_qr_live_candidate(
      v_request,v_order,v_tenant,6000,'fake-provider-complete',
      jsonb_build_object('merchant_id','15000100','m_payment_id',v_ref,
        'payment_status','COMPLETE','custom_str2','jointx_qr_v1'));
    raise exception 'SYNTHETIC_CAPTURE_UNEXPECTEDLY_ACCEPTED';
  exception when sqlstate 'P0001' then
    if sqlerrm='SYNTHETIC_CAPTURE_UNEXPECTEDLY_ACCEPTED' then raise; end if;
  end;
  if exists(select 1 from commerce.service_order_payments
    where service_order_id=v_order and status='completed') then raise exception 'FAKE_RECEIPT_CREATED';end if;
  if (select status from qr_payments.payment_requests where id=v_request)<>'active' then
    raise exception 'FAKE_QR_SETTLED';end if;

  -- Even with issuance OFF, a signed/validated noncomplete event for an
  -- already-bound live checkout must be handled under the merchant policy.
  select public.qs_opps106_record_counter_qr_noncomplete_live_candidate(
    v_request2,v_order2,v_tenant,6000,'fake-provider-cancelled','cancelled') into v_result;
  if v_result->>'status' <> 'closed' then raise exception 'NONCOMPLETE_NOT_RECORDED: %',v_result;end if;
  if (select status from qr_payments.payment_requests where id=v_request2)<>'revoked' then
    raise exception 'CANCELLED_REQUEST_NOT_REVOKED';end if;
  if (select status from commerce.service_order_payments where id=v_intent2)<>'cancelled' then
    raise exception 'CANCELLED_INTENT_NOT_RECORDED';end if;

  if (select enabled from qr_payments.live_gateway_policy where target_type='cafe_order')
    is distinct from false then raise exception 'LIVE_POLICY_ENABLED';end if;
  raise notice 'PASS: live issue disabled, merchant mismatch quarantined/idempotent, synthetic capture rejected, late cancellation processed without enabling new issuance';
end
$test$;
