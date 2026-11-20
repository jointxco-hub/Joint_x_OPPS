-- Issue #106: run ONLY in an isolated/disposable PostgreSQL database
-- AFTER applying docs/ISSUE_106_QR_PRIVATE_SCHEMA_DRAFT.sql.
-- Requires public.tenants with a fixture tenant ID; no PayFast calls.
begin;
set local lock_timeout='3s';
do $test$
declare
  v_tenant uuid := '22222222-2222-4222-8222-222222222222';
  v_target uuid := '11111111-1111-4111-8111-111111111111';
  v_r1 uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_r2 uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  v_hits integer;
begin
  if to_regclass('qr_payments.payment_requests') is null or
     to_regclass('qr_payments.payment_exceptions') is null then
    raise exception 'SCHEMA_MISSING';
  end if;
  if not exists (select 1 from public.tenants where id=v_tenant) then
    raise exception 'FIXTURE_TENANT_MISSING (use a disposable database only)';
  end if;
  if has_schema_privilege('anon','qr_payments','USAGE')
     or has_schema_privilege('authenticated','qr_payments','USAGE') then
    raise exception 'DIRECT_SCHEMA_ACCESS_OPEN';
  end if;
  insert into qr_payments.payment_requests
    (id,tenant_id,target_type,target_id,operation_key,amount_cents,status,checkout_url,expires_at)
  values (v_r1,v_tenant,'opps_invoice',v_target,'test-key-0001',14500,'active',
          'https://sandbox.payfast.co.za/eng/process?test=1',now()+interval '1 minute');
  begin
    insert into qr_payments.payment_requests
      (id,tenant_id,target_type,target_id,operation_key,amount_cents,status,checkout_url,expires_at)
    values (v_r2,v_tenant,'opps_invoice',v_target,'test-key-0002',14500,'active',
            'https://sandbox.payfast.co.za/eng/process?test=2',now()+interval '1 minute');
    raise exception 'DUPLICATE_ACTIVE_NOT_BLOCKED';
  exception when unique_violation then null;
  end;
  begin
    insert into qr_payments.payment_requests
      (id,tenant_id,target_type,target_id,operation_key,amount_cents,status,checkout_url,expires_at)
    values (v_r2,v_tenant,'opps_invoice',v_target,'test-key-0001',14500,'expired',
            null,now()+interval '1 minute');
    raise exception 'DUPLICATE_KEY_NOT_BLOCKED';
  exception when unique_violation then null;
  end;
  update qr_payments.payment_requests
    set status='expired',checkout_url=null where id=v_r1;
  insert into qr_payments.payment_requests
    (id,tenant_id,target_type,target_id,operation_key,amount_cents,status,checkout_url,expires_at)
  values (v_r2,v_tenant,'opps_invoice',v_target,'test-key-0002',14500,'active',
          'https://sandbox.payfast.co.za/eng/process?test=2',now()+interval '1 minute');
  insert into qr_payments.payment_exceptions
    (payment_request_id,gateway_payment_id,reason,amount_cents)
  values (v_r1,'pf-test-1','CAPTURE_REQUIRES_RECONCILIATION',14500)
  on conflict (payment_request_id,gateway_payment_id,reason) do nothing;
  insert into qr_payments.payment_exceptions
    (payment_request_id,gateway_payment_id,reason,amount_cents)
  values (v_r1,'pf-test-1','CAPTURE_REQUIRES_RECONCILIATION',14500)
  on conflict (payment_request_id,gateway_payment_id,reason) do nothing;
  select count(*) into v_hits from qr_payments.payment_exceptions
    where payment_request_id=v_r1 and gateway_payment_id='pf-test-1';
  if v_hits <> 1 then raise exception 'EXCEPTION_REPLAY_DUPLICATED'; end if;
  begin
    update qr_payments.payment_requests set status='settled' where id=v_r2;
    raise exception 'SETTLED_WITHOUT_GATEWAY_REF_NOT_BLOCKED';
  exception when check_violation then null;
  end;
  raise notice 'ISSUE106 PRIVATE REQUEST SCHEMA SMOKE: PASS';
end $test$;
rollback; -- smoke tests leave no fixture records
