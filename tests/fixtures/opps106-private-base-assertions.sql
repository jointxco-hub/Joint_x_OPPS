-- Disposable PostgreSQL ONLY. Asserts the candidate is harmless on install.
\set ON_ERROR_STOP on
do $verify$
declare
 v_count integer;
begin
 if (select count(*) from qr_payments.issuance_controls)<>2
   or (select count(*) from qr_payments.issuance_controls where enabled)<>0
 then raise exception 'ISSUER_NOT_DEFAULT_OFF';end if;
 if exists(select 1 from qr_payments.issuance_controls where allowed_order_id is not null or active_until is not null)
 then raise exception 'ISSUER_SCOPE_NOT_EMPTY';end if;
 if not exists(select 1 from pg_constraint where conname='qr_issuance_requires_scope'
   and conrelid='qr_payments.issuance_controls'::regclass)
 then raise exception 'MISSING_SINGLE_ORDER_GUARD';end if;

 select count(*) into v_count from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='qr_payments' and c.relkind='r' and c.relrowsecurity;
 if v_count<>5 then raise exception 'EXPECTED_FIVE_RLS_PRIVATE_TABLES: %',v_count;end if;

 if has_schema_privilege('anon','qr_payments','USAGE')
   or has_schema_privilege('authenticated','qr_payments','USAGE')
   or has_table_privilege('anon','qr_payments.payment_requests','INSERT')
   or has_table_privilege('authenticated','qr_payments.payment_requests','SELECT')
   or has_table_privilege('anon','qr_payments.issuance_controls','UPDATE')
 then raise exception 'BROWSER_ACCESS_LEAK';end if;
 if not has_table_privilege('service_role','qr_payments.payment_requests','INSERT')
   or not has_table_privilege('service_role','qr_payments.issuance_controls','SELECT')
 then raise exception 'EXPECTED_PRIVATE_ROLE_ACCESS_MISSING';end if;
 if to_regprocedure('public.qs_opps106_issue_counter_qr(uuid,text)') is not null
   or to_regprocedure('public.qs_opps106_settle_counter_qr_live_candidate(uuid,uuid,uuid,bigint,text,jsonb)') is not null
 then raise exception 'UNEXPECTED_PAYMENT_EXECUTION_ENDPOINT';end if;

 insert into public.tenants(id) values('11111111-1111-4111-8111-111111111111');
 insert into commerce.service_order_payments(id) values('22222222-2222-4222-8222-222222222222');
 insert into qr_payments.payment_requests(
   id,tenant_id,target_type,target_id,operation_key,amount_cents,status,
   checkout_url,expires_at,checkout_intent_id,checkout_started_at,
   checkout_environment,checkout_merchant_id,checkout_gateway_reference,checkout_contract_version)
 values(
   '33333333-3333-4333-8333-333333333333',
   '11111111-1111-4111-8111-111111111111',
   'cafe_order','44444444-4444-4444-8444-444444444444',
   'isolated_order_1234',6000,'active',
   'https://example.invalid/never-a-payment',now()+interval '2 minutes',
   '22222222-2222-4222-8222-222222222222',now(),
   'live','15000100','JXQR-33333333-3333-4333-8333-333333333333','jointx_qr_v2');
 if (select count(*) from qr_payments.payment_requests)<>1
 then raise exception 'PRIVATE_REQUEST_INSERT_FAILED';end if;
 if exists(select 1 from qr_payments.payment_requests where gateway_environment is not null)
 then raise exception 'UNVERIFIED_PAYMENT_ENVIRONMENT_WAS_INFERRED';end if;
 raise notice 'PASS: private Phase A QR schema, issuer OFF, five RLS tables, no browser permissions, no settlement endpoints, provenance checks';
end
$verify$;

-- Running the candidate twice must abort rather than silently masking drift.
do $verify_reentry$
begin
 if to_regclass('qr_payments.payment_requests') is null then
  raise exception 'EXPECTED_SCHEMA_MISSING';end if;
end
$verify_reentry$;
