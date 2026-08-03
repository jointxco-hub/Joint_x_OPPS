\set ON_ERROR_STOP on

insert into public.tenants (id, slug) values
  ('10000000-0000-0000-0000-000000000001', 'test-tenant-a'),
  ('20000000-0000-0000-0000-000000000002', 'test-tenant-b');

insert into public.test_tenant_memberships (tenant_id, user_id, finance_level) values
  ('10000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 1),
  ('20000000-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', 1);

insert into public.products (id, tenant_id) values
  ('11000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001'),
  ('21000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002');

insert into public.inventory (id, tenant_id) values
  ('12000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001'),
  ('22000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002');

insert into public.opps_invoice_item_templates (id, tenant_id) values
  ('13000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001'),
  ('23000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002');

insert into public.opps_invoices (
  id, invoice_number, customer_name, invoice_date, status, subtotal, total, balance_due, tenant_id
) values
  ('14000000-0000-0000-0000-000000000001', 'TEST-A-DRAFT', 'Synthetic Customer A', current_date, 'draft', 30, 30, 30, '10000000-0000-0000-0000-000000000001'),
  ('14000000-0000-0000-0000-000000000002', 'TEST-A-APPROVED', 'Synthetic Customer A', current_date, 'approved', 30, 30, 30, '10000000-0000-0000-0000-000000000001'),
  ('24000000-0000-0000-0000-000000000002', 'TEST-B-DRAFT', 'Synthetic Customer B', current_date, 'draft', 30, 30, 30, '20000000-0000-0000-0000-000000000002');

insert into public.opps_invoice_items (
  invoice_id, tenant_id, line_number, item_name, quantity, rate, item_total
) values
  ('14000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 1, 'Original A1', 1, 10, 10),
  ('14000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 2, 'Original A2', 2, 10, 20),
  ('14000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 1, 'Approved A1', 1, 10, 10),
  ('14000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 2, 'Approved A2', 2, 10, 20),
  ('24000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 1, 'Original B1', 1, 10, 10),
  ('24000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 2, 'Original B2', 2, 10, 20);

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';

do $$
declare result jsonb;
begin
  result := public.save_opps_invoice_with_items(
    '10000000-0000-0000-0000-000000000001',
    null,
    jsonb_build_object(
      'invoice_number', 'TEST-A-CREATED', 'customer_name', 'Synthetic Created Customer',
      'invoice_date', current_date, 'currency_code', 'ZAR', 'status', 'draft',
      'subtotal', 12, 'total', 12, 'balance_due', 12
    ),
    '[{"line_number":1,"item_name":"Created line","quantity":1,"rate":12,"item_total":12}]'::jsonb,
    null,
    0
  );
  if result->>'item_count' <> '1' then raise exception 'CREATE_RETURN_COUNT_MISMATCH'; end if;
  if not exists (select 1 from public.opps_invoices where id = (result->'invoice'->>'id')::uuid and tenant_id = '10000000-0000-0000-0000-000000000001') then raise exception 'CREATE_HEADER_MISSING'; end if;
  if not exists (select 1 from public.opps_invoice_activity where invoice_id = (result->'invoice'->>'id')::uuid and activity_type = 'invoice_created') then raise exception 'CREATE_ACTIVITY_MISSING'; end if;
end
$$;

do $$
begin
  if (select count(*) from public.opps_invoice_items where invoice_id = '14000000-0000-0000-0000-000000000002') <> 2 then
    raise exception 'APPROVED_DETAIL_ITEMS_NOT_VISIBLE';
  end if;
end
$$;

do $$
declare
  before_version timestamptz;
  result jsonb;
begin
  select updated_at into before_version from public.opps_invoices where id = '14000000-0000-0000-0000-000000000001';
  result := public.save_opps_invoice_with_items(
    '10000000-0000-0000-0000-000000000001',
    '14000000-0000-0000-0000-000000000001',
    jsonb_build_object(
      'customer_name', 'Synthetic Customer A Updated', 'invoice_date', current_date,
      'currency_code', 'ZAR', 'status', 'draft', 'subtotal', 35, 'total', 35, 'balance_due', 35
    ),
    '[{"line_number":1,"item_name":"Original A1","quantity":3,"rate":10,"item_total":30,"invoice_item_template_id":"13000000-0000-0000-0000-000000000001","catalog_item_id":"11000000-0000-0000-0000-000000000001","inventory_item_id":"12000000-0000-0000-0000-000000000001"},{"line_number":2,"item_name":"New A3","quantity":1,"rate":5,"item_total":5}]'::jsonb,
    before_version,
    2
  );
  if result->>'item_count' <> '2' then raise exception 'SUCCESS_RETURN_COUNT_MISMATCH'; end if;
  if (select customer_name from public.opps_invoices where id = '14000000-0000-0000-0000-000000000001') <> 'Synthetic Customer A Updated' then raise exception 'SUCCESS_HEADER_NOT_COMMITTED'; end if;
  if (select count(*) from public.opps_invoice_items where invoice_id = '14000000-0000-0000-0000-000000000001') <> 2 then raise exception 'SUCCESS_ITEMS_NOT_COMMITTED'; end if;
  if exists (select 1 from public.opps_invoice_items where invoice_id = '14000000-0000-0000-0000-000000000001' and item_name = 'Original A2') then raise exception 'SUCCESS_REMOVED_ITEM_RETAINED'; end if;
end
$$;

do $$
declare
  before_name text;
  before_items jsonb;
  version timestamptz;
begin
  select customer_name, updated_at into before_name, version from public.opps_invoices where id = '14000000-0000-0000-0000-000000000001';
  select jsonb_agg(to_jsonb(i) order by line_number) into before_items from public.opps_invoice_items i where invoice_id = '14000000-0000-0000-0000-000000000001';
  begin
    perform public.save_opps_invoice_with_items(
      '10000000-0000-0000-0000-000000000001', '14000000-0000-0000-0000-000000000001',
      jsonb_build_object('customer_name', 'MUST ROLL BACK', 'invoice_date', current_date, 'status', 'draft'),
      '[{"line_number":1,"item_name":"Invalid","quantity":0,"rate":10,"item_total":0}]'::jsonb,
      version, 2
    );
    raise exception 'FAILED_LINE_WAS_ACCEPTED';
  exception when check_violation then null;
  end;
  if (select customer_name from public.opps_invoices where id = '14000000-0000-0000-0000-000000000001') is distinct from before_name then raise exception 'FAILED_LINE_CHANGED_HEADER'; end if;
  if (select jsonb_agg(to_jsonb(i) order by line_number) from public.opps_invoice_items i where invoice_id = '14000000-0000-0000-0000-000000000001') is distinct from before_items then raise exception 'FAILED_LINE_CHANGED_ITEMS'; end if;
end
$$;

do $$
declare
  before_items jsonb;
  version timestamptz;
begin
  select updated_at into version from public.opps_invoices where id = '14000000-0000-0000-0000-000000000001';
  select jsonb_agg(to_jsonb(i) order by line_number) into before_items from public.opps_invoice_items i where invoice_id = '14000000-0000-0000-0000-000000000001';
  begin
    perform public.save_opps_invoice_with_items(
      '10000000-0000-0000-0000-000000000001', '14000000-0000-0000-0000-000000000001',
      jsonb_build_object('customer_name', 'Invalid status', 'invoice_date', current_date, 'status', 'not-a-status'),
      '[{"line_number":1,"item_name":"Would replace","quantity":1,"rate":1,"item_total":1}]'::jsonb,
      version, 2
    );
    raise exception 'FAILED_HEADER_WAS_ACCEPTED';
  exception when check_violation then null;
  end;
  if (select jsonb_agg(to_jsonb(i) order by line_number) from public.opps_invoice_items i where invoice_id = '14000000-0000-0000-0000-000000000001') is distinct from before_items then raise exception 'FAILED_HEADER_CHANGED_ITEMS'; end if;
end
$$;

do $$
declare
  code text;
  version timestamptz;
  foreign_id uuid;
  field_name text;
begin
  select updated_at into version from public.opps_invoices where id = '14000000-0000-0000-0000-000000000001';

  begin
    perform public.save_opps_invoice_with_items(
      '10000000-0000-0000-0000-000000000001', '24000000-0000-0000-0000-000000000002',
      jsonb_build_object('customer_name', 'No', 'invoice_date', current_date, 'status', 'draft'),
      '[{"item_name":"No","quantity":1,"rate":1,"item_total":1}]'::jsonb, version, 2
    );
    raise exception 'CROSS_TENANT_INVOICE_ACCEPTED';
  exception when others then
    get stacked diagnostics code = message_text;
    if code <> 'INVOICE_ACCESS_DENIED' then raise; end if;
  end;

  begin
    perform public.save_opps_invoice_with_items(
      '10000000-0000-0000-0000-000000000001', '14000000-0000-0000-0000-000000000001',
      jsonb_build_object('customer_name', 'No', 'invoice_date', current_date, 'status', 'draft'),
      '[{"tenant_id":"20000000-0000-0000-0000-000000000002","item_name":"No","quantity":1,"rate":1,"item_total":1}]'::jsonb,
      version, 2
    );
    raise exception 'CROSS_TENANT_LINE_OWNERSHIP_ACCEPTED';
  exception when others then
    get stacked diagnostics code = message_text;
    if code <> 'INVOICE_ITEM_OWNERSHIP_MISMATCH' then raise; end if;
  end;

  for field_name, foreign_id in
    values
      ('invoice_item_template_id', '23000000-0000-0000-0000-000000000002'::uuid),
      ('catalog_item_id', '21000000-0000-0000-0000-000000000002'::uuid),
      ('inventory_item_id', '22000000-0000-0000-0000-000000000002'::uuid)
  loop
    begin
      perform public.save_opps_invoice_with_items(
        '10000000-0000-0000-0000-000000000001', '14000000-0000-0000-0000-000000000001',
        jsonb_build_object('customer_name', 'No', 'invoice_date', current_date, 'status', 'draft'),
        jsonb_build_array(jsonb_build_object('item_name', 'No', 'quantity', 1, 'rate', 1, 'item_total', 1, field_name, foreign_id)),
        version, 2
      );
      raise exception 'CROSS_TENANT_REFERENCE_ACCEPTED_%', field_name;
    exception when others then
      get stacked diagnostics code = message_text;
      if code not like '%TENANT_MISMATCH' then raise; end if;
    end;
  end loop;
end
$$;

do $$
declare version timestamptz; code text;
begin
  select updated_at into version from public.opps_invoices where id = '14000000-0000-0000-0000-000000000001';
  begin
    perform public.save_opps_invoice_with_items(
      '10000000-0000-0000-0000-000000000001', '14000000-0000-0000-0000-000000000001',
      jsonb_build_object('customer_name', 'No', 'invoice_date', current_date, 'status', 'draft'), '[]'::jsonb, version, 2
    );
    raise exception 'EMPTY_ITEMS_ACCEPTED';
  exception when others then
    get stacked diagnostics code = message_text;
    if code <> 'INVOICE_EMPTY_ITEMS_BLOCKED' then raise; end if;
  end;

  begin
    perform public.save_opps_invoice_with_items(
      '10000000-0000-0000-0000-000000000001', '14000000-0000-0000-0000-000000000002',
      jsonb_build_object('customer_name', 'No', 'invoice_date', current_date, 'status', 'approved'),
      '[{"item_name":"No","quantity":1,"rate":1,"item_total":1}]'::jsonb,
      (select updated_at from public.opps_invoices where id = '14000000-0000-0000-0000-000000000002'), 2
    );
    raise exception 'APPROVED_UPDATE_ACCEPTED';
  exception when others then
    get stacked diagnostics code = message_text;
    if code <> 'INVOICE_NOT_EDITABLE' then raise; end if;
  end;
end
$$;

do $$
declare version timestamptz; code text;
begin
  select updated_at into version from public.opps_invoices where id = '14000000-0000-0000-0000-000000000001';
  perform public.save_opps_invoice_with_items(
    '10000000-0000-0000-0000-000000000001', '14000000-0000-0000-0000-000000000001',
    jsonb_build_object('customer_name', 'First submission', 'invoice_date', current_date, 'status', 'draft'),
    '[{"item_name":"One","quantity":1,"rate":1,"item_total":1}]'::jsonb, version, 2
  );
  begin
    perform public.save_opps_invoice_with_items(
      '10000000-0000-0000-0000-000000000001', '14000000-0000-0000-0000-000000000001',
      jsonb_build_object('customer_name', 'Duplicate submission', 'invoice_date', current_date, 'status', 'draft'),
      '[{"item_name":"Duplicate","quantity":1,"rate":1,"item_total":1}]'::jsonb, version, 2
    );
    raise exception 'STALE_DUPLICATE_ACCEPTED';
  exception when others then
    get stacked diagnostics code = message_text;
    if code <> 'INVOICE_STALE_VERSION' then raise; end if;
  end;
  if (select count(*) from public.opps_invoice_items where invoice_id = '14000000-0000-0000-0000-000000000001') <> 1 then raise exception 'DUPLICATE_CREATED_ITEMS'; end if;
end
$$;

reset role;
set request.jwt.claim.sub = '';

set role anon;
do $$
declare code text;
begin
  begin
    perform public.save_opps_invoice_with_items(
      '10000000-0000-0000-0000-000000000001', '14000000-0000-0000-0000-000000000001',
      '{}'::jsonb, '[{"item_name":"No","quantity":1,"rate":1,"item_total":1}]'::jsonb, null, 1
    );
    raise exception 'ANONYMOUS_CALL_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
end
$$;

reset role;

do $$
begin
  if (select count(*) from public.opps_invoice_items where invoice_id = '14000000-0000-0000-0000-000000000002') <> 2 then raise exception 'APPROVED_ITEMS_CHANGED'; end if;
  if (select count(*) from public.opps_invoice_items where invoice_id = '24000000-0000-0000-0000-000000000002') <> 2 then raise exception 'TENANT_B_ITEMS_CHANGED'; end if;
end
$$;

select 'ALL_DATABASE_INTEGRATION_TESTS_PASSED' as result;
