-- XOS Price Composition — Phase P5. INVOICE ACCOUNTING.
--
-- Make save_opps_invoice_with_items prove the stored invoice total
-- actually reconciles to its billable items, using the invoice domain's
-- OWN formula (src/features/invoices/invoiceCalculations.js):
--
--   line_subtotal_i = round(quantity_i * rate_i, 2)
--   discount_i      = greatest(discount_i, 0)
--   taxable_i       = greatest(line_subtotal_i - discount_i, 0)
--   line_tax_i      = round(taxable_i * tax_percentage_i / 100, 2)
--   subtotal        = round(sum(line_subtotal_i), 2)
--   discount_total  = round(sum(discount_i), 2)
--   tax_total       = round(sum(line_tax_i), 2)
--   total           = round(subtotal - discount_total
--                           + shipping_charge + adjustment + tax_total, 2)
--
-- Informational source_metadata.price_breakdown NEVER enters this sum
-- (§3, §8). A reserved line_role='breakdown' item is excluded.
--
-- On mismatch: INVOICE_TOTAL_MISMATCH, no partial save (§9, §27).
-- An explicit staff override is the ONLY way past it — new 7th param
-- p_allow_total_override plus a required total_override_reason; the
-- actor + timestamp are recorded on the header and an
-- 'invoice_total_overridden' activity row is written. Every ordinary
-- save stays a validated save, not an implicit override.
--
-- Legacy invoices are untouched — no backfill, no recompute of historical
-- detail (§10). Draft/approved/paid immutability unchanged (§11).
--
-- Depends on nothing new. save_opps_invoice_with_items reproduced
-- verbatim + the marked P5 additions; every existing guard (auth, tenant,
-- template/catalog/inventory tenant checks, optimistic lock, draft gate,
-- atomic delete+reinsert) is preserved.
--
-- PHASE P5 ONLY: this file + disposable tests. NOT APPLIED. No deploy.

begin;

alter table public.opps_invoices
  add column if not exists total_override_reason text,
  add column if not exists total_override_by     uuid,
  add column if not exists total_override_at      timestamptz;

comment on column public.opps_invoices.total_override_reason is
  'Set only when a staff member explicitly saved an invoice whose stored total does not reconcile to its billable items (save_opps_invoice_with_items p_allow_total_override). NULL for every validated save.';

-- Signature grows by one defaulted param, so the old function must be
-- dropped (CREATE OR REPLACE cannot change the argument list). Existing
-- 6-arg callers still resolve — the 7th param defaults to false.
drop function if exists public.save_opps_invoice_with_items(uuid, uuid, jsonb, jsonb, timestamptz, integer);

