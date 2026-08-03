\set ON_ERROR_STOP on

-- Full-schema disposable-staging smoke test for Branch 1.
-- Run only after the complete canonical migration chain.

begin;

insert into public.tenants (id, slug, name) values
  ('31000000-0000-0000-0000-000000000001', 'invoice-smoke-a', 'Invoice Smoke A'),
  ('32000000-0000-0000-0000-000000000002', 'invoice-smoke-b', 'Invoice Smoke B');

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data) values
  ('3a000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'finance-a@example.invalid', '{}'::jsonb, '{}'::jsonb),
  ('3b000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'finance-b@example.invalid', '{}'::jsonb, '{}'::jsonb),
  ('3c000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'staff-a@example.invalid', '{}'::jsonb, '{}'::jsonb);

insert into public.users (id, auth_user_id, user_email, full_name, role) values
  ('31100000-0000-0000-0000-000000000001', '3a000000-0000-0000-0000-000000000001', 'finance-a@example.invalid', 'Finance A', 'finance_admin'),
  ('32100000-0000-0000-0000-000000000002', '3b000000-0000-0000-0000-000000000002', 'finance-b@example.invalid', 'Finance B', 'finance_admin'),
  ('31200000-0000-0000-0000-000000000003', '3c000000-0000-0000-0000-000000000003', 'staff-a@example.invalid', 'Staff A', 'staff');

insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role) values
  ('31000000-0000-0000-0000-000000000001', '3a000000-0000-0000-0000-000000000001', 'member'),
  ('32000000-0000-0000-0000-000000000002', '3b000000-0000-0000-0000-000000000002', 'member'),
  ('31000000-0000-0000-0000-000000000001', '3c000000-0000-0000-0000-000000000003', 'member');

insert into public.clients (id, name, email, tenant_id) values
  ('31300000-0000-0000-0000-000000000001', 'Smoke Client A', 'client-a@example.invalid', '31000000-0000-0000-0000-000000000001'),
  ('32300000-0000-0000-0000-000000000002', 'Smoke Client B', 'client-b@example.invalid', '32000000-0000-0000-0000-000000000002');

insert into public.products (id, name, code, price, tenant_id) values
  ('31400000-0000-0000-0000-000000000001', 'Smoke Product A', 'SMOKE-A', 100, '31000000-0000-0000-0000-000000000001'),
  ('32400000-0000-0000-0000-000000000002', 'Smoke Product B', 'SMOKE-B', 50, '32000000-0000-0000-0000-000000000002');

insert into public.inventory (id, name, sku, current_stock, tenant_id) values
  ('31500000-0000-0000-0000-000000000001', 'Smoke Inventory A', 'INV-A', 20, '31000000-0000-0000-0000-000000000001'),
  ('32500000-0000-0000-0000-000000000002', 'Smoke Inventory B', 'INV-B', 20, '32000000-0000-0000-0000-000000000002');

insert into public.opps_invoice_item_templates (
  id, tenant_id, name, description, rate, tax_name, tax_percentage,
  client_id, catalog_item_id, inventory_item_id, created_by, updated_by
) values (
  '31600000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000001',
  'Existing template A', 'Pre-existing template remains usable', 100, 'VAT', 15,
  '31300000-0000-0000-0000-000000000001', '31400000-0000-0000-0000-000000000001',
  '31500000-0000-0000-0000-000000000001', '3a000000-0000-0000-0000-000000000001',
  '3a000000-0000-0000-0000-000000000001'
);

insert into public.orders (
  id, order_number, client_name, client_email, client_id, products, total_amount,
  deposit_paid, status, tenant_id
) values (
  '31700000-0000-0000-0000-000000000001', 'ORDER-SMOKE-A', 'Smoke Client A',
  'client-a@example.invalid', '31300000-0000-0000-0000-000000000001',
  '[{"id":"31710000-0000-0000-0000-000000000001","name":"Order line one","quantity":2,"price":100},{"id":"31710000-0000-0000-0000-000000000002","name":"Order line two","quantity":1,"price":50}]'::jsonb,
  250, 50, 'confirmed', '31000000-0000-0000-0000-000000000001'
);

-- A pre-Branch-1 record: Branch 1 is additive and must leave it readable.
insert into public.opps_invoices (
  id, invoice_number, customer_id, customer_name, invoice_date, status,
  subtotal, discount_total, shipping_charge, tax_total, total, amount_paid,
  balance_due, tenant_id, created_at, updated_at
) values
  ('31800000-0000-0000-0000-000000000001', 'PRE-MIGRATION-A', '31300000-0000-0000-0000-000000000001', 'Smoke Client A', '2026-07-01', 'draft', 250, 10, 25, 36, 301, 50, 251, '31000000-0000-0000-0000-000000000001', '2026-07-01', '2026-07-01'),
  ('31800000-0000-0000-0000-000000000002', 'APPROVED-A', '31300000-0000-0000-0000-000000000001', 'Smoke Client A', '2026-07-01', 'approved', 250, 0, 0, 37.5, 287.5, 287.5, 0, '31000000-0000-0000-0000-000000000001', '2026-07-01', '2026-07-01'),
  ('32800000-0000-0000-0000-000000000002', 'DRAFT-B', '32300000-0000-0000-0000-000000000002', 'Smoke Client B', '2026-07-01', 'draft', 50, 0, 0, 0, 50, 0, 50, '32000000-0000-0000-0000-000000000002', '2026-07-01', '2026-07-01');

insert into public.opps_invoice_items (
  id, invoice_id, tenant_id, line_number, item_name, quantity, rate, discount,
  tax_name, tax_percentage, item_total, invoice_item_template_id,
  catalog_item_id, inventory_item_id, line_key
) values
  ('31900000-0000-0000-0000-000000000001', '31800000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000001', 1, 'Existing line one', 2, 100, 0, 'VAT', 15, 200, '31600000-0000-0000-0000-000000000001', '31400000-0000-0000-0000-000000000001', '31500000-0000-0000-0000-000000000001', 'pre-a-1'),
  ('31900000-0000-0000-0000-000000000002', '31800000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000001', 2, 'Existing line two', 1, 50, 0, null, 0, 50, null, null, null, 'pre-a-2'),
  ('31900000-0000-0000-0000-000000000003', '31800000-0000-0000-0000-000000000002', '31000000-0000-0000-0000-000000000001', 1, 'Approved line one', 2, 100, 0, 'VAT', 15, 200, null, null, null, 'approved-a-1'),
  ('31900000-0000-0000-0000-000000000004', '31800000-0000-0000-0000-000000000002', '31000000-0000-0000-0000-000000000001', 2, 'Approved line two', 1, 50, 0, null, 0, 50, null, null, null, 'approved-a-2'),
  ('32900000-0000-0000-0000-000000000001', '32800000-0000-0000-0000-000000000002', '32000000-0000-0000-0000-000000000002', 1, 'Tenant B line', 1, 50, 0, null, 0, 50, null, null, null, 'b-1');

insert into public.opps_invoice_item_versions (
  tenant_id, client_id, invoice_id, invoice_item_template_id, line_key,
  version_number, change_reason, snapshot, changed_by
) values (
  '31000000-0000-0000-0000-000000000001', '31300000-0000-0000-0000-000000000001',
  '31800000-0000-0000-0000-000000000001', '31600000-0000-0000-0000-000000000001',
  'pre-a-1', 1, 'Historical baseline', '{"item_name":"Existing line one","rate":100}'::jsonb,
  '3a000000-0000-0000-0000-000000000001'
);

insert into public.opps_invoice_activity (
  invoice_id, activity_type, activity_label, metadata, tenant_id, created_by
) values (
  '31800000-0000-0000-0000-000000000001', 'invoice_created', 'Historical invoice created',
  '{"source":"pre-branch"}'::jsonb, '31000000-0000-0000-0000-000000000001',
  '3a000000-0000-0000-0000-000000000001'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"3a000000-0000-0000-0000-000000000001","email":"finance-a@example.invalid","role":"authenticated"}';

do $$
declare v_before_history integer; v_before_activity integer; v_result jsonb;
begin
  if (select count(*) from public.opps_invoices where id = '31800000-0000-0000-0000-000000000001') <> 1
     or (select count(*) from public.opps_invoice_items where invoice_id = '31800000-0000-0000-0000-000000000001') <> 2 then raise exception 'PRE_MIGRATION_INVOICE_NOT_READABLE'; end if;
  select count(*) into v_before_history from public.opps_invoice_item_versions where invoice_id = '31800000-0000-0000-0000-000000000001';
  select count(*) into v_before_activity from public.opps_invoice_activity where invoice_id = '31800000-0000-0000-0000-000000000001';
  v_result := public.save_opps_invoice_with_items(
    '31000000-0000-0000-0000-000000000001', '31800000-0000-0000-0000-000000000001',
    '{"customer_id":"31300000-0000-0000-0000-000000000001","customer_name":"Smoke Client A","invoice_date":"2026-07-01","status":"draft","currency_code":"ZAR","subtotal":250,"discount_total":10,"shipping_charge":25,"adjustment":0,"tax_total":36,"total":301,"amount_paid":50,"balance_due":251}'::jsonb,
    '[{"line_number":1,"item_name":"Existing line one","quantity":2,"rate":100,"discount":0,"tax_name":"VAT","tax_percentage":15,"item_total":200,"invoice_item_template_id":"31600000-0000-0000-0000-000000000001","catalog_item_id":"31400000-0000-0000-0000-000000000001","inventory_item_id":"31500000-0000-0000-0000-000000000001","line_key":"pre-a-1"},{"line_number":2,"item_name":"Existing line two","quantity":1,"rate":50,"discount":0,"tax_percentage":0,"item_total":50,"line_key":"pre-a-2"}]'::jsonb,
    '2026-07-01'::timestamptz, 2
  );
  if v_result->>'item_count' <> '2' then raise exception 'MULTI_ITEM_SAVE_COUNT_WRONG'; end if;
  if (select row(subtotal, discount_total, shipping_charge, tax_total, total, amount_paid, balance_due)::text from public.opps_invoices where id = '31800000-0000-0000-0000-000000000001') <> '(250,10,25,36,301,50,251)' then raise exception 'TOTALS_CHANGED'; end if;
  if (select count(*) from public.opps_invoice_item_templates where id = '31600000-0000-0000-0000-000000000001' and is_active) <> 1 then raise exception 'TEMPLATE_BROKEN'; end if;
  if (select count(*) from public.opps_invoice_item_versions where invoice_id = '31800000-0000-0000-0000-000000000001') <> v_before_history then raise exception 'ITEM_HISTORY_CHANGED'; end if;
  if (select count(*) from public.opps_invoice_activity where invoice_id = '31800000-0000-0000-0000-000000000001') <> v_before_activity then raise exception 'ACTIVITY_HISTORY_CHANGED'; end if;
end
$$;

do $$
declare v_result jsonb; v_id uuid;
begin
  v_result := public.save_opps_invoice_with_items(
    '31000000-0000-0000-0000-000000000001', null,
    '{"invoice_number":"FROM-ORDER-A","customer_id":"31300000-0000-0000-0000-000000000001","customer_name":"Smoke Client A","source_order_id":"31700000-0000-0000-0000-000000000001","invoice_date":"2026-08-02","status":"draft","currency_code":"ZAR","subtotal":250,"discount_total":0,"shipping_charge":20,"tax_total":0,"total":270,"amount_paid":50,"balance_due":220}'::jsonb,
    '[{"line_number":1,"item_name":"Order line one","quantity":2,"rate":100,"item_total":200,"source_order_item_id":"31710000-0000-0000-0000-000000000001"},{"line_number":2,"item_name":"Order line two","quantity":1,"rate":50,"item_total":50,"source_order_item_id":"31710000-0000-0000-0000-000000000002"}]'::jsonb,
    null, 0
  );
  v_id := (v_result->'invoice'->>'id')::uuid;
  if (select source_order_id from public.opps_invoices where id = v_id) <> '31700000-0000-0000-0000-000000000001' then raise exception 'ORDER_LINK_LOST'; end if;
  if (select count(*) from public.opps_invoice_items where invoice_id = v_id) <> 2 then raise exception 'ORDER_LINES_LOST_AFTER_REOPEN'; end if;
  if (select count(*) from public.opps_invoices where source_order_id = '31700000-0000-0000-0000-000000000001') <> 1 then raise exception 'ORDER_SUMMARY_WRONG'; end if;
end
$$;

do $$
declare v_name text; v_items jsonb; v_version timestamptz; v_code text;
begin
  select customer_name, updated_at into v_name, v_version from public.opps_invoices where id = '31800000-0000-0000-0000-000000000001';
  select jsonb_agg(to_jsonb(i) order by line_number) into v_items from public.opps_invoice_items i where invoice_id = '31800000-0000-0000-0000-000000000001';
  begin
    perform public.save_opps_invoice_with_items(
      '31000000-0000-0000-0000-000000000001', '31800000-0000-0000-0000-000000000001',
      '{"customer_name":"MUST ROLL BACK","invoice_date":"2026-08-02","status":"draft"}'::jsonb,
      '[{"item_name":"Invalid","quantity":0,"rate":10,"item_total":0}]'::jsonb, v_version, 2);
    raise exception 'INVALID_LINE_ACCEPTED';
  exception when check_violation then null;
  end;
  if (select customer_name from public.opps_invoices where id = '31800000-0000-0000-0000-000000000001') is distinct from v_name then raise exception 'FAILED_LINE_CHANGED_HEADER'; end if;
  if (select jsonb_agg(to_jsonb(i) order by line_number) from public.opps_invoice_items i where invoice_id = '31800000-0000-0000-0000-000000000001') is distinct from v_items then raise exception 'FAILED_LINE_CHANGED_ITEMS'; end if;
  begin
    perform public.save_opps_invoice_with_items(
      '31000000-0000-0000-0000-000000000001', '31800000-0000-0000-0000-000000000002',
      '{"customer_name":"No","invoice_date":"2026-08-02","status":"approved"}'::jsonb,
      '[{"item_name":"No","quantity":1,"rate":1,"item_total":1}]'::jsonb, '2026-07-01'::timestamptz, 2);
    raise exception 'APPROVED_EDIT_ACCEPTED';
  exception when others then
    get stacked diagnostics v_code = message_text;
    if v_code <> 'INVOICE_NOT_EDITABLE' then raise; end if;
  end;
end
$$;

-- Tenant A can see A and not B through the real table RLS policies.
do $$
begin
  if (select count(*) from public.opps_invoices where tenant_id = '31000000-0000-0000-0000-000000000001') < 3 then raise exception 'TENANT_A_ROWS_HIDDEN'; end if;
  if exists (select 1 from public.opps_invoices where tenant_id = '32000000-0000-0000-0000-000000000002') then raise exception 'TENANT_A_SAW_TENANT_B'; end if;
end
$$;

set local request.jwt.claims = '{"sub":"3b000000-0000-0000-0000-000000000002","email":"finance-b@example.invalid","role":"authenticated"}';
do $$
begin
  if (select count(*) from public.opps_invoices where tenant_id = '32000000-0000-0000-0000-000000000002') <> 1 then raise exception 'TENANT_B_ROWS_HIDDEN'; end if;
  if exists (select 1 from public.opps_invoices where tenant_id = '31000000-0000-0000-0000-000000000001') then raise exception 'TENANT_B_SAW_TENANT_A'; end if;
end
$$;

set local request.jwt.claims = '{"sub":"3c000000-0000-0000-0000-000000000003","email":"staff-a@example.invalid","role":"authenticated"}';
do $$
declare v_code text;
begin
  begin
    perform public.save_opps_invoice_with_items(
      '31000000-0000-0000-0000-000000000001', '31800000-0000-0000-0000-000000000001',
      '{"customer_name":"No","invoice_date":"2026-08-02","status":"draft"}'::jsonb,
      '[{"item_name":"No","quantity":1,"rate":1,"item_total":1}]'::jsonb,
      (select updated_at from public.opps_invoices where id = '31800000-0000-0000-0000-000000000001'), 2);
    raise exception 'UNAUTHORISED_FINANCE_EDIT_ACCEPTED';
  exception when others then
    get stacked diagnostics v_code = message_text;
    if v_code <> 'INVOICE_ACCESS_DENIED' then raise; end if;
  end;
end
$$;

reset role;
do $$
begin
  if has_function_privilege('public', 'public.save_opps_invoice_with_items(uuid,uuid,jsonb,jsonb,timestamptz,integer)', 'execute') then raise exception 'PUBLIC_EXECUTE_PRESENT'; end if;
  if has_function_privilege('anon', 'public.save_opps_invoice_with_items(uuid,uuid,jsonb,jsonb,timestamptz,integer)', 'execute') then raise exception 'ANON_EXECUTE_PRESENT'; end if;
  if has_function_privilege('service_role', 'public.save_opps_invoice_with_items(uuid,uuid,jsonb,jsonb,timestamptz,integer)', 'execute') then raise exception 'SERVICE_ROLE_EXECUTE_PRESENT'; end if;
  if not has_function_privilege('authenticated', 'public.save_opps_invoice_with_items(uuid,uuid,jsonb,jsonb,timestamptz,integer)', 'execute') then raise exception 'AUTHENTICATED_EXECUTE_MISSING'; end if;
end
$$;

select 'ALL_FULL_SCHEMA_STAGING_SMOKE_TESTS_PASSED' as result;
rollback;
