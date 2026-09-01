-- Phase 1F-C2.1 — customer invoice document fields.
--
-- Extends get_my_invoices() (20260830160000) with a tight allowlist of
-- FOUR additional fields, all of which are the requesting customer's OWN
-- data, needed to render a proper customer-facing invoice document /
-- downloadable PDF (a "Bill To" block, their PO reference, and the
-- payment terms shown to them):
--     customer_name            (their own name/company on the invoice)
--     customer_billing_address (their own billing address)
--     payment_terms            (the terms shown to them, e.g. "Net 30")
--     reference_number         (their own PO / reference)
--
-- Everything else is UNCHANGED from v1:
--   * identity resolved solely from auth.uid() via get_my_client_identity()
--     (raises CLIENT_IDENTITY_UNRESOLVED on zero / more than one match)
--   * client's tenant resolved from the resolved client row
--   * scoped by BOTH customer_id AND tenant_id
--   * status 'draft' and 'void' excluded
--   * SECURITY DEFINER, STABLE, search_path = pg_catalog, public
--   * REVOKE PUBLIC / anon, GRANT EXECUTE to authenticated only
--   * item projection unchanged
--
-- STILL deliberately EXCLUDED (invoice): customer_id, customer_email,
-- customer_phone, tenant_id, salesperson_name, adjustment, notes, terms,
-- internal_notes, zoho_exported_at, zoho_imported_at, created_by,
-- updated_by, created_at, updated_at, contact_person, shipping_address,
-- shipping_courier, shipping_courier_code, delivery_instructions,
-- fulfillment_type.
-- STILL deliberately EXCLUDED (item): id, invoice_id, account_name,
-- source_order_item_id, tenant_id, invoice_item_template_id,
-- catalog_item_id, inventory_item_id, source_metadata, line_key,
-- specifications, proofs, created_at.
--
-- Does NOT modify get_customer_account, opps_invoices / opps_invoice_items
-- schema or RLS, orders, orders.invoice_files, PayFast, or any write path.
-- Read-only. Nothing here creates, mutates, or activates an order,
-- payment, or invoice.

begin;

-- Adding columns to the RETURNS TABLE changes the function's OUT-parameter
-- row type, which CREATE OR REPLACE cannot do -- an explicit DROP is
-- required. Safe here: get_my_invoices() has no catalog dependents (it is
-- only ever called as a PostgREST RPC / supabase-js .rpc()), and the
-- drop + recreate + re-grant all run inside this one transaction, so no
-- caller ever sees it missing -- concurrent calls block on the lock and
-- then resolve against the new definition.
drop function if exists public.get_my_invoices();

create function public.get_my_invoices()
returns table (
  id                       uuid,
  invoice_number           text,
  invoice_date             date,
  due_date                 date,
  status                   text,
  currency_code            text,
  subtotal                 numeric,
  discount_total           numeric,
  shipping_charge          numeric,
  tax_total                numeric,
  total                    numeric,
  amount_paid              numeric,
  balance_due              numeric,
  source_order_id          uuid,
  customer_name            text,
  customer_billing_address text,
  payment_terms            text,
  reference_number         text,
  items                    jsonb
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_client_id uuid := public.get_my_client_identity();
  v_tenant_id uuid;
begin
  select c.tenant_id into v_tenant_id from public.clients c where c.id = v_client_id;

  -- A client with no tenant cannot be matched to any invoice
  -- (opps_invoices.tenant_id is NOT NULL for every row in production).
  if v_tenant_id is null then
    return;
  end if;

  return query
  select
    i.id,
    i.invoice_number,
    i.invoice_date,
    i.due_date,
    i.status,
    i.currency_code,
    i.subtotal,
    i.discount_total,
    i.shipping_charge,
    i.tax_total,
    i.total,
    i.amount_paid,
    i.balance_due,
    i.source_order_id,
    i.customer_name,
    i.customer_billing_address,
    i.payment_terms,
    i.reference_number,
    coalesce(it.items, '[]'::jsonb) as items
  from public.opps_invoices i
  left join lateral (
    select jsonb_agg(
             jsonb_build_object(
               'line_number',     ii.line_number,
               'item_name',       ii.item_name,
               'item_description', ii.item_description,
               'item_type',       ii.item_type,
               'quantity',        ii.quantity,
               'unit',            ii.unit,
               'rate',            ii.rate,
               'discount',        ii.discount,
               'tax_name',        ii.tax_name,
               'tax_percentage',  ii.tax_percentage,
               'item_total',      ii.item_total,
               'image_url',       ii.image_url
             )
             order by ii.line_number
           ) as items
    from public.opps_invoice_items ii
    where ii.invoice_id = i.id
  ) it on true
  where i.customer_id = v_client_id
    and i.tenant_id = v_tenant_id
    and i.status not in ('draft', 'void')
  order by i.invoice_date desc, i.invoice_number desc;
end;
$$;

revoke all on function public.get_my_invoices() from public, anon;
grant execute on function public.get_my_invoices() to authenticated;

commit;
