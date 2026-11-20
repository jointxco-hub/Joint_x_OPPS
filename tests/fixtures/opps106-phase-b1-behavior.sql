-- Phase B-1 behavior in disposable PostgreSQL only.
-- All identifiers are fake; no live payment, callback, or production data.
\set ON_ERROR_STOP on
insert into public.tenants(id,slug,status,settings)
values('11111111-1111-4111-8111-111111111111','quick-solution','active','{}');
insert into public.tenant_capabilities(tenant_id,capability_key,enabled)
values('11111111-1111-4111-8111-111111111111','quick_solution',true),
      ('11111111-1111-4111-8111-111111111111','cafe.counter.operate',true);
insert into public.tenant_memberships(tenant_id,auth_user_id,status,tenant_role)
values('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','active','counter_staff');
insert into commerce.service_product_configs(tenant_id,product_id,customer_definition)
values('11111111-1111-4111-8111-111111111111','ffffffff-ffff-4fff-8fff-ffffffffffff','{}');

insert into commerce.service_orders(id,tenant_id,total_amount,order_number)
values
('00000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',60,'QS-FAKE-ACTIVE'),
('00000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111',60,'QS-FAKE-EXPIRED'),
('00000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111',60,'QS-FAKE-PENDING'),
('00000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111',60,'QS-FAKE-CASH');
insert into commerce.service_order_items(order_id,tenant_id,product_id)
select id,tenant_id,'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid
from commerce.service_orders;

insert into qr_payments.payment_requests(id,tenant_id,target_type,target_id,operation_key,
 amount_cents,status,checkout_url,expires_at,checkout_started_at,checkout_intent_id)
values
('aaaa0000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',
'cafe_order','00000000-0000-4000-8000-000000000001','active_test_001',6000,
'active','https://example.invalid/unpaid',now()+interval '2 minutes',null,null),
('aaaa0000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111',
'cafe_order','00000000-0000-4000-8000-000000000002','expired_test_002',6000,
'expired',null,now()-interval '2 minutes',now()-interval '4 minutes',
'22222222-2222-4222-8222-222222222222');
-- Keep active checkout pending intent and late expired checkout pending provider
insert into commerce.service_order_payments(id,tenant_id,service_order_id,provider,status,amount)
values
('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111',
'00000000-0000-4000-8000-000000000002','payfast','pending',60),
('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111',
'00000000-0000-4000-8000-000000000003','payfast','pending',60);

do $test$
declare
 t uuid:='11111111-1111-4111-8111-111111111111';
 o_active uuid:='00000000-0000-4000-8000-000000000001';
 o_expired uuid:='00000000-0000-4000-8000-000000000002';
 o_pending uuid:='00000000-0000-4000-8000-000000000003';
 o_cash uuid:='00000000-0000-4000-8000-000000000004';
 r jsonb;
 id uuid;
begin
 -- No issuer can run before the dedicated URL/merchant callback release.
 r:=public.qs_opps106_issue_counter_qr(o_cash,'fake_issue_key1');
 if r->>'reason'<>'QR_ISSUANCE_DISABLED' then raise exception 'ISSUER_STUB_FAILED: %',r;end if;
 if (select count(*) from qr_payments.payment_requests)<>2 then raise exception 'ISSUER_CREATED_QR';end if;
 if (select count(*) from qr_payments.issuance_controls where enabled)<>0 then raise exception 'ISSUER_CHANGED_CONTROL';end if;

 r:=public.qs_opps106_counter_qr_preflight(o_cash);
 if r->>'ok' is distinct from 'true' then raise exception 'STAFF_PREFLIGHT_NOT_ELIGIBLE: %',r;end if;
 if r->>'amountCents'<>'6000' then raise exception 'INCORRECT_PREFLIGHT_AMOUNT: %',r;end if;

 foreach id in array array[o_active,o_expired,o_pending] loop
  begin
   perform public.record_quick_solution_counter_payment(id,'cash','fake-payment-key-001');
   raise exception 'MANUAL_CHARGE_UNEXPECTEDLY_ALLOWED';
  exception when others then
   if sqlerrm='MANUAL_CHARGE_UNEXPECTEDLY_ALLOWED' then raise;end if;
   if position('An online QR/PayFast payment may still settle' in sqlerrm)=0 then
     raise exception 'UNEXPECTED_BLOCK_REASON: %',sqlerrm;end if;
  end;
 end loop;
 if exists(select 1 from commerce.service_order_payments where provider='cash' and status='completed')
 then raise exception 'CASH_RECEIPT_WHILE_QR_UNCERTAIN';end if;

 r:=public.record_quick_solution_counter_payment(o_cash,'cash','fake-cash-unique-key-1');
 if r->>'ok'<>'true' or r->>'replayed'<>'false' then raise exception 'UNBLOCKED_CASH_FAILED: %',r;end if;
 r:=public.record_quick_solution_counter_payment(o_cash,'cash','fake-cash-unique-key-1');
 if r->>'replayed'<>'true' then raise exception 'CASH_RETRY_NOT_IDEMPOTENT: %',r;end if;
 if (select count(*) from commerce.service_order_payments where service_order_id=o_cash and status='completed')<>1
 then raise exception 'DUPLICATE_CASH_RECEIPT';end if;
 if (select payment_status from commerce.service_orders where id=o_cash)<>'paid'
 then raise exception 'CASH_ORDER_NOT_PAID';end if;
 raise notice 'PASS: Phase B1 disabled issuer, staff preflight, active/expired/pending QR blocks and safe ordinary cash retry';
end $test$;