create or replace function public.save_opps_invoice_with_items(
  p_tenant_id uuid,
  p_invoice_id uuid,
  p_invoice jsonb,
  p_items jsonb,
  p_expected_updated_at timestamp with time zone default null,
  p_expected_item_count integer default null,
  p_allow_total_override boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_invoice public.opps_invoices%rowtype;
  v_existing public.opps_invoices%rowtype;
  v_user_id uuid := auth.uid();
  v_items jsonb := coalesce(p_items, '[]'::jsonb);
  v_saved_items jsonb;
  v_existing_item_count integer := 0;
  v_is_create boolean := p_invoice_id is null;
  -- P5 total invariant
  v_billable_subtotal numeric := 0;
  v_billable_discount  numeric := 0;
  v_billable_tax       numeric := 0;
  v_computed_total     numeric := 0;
  v_stated_total       numeric := coalesce(nullif(p_invoice->>'total', '')::numeric, 0);
  v_shipping           numeric := coalesce(nullif(p_invoice->>'shipping_charge', '')::numeric, 0);
  v_adjustment         numeric := coalesce(nullif(p_invoice->>'adjustment', '')::numeric, 0);
  v_override_reason    text := nullif(btrim(p_invoice->>'total_override_reason'), '');
  v_did_override       boolean := false;
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
  if exists (
    select 1
    from jsonb_array_elements(v_items) as item_rows(source_item)
    where nullif(pg_catalog.btrim(source_item->>'item_name'), '') is null
      or coalesce(nullif(source_item->>'quantity', '')::numeric, 0) <= 0
      or coalesce(nullif(source_item->>'rate', '')::numeric, 0) < 0
  ) then
    raise exception using errcode = '23514', message = 'INVOICE_ITEM_INVALID_VALUES';
  end if;

  -- ── P5: billable total invariant ─────────────────────────────────────
  -- Recompute from the BILLABLE items only. Informational
  -- source_metadata.price_breakdown is not a rate/quantity/discount and
  -- never enters; a reserved line_role='breakdown' item is skipped.
  select
    coalesce(sum(round(
      (coalesce(nullif(e->>'quantity', '')::numeric, 0) * coalesce(nullif(e->>'rate', '')::numeric, 0)), 2)), 0),
    coalesce(sum(greatest(coalesce(nullif(e->>'discount', '')::numeric, 0), 0)), 0),
    coalesce(sum(round(
      greatest(
        round((coalesce(nullif(e->>'quantity', '')::numeric, 0) * coalesce(nullif(e->>'rate', '')::numeric, 0)), 2)
        - greatest(coalesce(nullif(e->>'discount', '')::numeric, 0), 0), 0)
      * (greatest(coalesce(nullif(e->>'tax_percentage', '')::numeric, 0), 0) / 100.0), 2)), 0)
  into v_billable_subtotal, v_billable_discount, v_billable_tax
  from jsonb_array_elements(v_items) e
  where coalesce(nullif(e->>'line_role', ''), coalesce(e #>> '{source_metadata,line_role}', 'product')) <> 'breakdown';

  v_computed_total := round(v_billable_subtotal - v_billable_discount + v_shipping + v_adjustment + v_billable_tax, 2);

  if abs(v_computed_total - v_stated_total) > 0.01 then
    if not coalesce(p_allow_total_override, false) then
      raise exception using errcode = 'P0001',
        message = format('INVOICE_TOTAL_MISMATCH: billable items reconcile to %s but the stated total is %s', v_computed_total, v_stated_total);
    end if;
    if v_override_reason is null then
      raise exception using errcode = 'P0001', message = 'INVOICE_TOTAL_OVERRIDE_REASON_REQUIRED';
    end if;
    v_did_override := true;
  end if;

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
      terms, internal_notes, tenant_id, created_by, updated_by,
      total_override_reason, total_override_by, total_override_at
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
      p_tenant_id, v_user_id, v_user_id,
      case when v_did_override then v_override_reason else null end,
      case when v_did_override then v_user_id else null end,
      case when v_did_override then now() else null end
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
      updated_by = v_user_id,
      total_override_reason = case when v_did_override then v_override_reason else null end,
      total_override_by     = case when v_did_override then v_user_id else null end,
      total_override_at      = case when v_did_override then now() else null end
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

  if v_did_override then
    insert into public.opps_invoice_activity (
      invoice_id, activity_type, activity_label, to_status, metadata, tenant_id, created_by
    ) values (
      v_invoice.id, 'invoice_total_overridden', 'Invoice total overridden', v_invoice.status,
      jsonb_build_object('computed_total', v_computed_total, 'stated_total', v_stated_total,
                         'difference', round(v_stated_total - v_computed_total, 2), 'reason', v_override_reason),
      p_tenant_id, v_user_id
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
    'item_count', jsonb_array_length(v_saved_items),
    'total_reconciled', not v_did_override
  );
exception
  when others then
    raise;
end;
$function$;

revoke all on function public.save_opps_invoice_with_items(uuid, uuid, jsonb, jsonb, timestamptz, integer, boolean) from public, anon;
grant execute on function public.save_opps_invoice_with_items(uuid, uuid, jsonb, jsonb, timestamptz, integer, boolean) to authenticated;

commit;
