-- Disposable PostgreSQL ONLY. Simulated capture data, no PayFast connection.
\set ON_ERROR_STOP on
do $finance$
declare
 t uuid:='11111111-1111-4111-8111-111111111111';
 o_live uuid:='00000000-0000-4000-8000-000000000008';
 o_sandbox uuid:='00000000-0000-4000-8000-000000000009';
 o_unknown uuid:='00000000-0000-4000-8000-000000000010';
 o_qa uuid:='00000000-0000-4000-8000-000000000011';
 r_sandbox uuid:='88888888-8888-4888-8888-888888888888';
 r_unknown uuid:='99999999-9999-4999-8999-999999999999';
 r_qa uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab';
 v_tx public.transactions%rowtype;
begin
 -- Earlier mock successful live payment, followed by post-settlement Finance
 -- reconciliation, must be included as revenue.
 -- Diagnose the exact Finance projection failure instead of hiding it
 -- behind the gateway's intentionally non-fatal projection review.
 begin
   perform commerce.qs_project_manual_receipt(o_live);
 exception when others then
   raise exception 'LIVE_FINANCE_PROJECTOR_ERROR: %',sqlerrm;
 end;
 select * into v_tx from public.transactions where qs_service_order_id=o_live;
 if v_tx.id is null or v_tx.payment_method<>'payfast'
   or v_tx.reference<>'fake-paid-0001'
   or v_tx.is_test or v_tx.excluded_from_reports
 then raise exception 'LIVE_RECEIPT_INCORRECTLY_EXCLUDED: %',to_jsonb(v_tx);end if;
 if (select count(*) from public.transactions where qs_service_order_id=o_live)<>1
 then raise exception 'DUPLICATE_LIVE_FINANCE_ROW';end if;

 -- A strictly server-bound verified sandbox QR is excluded. An unbound
 -- historical QR must remain for manual review rather than inferred as paid.
 insert into commerce.service_orders(id,tenant_id,channel,payment_status,status,total_amount,order_number)
 values(o_sandbox,t,'counter','paid','submitted',72,'QS-TEST-SANDBOX');
 insert into qr_payments.payment_requests(
  id,tenant_id,target_type,target_id,status,amount_cents,checkout_started_at,
  checkout_intent_id,checkout_environment,checkout_merchant_id,
  checkout_gateway_reference,checkout_contract_version,
  gateway_payment_id,gateway_environment,gateway_environment_evidence)
 values(r_sandbox,t,'cafe_order',o_sandbox,'settled',7200,now()-interval '10 minutes',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','sandbox','10000100',
  'JXQR-'||r_sandbox::text,'jointx_qr_v2',
  'fake-sandbox-72','sandbox','sandbox_only_verified_itn');
 insert into commerce.service_order_payments(
  id,tenant_id,service_order_id,provider,status,amount,pf_payment_id,completed_at,raw_itn)
 values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',t,o_sandbox,'payfast','completed',72,'fake-sandbox-72',now(),
  jsonb_build_object('payment_status','COMPLETE','merchant_id','10000100',
    'custom_str4','cafe_order','m_payment_id','JXQR-'||r_sandbox::text));
 perform commerce.qs_project_manual_receipt(o_sandbox);
 select * into v_tx from public.transactions where qs_service_order_id=o_sandbox;
 if v_tx.id is null or not v_tx.is_test or not v_tx.excluded_from_reports
 then raise exception 'SANDBOX_NOT_EXCLUDED';end if;

 -- A prefix without matching settled, gateway-verified evidence is NOT
 -- sufficient for Finance projection.
 insert into commerce.service_orders(id,tenant_id,channel,payment_status,status,total_amount,order_number)
 values(o_unknown,t,'counter','paid','submitted',60,'QS-TEST-UNKNOWN');
 insert into qr_payments.payment_requests(
  id,tenant_id,target_type,target_id,status,amount_cents,checkout_started_at)
 values(r_unknown,t,'cafe_order',o_unknown,'active',6000,now()-interval '1 minute');
 insert into commerce.service_order_payments(
  tenant_id,service_order_id,provider,status,amount,pf_payment_id,completed_at,raw_itn)
 values(t,o_unknown,'payfast','completed',60,'fake-unknown',now(),
  jsonb_build_object('payment_status','COMPLETE','custom_str4','cafe_order',
   'm_payment_id','JXQR-'||r_unknown::text));
 begin
   perform commerce.qs_project_manual_receipt(o_unknown);
   raise exception 'UNVERIFIED_PREFIX_ACCEPTED';
 exception when others then
   if sqlerrm<>'QR_GATEWAY_ENVIRONMENT_REVIEW_REQUIRED' then raise;end if;
 end;
 if exists(select 1 from public.transactions where qs_service_order_id=o_unknown)
 then raise exception 'UNVERIFIED_REVENUE_PROJECTED';end if;

 -- Existing staff-set QA flags are never cleared by a verified live receipt.
 insert into commerce.service_orders(id,tenant_id,channel,payment_status,status,total_amount,order_number)
 values(o_qa,t,'counter','paid','submitted',60,'QS-TEST-LIVE-QA');
 insert into qr_payments.payment_requests(
  id,tenant_id,target_type,target_id,status,amount_cents,checkout_started_at,
  checkout_environment,checkout_merchant_id,checkout_gateway_reference,
  checkout_contract_version,checkout_intent_id,gateway_payment_id,
  gateway_environment,gateway_environment_evidence)
 values(r_qa,t,'cafe_order',o_qa,'settled',6000,now()-interval '2 minutes',
  'live','15000100','JXQR-'||r_qa::text,'jointx_qr_v2',
  'ffffffff-ffff-4fff-8fff-ffffffffffff',
  'fake-live-qa','live','payfast_itn_validated_live');
 insert into commerce.service_order_payments(
  id,tenant_id,service_order_id,provider,status,amount,pf_payment_id,completed_at,raw_itn)
 values('ffffffff-ffff-4fff-8fff-ffffffffffff',t,o_qa,'payfast','completed',60,'fake-live-qa',now(),
  jsonb_build_object('payment_status','COMPLETE','merchant_id','15000100',
    'custom_str4','cafe_order','m_payment_id','JXQR-'||r_qa::text));
 insert into public.transactions(tenant_id,type,amount,payment_status,source,
   qs_service_order_id,is_test,excluded_from_reports)
 values(t,'income',60,'completed','quick_solution',o_qa,true,true);
 perform commerce.qs_project_manual_receipt(o_qa);
 select * into v_tx from public.transactions where qs_service_order_id=o_qa;
 if not v_tx.is_test or not v_tx.excluded_from_reports
 then raise exception 'STAFF_QA_FLAGS_CLEARED';end if;
 if v_tx.reference<>'fake-live-qa' or v_tx.payment_method<>'payfast'
 then raise exception 'VERIFIED_LIVE_REFERENCE_NOT_PROJECTED';end if;

 raise notice 'PASS: live revenue included, verified sandbox excluded, prefix-only rejected, staff QA flags preserved';
end
$finance$;
