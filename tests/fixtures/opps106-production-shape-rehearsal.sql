-- Data-free rehearsal of the actual Phase A -> B1 -> B2 -> B3 chain.
-- The signed provider notification is synthetic. No PayFast connection.
\set ON_ERROR_STOP on
create or replace function commerce.qs_apply_payfast_payment(
 p_order_id uuid,p_amount numeric,p_payment_id text,p_itn jsonb)
returns jsonb language plpgsql as $mock$
declare
 v_tenant uuid;
begin
 select tenant_id into v_tenant from commerce.service_orders where id=p_order_id for update;
 if v_tenant is null then return '{"ok":false,"reason":"missing_order"}'::jsonb;end if;
 insert into commerce.service_order_payments(
   tenant_id,service_order_id,provider,status,amount,pf_payment_id,raw_itn,completed_at)
 values(v_tenant,p_order_id,'payfast','completed',p_amount,p_payment_id,p_itn,now());
 update commerce.service_order_payments set status='cancelled'
 where service_order_id=p_order_id and provider='payfast'
   and status='pending' and pf_payment_id is null;
 update commerce.service_orders set payment_status='paid' where id=p_order_id;
 -- The production canonical recorder attempts this BEFORE QR is settled.
 -- It may be deferred, then retried after trusted settlement.
 begin
   perform commerce.qs_project_manual_receipt(p_order_id);
 exception when others then
   update commerce.service_orders set source_metadata=
    coalesce(source_metadata,'{}'::jsonb) ||
    '{"paymentProjectionReview":{"required":true}}'::jsonb
   where id=p_order_id;
 end;
 return '{"ok":true,"ignored":false}'::jsonb;
end $mock$;

do $verify$
declare
 t uuid:='11111111-1111-4111-8111-111111111111';
 o uuid:='00000000-0000-4000-8000-000000000018';
 q uuid:='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb018';
 intent uuid:='ffffffff-ffff-4fff-8fff-ffffffff0018';
 opp uuid:='eeeeeeee-eeee-4eee-8eee-eeeeeeeeee18';
 itn jsonb;
 result jsonb;
begin
 insert into public.orders(id,tenant_id,source,total_amount,payment_status,payment_environment)
 values(opp,t,'quick_solution',60,'pending','live');
 insert into commerce.service_orders(id,tenant_id,total_amount,order_number,opps_order_id)
 values(o,t,60,'QS-REHEARSAL-LIVE',opp);
 insert into commerce.service_order_payments(id,tenant_id,service_order_id,provider,status,amount)
 values(intent,t,o,'payfast','pending',60);
 insert into qr_payments.payment_requests(
 id,tenant_id,target_type,target_id,operation_key,amount_cents,status,
 checkout_url,created_at,expires_at,checkout_intent_id,checkout_started_at,
 checkout_environment,checkout_merchant_id,checkout_gateway_reference,checkout_contract_version)
 values(q,t,'cafe_order',o,'rehearsal_live_0018',6000,'active',
 'https://example.invalid/never-a-real-checkout',now()-interval '2 minutes',
 now()+interval '1 minute',intent,now()-interval '1 minute',
 'live','15000100','JXQR-'||q::text,'jointx_qr_v2');
 itn:=jsonb_build_object('merchant_id','15000100',
   'm_payment_id','JXQR-'||q::text,'payment_status','COMPLETE',
   'custom_str2','jointx_qr_v1','custom_str4','cafe_order');
 result:=public.qs_opps106_settle_counter_qr_live_candidate(
    q,o,t,6000,'fake-provider-rehearsal-0018',itn);
 if result->>'status'<>'settled' or result->>'projectionReviewRequired'='true'
 then raise exception 'REHEARSAL_NOT_SETTLED_CLEANLY: %',result;end if;
 if (select status from commerce.service_order_payments where id=intent)<>'cancelled'
 then raise exception 'PENDING_INTENT_NOT_CANCELLED';end if;
 if (select count(*) from commerce.service_order_payments
   where service_order_id=o and status='completed'
   and pf_payment_id='fake-provider-rehearsal-0018')<>1
 then raise exception 'ONE_COMPLETED_RECEIPT_REQUIRED';end if;
 if (select count(*) from public.transactions
   where qs_service_order_id=o and payment_method='payfast'
     and reference='fake-provider-rehearsal-0018'
     and coalesce(is_test,false)=false
     and coalesce(excluded_from_reports,false)=false)<>1
 then raise exception 'ONE_LIVE_FINANCE_ROW_REQUIRED';end if;
 if not exists(select 1 from public.orders
    where id=opp and payment_environment='live'
      and payment_method='payfast'
      and payment_reference='fake-provider-rehearsal-0018'
      and coalesce(is_test,false)=false
      and coalesce(excluded_from_reports,false)=false)
 then raise exception 'LINKED_OPPS_ORDER_NOT_RECONCILED';end if;
 if exists(select 1 from commerce.service_orders
   where id=o and source_metadata ? 'paymentProjectionReview')
 then raise exception 'PROJECTION_REVIEW_NOT_CLEARED';end if;
 result:=public.qs_opps106_settle_counter_qr_live_candidate(
    q,o,t,6000,'fake-provider-rehearsal-0018',itn);
 if result->>'status'<>'replayed' then raise exception 'REPLAY_UNSAFE';end if;
 if (select count(*) from public.transactions where qs_service_order_id=o)<>1
 then raise exception 'DUPLICATE_FINANCE_REVENUE';end if;
 if exists(select 1 from qr_payments.issuance_controls where enabled)
   or exists(select 1 from qr_payments.live_gateway_policy where enabled)
 then raise exception 'ISSUANCE_WAS_ENABLED';end if;
 raise notice 'PASS A-B3 data-free production-function rehearsal: one receipt, one Finance, linked OPPS, replay, issuer OFF';
end $verify$;
