-- DISPOSABLE ROLLBACK-ONLY TEST - PROPOSED, UNEXECUTED.
-- Exercises ordinary Tenant A operations and generic cross-tenant rejection.

begin;
set local statement_timeout = '60s';
set local role authenticated;
select set_config('request.jwt.claim.sub', '92000000-0000-4000-8000-000000000011', true);
select set_config('request.jwt.claim.email', 'phase0a-member-a@example.test', true);

-- Ordinary same-tenant writes must continue to work. Every change is rolled back.
update public.orders
set notes = 'Phase 0A rollback-only validation'
where id = '92000000-0000-4000-8000-000000000201';

update public.inventory
set location = 'Phase 0A rollback-only location'
where id = '92000000-0000-4000-8000-000000000401';

insert into public.purchase_orders (
  id, tenant_id, po_number, supplier_id, supplier_ids, status,
  items, subtotal, tax, total
) values (
  '92000000-0000-4000-8000-000000000311',
  '92000000-0000-4000-8000-000000000001',
  'PHASE0A-A-PO-VALID',
  '92000000-0000-4000-8000-000000000101',
  array['92000000-0000-4000-8000-000000000101'::uuid],
  'draft', '[]'::jsonb, 0, 0, 0
);

do $$
declare v_message text;
begin
  begin
    insert into public.purchase_orders (
      id, tenant_id, po_number, supplier_id, status, items, subtotal, tax, total
    ) values (
      '92000000-0000-4000-8000-000000000312',
      '92000000-0000-4000-8000-000000000001',
      'PHASE0A-CROSS-SUPPLIER',
      '92000000-0000-4000-8000-000000000102',
      'draft', '[]'::jsonb, 0, 0, 0
    );
    raise exception 'Cross-tenant supplier was accepted.';
  exception when check_violation then
    get stacked diagnostics v_message = message_text;
    if v_message <> 'Invalid purchasing relationship.' then
      raise exception 'Cross-tenant supplier exposed a different error: %', v_message;
    end if;
  end;

  begin
    insert into public.purchase_orders (
      id, tenant_id, po_number, supplier_id, status, items, subtotal, tax, total
    ) values (
      '92000000-0000-4000-8000-000000000313',
      '92000000-0000-4000-8000-000000000001',
      'PHASE0A-MISSING-SUPPLIER',
      '92000000-0000-4000-8000-000000000999',
      'draft', '[]'::jsonb, 0, 0, 0
    );
    raise exception 'Missing supplier was accepted.';
  exception when check_violation then
    get stacked diagnostics v_message = message_text;
    if v_message <> 'Invalid purchasing relationship.' then
      raise exception 'Missing supplier exposed a different error: %', v_message;
    end if;
  end;

  begin
    insert into public.purchase_orders (
      id, tenant_id, po_number, linked_order_id, status, items, subtotal, tax, total
    ) values (
      '92000000-0000-4000-8000-000000000314',
      '92000000-0000-4000-8000-000000000001',
      'PHASE0A-CROSS-ORDER',
      '92000000-0000-4000-8000-000000000202',
      'draft', '[]'::jsonb, 0, 0, 0
    );
    raise exception 'Cross-tenant linked order was accepted.';
  exception when check_violation then
    get stacked diagnostics v_message = message_text;
    if v_message <> 'Invalid purchasing relationship.' then
      raise exception 'Cross-tenant order exposed a different error: %', v_message;
    end if;
  end;
end;
$$;

reset role;
rollback;
