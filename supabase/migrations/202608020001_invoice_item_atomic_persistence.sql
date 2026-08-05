-- Branch 1: atomically persist an OPPS invoice header and its complete line set.
-- Additive only. This function does not alter existing tables or historical migrations.
-- Rollback: revoke/drop save_opps_invoice_with_items(uuid, uuid, jsonb, jsonb, timestamptz, integer).

create or replace function public.save_opps_invoice_with_items(
  p_tenant_id uuid,
  p_invoice_id uuid,
  p_invoice jsonb,
  p_items jsonb,
  p_expected_updated_at timestamptz default null,
  p_expected_item_count integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_invoice public.opps_invoices%rowtype;
  v_existing public.opps_invoices%rowtype;
  v_user_id uuid := auth.uid();
  v_items jsonb := coalesce(p_items, '[]'::jsonb);
  v_saved_items jsonb;
  v_existing_item_count integer := 0;
  v_is_create boolean := p_invoice_id is null;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'INVOICE_AUTH_REQUIRED';
  end if;
  if p_tenant_id is null
    or not public.can_access_tenant(p_tenant_id)
    or not (public.is_app_admin() or public.user_finance_level() in (1, 2))
  then
    raise exception using errcode = 'P0001', message = 'INVOICE_ACCESS_DENIED';
  end if;
  if jsonb_typeof(v_items) <> 'array' then
    raise exception using errcode = 'P0001', message = 'INVOICE_ITEMS_INVALID';
  end if;
  if jsonb_array_length(v_items) = 0 then
    raise exception using errcode = 'P0001', message = 'INVOICE_EMPTY_ITEMS_BLOCKED';
  end if;
  -- Mirror the editor's required line invariants here instead of relying on
  -- legacy table constraints, which vary between full-schema installations.
  if exists (
    select 1
    from jsonb_array_elements(v_items) as item_rows(source_item)
    where nullif(pg_catalog.btrim(source_item->>'item_name'), '') is null
      or coalesce(nullif(source_item->>'quantity', '')::numeric, 0) <= 0
      or coalesce(nullif(source_item->>'rate', '')::numeric, 0) < 0
  ) then
    raise exception using errcode = '23514', message = 'INVOICE_ITEM_INVALID_VALUES';
  end if;

  -- Reject caller-supplied ownership that conflicts with the transaction target.
  if exists (
    select 1
    from jsonb_array_elements(v_items) as item_rows(source_item)
    where (source_item ? 'tenant_id' and nullif(source_item->>'tenant_id', '')::uuid is distinct from p_tenant_id)
      or (
        not v_is_create
        and source_item ? 'invoice_id'
        and nullif(source_item->>'invoice_id', '')::uuid is distinct from p_invoice_id
      )
  ) then
    raise exception using errcode = 'P0001', message = 'INVOICE_ITEM_OWNERSHIP_MISMATCH';
  end if;

  -- Referenced records must belong to the same tenant as the invoice. Null
  -- references remain valid for free-form invoice lines.
  if exists (
    select 1
    from jsonb_array_elements(v_items) as item_rows(source_item)
    where nullif(source_item->>'invoice_item_template_id', '') is not null
      and not exists (
        select 1 from public.opps_invoice_item_templates template
        where template.id = (source_item->>'invoice_item_template_id')::uuid
          and template.tenant_id = p_tenant_id
      )
  ) then
    raise exception using errcode = 'P0001', message = 'INVOICE_ITEM_TEMPLATE_TENANT_MISMATCH';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(v_items) as item_rows(source_item)
    where nullif(source_item->>'catalog_item_id', '') is not null
      and not exists (
        select 1 from public.products product
        where product.id = (source_item->>'catalog_item_id')::uuid
          and product.tenant_id = p_tenant_id
      )
  ) then
    raise exception using errcode = 'P0001', message = 'INVOICE_CATALOG_ITEM_TENANT_MISMATCH';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(v_items) as item_rows(source_item)
    where nullif(source_item->>'inventory_item_id', '') is not null
      and not exists (
        select 1 from public.inventory inventory_item
        where inventory_item.id = (source_item->>'inventory_item_id')::uuid
          and inventory_item.tenant_id = p_tenant_id
      )
  ) then
    raise exception using errcode = 'P0001', message = 'INVOICE_INVENTORY_ITEM_TENANT_MISMATCH';
  end if;

  if v_is_create then
    insert into public.opps_invoices (
      invoice_number, customer_id, customer_name, customer_email, customer_phone,
      customer_billing_address, source_order_id, invoice_date, due_date, payment_terms,
      currency_code, status, reference_number, salesperson_name, subtotal, discount_total,
      shipping_charge, adjustment, tax_total, total, amount_paid, balance_due, notes,
      terms, internal_notes, tenant_id, created_by, updated_by
    ) values (
      nullif(p_invoice->>'invoice_number', ''), nullif(p_invoice->>'customer_id', '')::uuid,
      nullif(p_invoice->>'customer_name', ''), nullif(p_invoice->>'customer_email', ''),
      nullif(p_invoice->>'customer_phone', ''), nullif(p_invoice->>'customer_billing_address', ''),
      nullif(p_invoice->>'source_order_id', '')::uuid, nullif(p_invoice->>'invoice_date', '')::date,
      nullif(p_invoice->>'due_date', '')::date, nullif(p_invoice->>'payment_terms', ''),
      coalesce(nullif(p_invoice->>'currency_code', ''), 'ZAR'), coalesce(nullif(p_invoice->>'status', ''), 'draft'),
      nullif(p_invoice->>'reference_number', ''), nullif(p_invoice->>'salesperson_name', ''),
      coalesce(nullif(p_invoice->>'subtotal', '')::numeric, 0), coalesce(nullif(p_invoice->>'discount_total', '')::numeric, 0),
      coalesce(nullif(p_invoice->>'shipping_charge', '')::numeric, 0), coalesce(nullif(p_invoice->>'adjustment', '')::numeric, 0),
      coalesce(nullif(p_invoice->>'tax_total', '')::numeric, 0), coalesce(nullif(p_invoice->>'total', '')::numeric, 0),
      coalesce(nullif(p_invoice->>'amount_paid', '')::numeric, 0), coalesce(nullif(p_invoice->>'balance_due', '')::numeric, 0),
      nullif(p_invoice->>'notes', ''), nullif(p_invoice->>'terms', ''), nullif(p_invoice->>'internal_notes', ''),
      p_tenant_id, v_user_id, v_user_id
    ) returning * into v_invoice;
  else
    select * into v_existing
    from public.opps_invoices
    where id = p_invoice_id and tenant_id = p_tenant_id
    for update;

    if not found then
      raise exception using errcode = 'P0001', message = 'INVOICE_ACCESS_DENIED';
    end if;
    if v_existing.status <> 'draft' then
      raise exception using errcode = 'P0001', message = 'INVOICE_NOT_EDITABLE';
    end if;
    if p_expected_updated_at is not null and v_existing.updated_at is distinct from p_expected_updated_at then
      raise exception using errcode = 'P0001', message = 'INVOICE_STALE_VERSION';
    end if;

    select count(*) into v_existing_item_count
    from public.opps_invoice_items
    where invoice_id = p_invoice_id and tenant_id = p_tenant_id;

    if p_expected_item_count is null or p_expected_item_count <> v_existing_item_count then
      raise exception using errcode = 'P0001', message = 'INVOICE_ITEM_COUNT_CHANGED';
    end if;
    update public.opps_invoices set
      customer_id = nullif(p_invoice->>'customer_id', '')::uuid,
      customer_name = nullif(p_invoice->>'customer_name', ''),
      customer_email = nullif(p_invoice->>'customer_email', ''),
      customer_phone = nullif(p_invoice->>'customer_phone', ''),
      customer_billing_address = nullif(p_invoice->>'customer_billing_address', ''),
      source_order_id = nullif(p_invoice->>'source_order_id', '')::uuid,
      invoice_date = nullif(p_invoice->>'invoice_date', '')::date,
      due_date = nullif(p_invoice->>'due_date', '')::date,
      payment_terms = nullif(p_invoice->>'payment_terms', ''),
      currency_code = coalesce(nullif(p_invoice->>'currency_code', ''), 'ZAR'),
      status = coalesce(nullif(p_invoice->>'status', ''), 'draft'),
      reference_number = nullif(p_invoice->>'reference_number', ''),
      salesperson_name = nullif(p_invoice->>'salesperson_name', ''),
      subtotal = coalesce(nullif(p_invoice->>'subtotal', '')::numeric, 0),
      discount_total = coalesce(nullif(p_invoice->>'discount_total', '')::numeric, 0),
      shipping_charge = coalesce(nullif(p_invoice->>'shipping_charge', '')::numeric, 0),
      adjustment = coalesce(nullif(p_invoice->>'adjustment', '')::numeric, 0),
      tax_total = coalesce(nullif(p_invoice->>'tax_total', '')::numeric, 0),
      total = coalesce(nullif(p_invoice->>'total', '')::numeric, 0),
      amount_paid = coalesce(nullif(p_invoice->>'amount_paid', '')::numeric, 0),
      balance_due = coalesce(nullif(p_invoice->>'balance_due', '')::numeric, 0),
      notes = nullif(p_invoice->>'notes', ''),
      terms = nullif(p_invoice->>'terms', ''),
      internal_notes = nullif(p_invoice->>'internal_notes', ''),
      updated_by = v_user_id
    where id = p_invoice_id and tenant_id = p_tenant_id
    returning * into v_invoice;

    delete from public.opps_invoice_items
    where invoice_id = p_invoice_id and tenant_id = p_tenant_id;
  end if;

  insert into public.opps_invoice_items (
    invoice_id, tenant_id, line_number, item_name, item_description, item_type,
    quantity, unit, rate, discount, tax_name, tax_percentage, account_name,
    item_total, source_order_item_id, invoice_item_template_id, catalog_item_id,
    inventory_item_id, source_metadata, line_key, image_url, specifications, proofs
  )
  select
    v_invoice.id, p_tenant_id, coalesce(nullif(source_item->>'line_number', '')::integer, ordinality::integer),
    nullif(source_item->>'item_name', ''), nullif(source_item->>'item_description', ''),
    coalesce(nullif(source_item->>'item_type', ''), 'goods'),
    nullif(source_item->>'quantity', '')::numeric, nullif(source_item->>'unit', ''),
    nullif(source_item->>'rate', '')::numeric, coalesce(nullif(source_item->>'discount', '')::numeric, 0),
    nullif(source_item->>'tax_name', ''), coalesce(nullif(source_item->>'tax_percentage', '')::numeric, 0),
    nullif(source_item->>'account_name', ''), nullif(source_item->>'item_total', '')::numeric,
    nullif(source_item->>'source_order_item_id', '')::uuid, nullif(source_item->>'invoice_item_template_id', '')::uuid,
    nullif(source_item->>'catalog_item_id', '')::uuid, nullif(source_item->>'inventory_item_id', '')::uuid,
    coalesce(source_item->'source_metadata', '{}'::jsonb), nullif(source_item->>'line_key', ''),
    nullif(source_item->>'image_url', ''), coalesce(source_item->'specifications', '{}'::jsonb),
    coalesce(source_item->'proofs', '[]'::jsonb)
  from jsonb_array_elements(v_items) with ordinality as item_rows(source_item, ordinality);

  if v_is_create then
    insert into public.opps_invoice_activity (
      invoice_id, activity_type, activity_label, to_status, metadata, tenant_id, created_by
    ) values (
      v_invoice.id, 'invoice_created', 'Invoice created', v_invoice.status,
      jsonb_build_object('item_count', jsonb_array_length(v_items), 'atomic_save', true), p_tenant_id, v_user_id
    );
  elsif v_existing.status is distinct from v_invoice.status then
    insert into public.opps_invoice_activity (
      invoice_id, activity_type, activity_label, from_status, to_status, metadata, tenant_id, created_by
    ) values (
      v_invoice.id,
      case when v_invoice.status = 'approved' then 'invoice_approved' else 'invoice_updated' end,
      case when v_invoice.status = 'approved' then 'Invoice approved' else 'Invoice updated' end,
      v_existing.status, v_invoice.status,
      jsonb_build_object('item_count', jsonb_array_length(v_items), 'atomic_save', true), p_tenant_id, v_user_id
    );
  end if;

  select coalesce(jsonb_agg(to_jsonb(saved_item) order by saved_item.line_number), '[]'::jsonb)
  into v_saved_items
  from public.opps_invoice_items saved_item
  where saved_item.invoice_id = v_invoice.id and saved_item.tenant_id = p_tenant_id;

  return jsonb_build_object(
    'ok', true,
    'invoice', to_jsonb(v_invoice),
    'items', v_saved_items,
    'item_count', jsonb_array_length(v_saved_items)
  );
exception
  when others then
    -- Any exception rolls back the header, line replacement, and activity together.
    raise;
end;
$$;

revoke all on function public.save_opps_invoice_with_items(uuid, uuid, jsonb, jsonb, timestamptz, integer) from public, anon, service_role;
grant execute on function public.save_opps_invoice_with_items(uuid, uuid, jsonb, jsonb, timestamptz, integer) to authenticated;
