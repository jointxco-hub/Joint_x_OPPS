-- Disposable PostgreSQL only: verify OPPS linked-order classification after
-- trusted QR settlement. No real provider calls, no production mutations.
\set ON_ERROR_STOP on
do $handoff$
declare
 t uuid:='11111111-1111-4111-8111-111111111111';
 o_live uuid:='00000000-0000-4000-8000-000000000008';
 o_sandbox uuid:='00000000-0000-4000-8000-000000000009';
 o_unknown uuid:='00000000-0000-4000-8000-000000000010';
 opps_live uuid:='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 opps_sandbox uuid:='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 opps_unknown uuid:='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 v_row public.orders%rowtype;
begin
 insert into public.orders(id,tenant_id,source,total_amount)
 values(opps_live,t,'quick_solution',60),
       (opps_sandbox,t,'quick_solution',72),
       (opps_unknown,t,'quick_solution',60);
 update commerce.service_orders set opps_order_id=opps_live where id=o_live;
 update commerce.service_orders set opps_order_id=opps_sandbox where id=o_sandbox;
 update commerce.service_orders set opps_order_id=opps_unknown where id=o_unknown;

 perform commerce.qs_opps106_classify_verified_qr_handoff(o_live,opps_live);
 select * into v_row from public.orders where id=opps_live;
 if v_row.payment_environment<>'live' or v_row.payment_method<>'payfast'
    or v_row.payment_reference<>'fake-paid-0001'
    or v_row.is_test or v_row.excluded_from_reports
 then raise exception 'LIVE_OPPS_ORDER_CLASSIFICATION_FAILED: %',to_jsonb(v_row);end if;
 -- Set independent QA flags, repeat classification, and preserve flags.
 update public.orders set is_test=true,excluded_from_reports=true where id=opps_live;
 perform commerce.qs_opps106_classify_verified_qr_handoff(o_live,opps_live);
 select * into v_row from public.orders where id=opps_live;
 if not v_row.is_test or not v_row.excluded_from_reports or v_row.payment_environment<>'live'
 then raise exception 'LIVE_OPPS_OPERATOR_QA_FLAGS_CHANGED';end if;

 perform commerce.qs_opps106_classify_verified_qr_handoff(o_sandbox,opps_sandbox);
 select * into v_row from public.orders where id=opps_sandbox;
 if v_row.payment_environment<>'sandbox' or v_row.payment_method<>'payfast'
   or not v_row.is_test or not v_row.excluded_from_reports
   or v_row.payment_reference<>'fake-sandbox-72'
 then raise exception 'SANDBOX_OPPS_ORDER_NOT_EXCLUDED';end if;

 -- A stale QR reference must never set paid/live/sandbox classification.
 perform commerce.qs_opps106_classify_verified_qr_handoff(o_unknown,opps_unknown);
 select * into v_row from public.orders where id=opps_unknown;
 if v_row.payment_environment is not null or v_row.payment_method is not null
 then raise exception 'UNVERIFIED_OPPS_ORDER_CLASSIFIED';end if;
 raise notice 'PASS: OPPS order live/sandbox attribution, preserved operator QA flags, unknown QR denied';
end
$handoff$;
