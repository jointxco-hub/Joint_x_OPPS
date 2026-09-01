-- Phase 1F-C2 — customer-facing structured invoices.
--
-- Legitimate OPPS invoices (public.opps_invoices / opps_invoice_items)
-- never reach a customer's X LAB account as openable records: the account
-- only renders invoices from orders.invoice_files (a manual jsonb array on
-- public.orders, populated only by a staff upload), while ~55% of invoices
-- are standalone (source_order_id IS NULL) and can never be represented
-- that way. get_customer_account() surfaces only aggregate numbers
-- (outstanding_balance / unpaid_invoice_count), no rows.
--
-- Fix: one additive, customer-scoped, SECURITY DEFINER read RPC. It
-- resolves the caller's client identity SOLELY from auth.uid() via
-- get_my_client_identity() (Phase 1F-C1, 202608300001) — which raises
-- CLIENT_IDENTITY_UNRESOLVED on zero or more than one match — resolves
-- that client's tenant, and scopes invoices by BOTH customer_id AND
-- tenant_id. No client id is accepted from the browser.
--
-- opps_invoices / opps_invoice_items RLS is staff-only (RESTRICTIVE
-- is_opps_staff() AND PERMISSIVE finance/admin + can_access_tenant), so a
-- customer session gets zero rows on a direct select; and an
-- authenticated session that is ALSO Joint X staff could read every
-- tenant invoice via a raw select — the same staff/customer overlap that
-- caused the 1F-C1 bug. Hence SECURITY DEFINER + explicit identity
-- scoping here, never RLS.
--
-- Visibility rule for this phase: every customer invoice EXCEPT status
-- 'draft' and 'void' is customer-visible. No new customer_visible column.
--
-- Does NOT modify get_customer_account, opps_invoices / opps_invoice_items
-- schema or RLS, orders, orders.invoice_files, PayFast, or any write path.
-- Nothing here creates, mutates, or activates an order, payment, or
-- invoice.

begin;

-- Customer-safe structured invoices for the authenticated caller.
-- Deliberately EXCLUDES (invoice): customer_id, customer_name/email/phone/
-- billing_address, tenant_id, reference_number, salesperson_name,
-- adjustment, payment_terms, notes, terms, internal_notes, zoho_*,
-- created_by/updated_by, created_at/updated_at, contact_person,
-- shipping_*, delivery_instructions, fulfillment_type.
-- Deliberately EXCLUDES (item): id, invoice_id, account_name,
-- source_order_item_id, tenant_id, invoice_item_template_id,
-- catalog_item_id, inventory_item_id, source_metadata, line_key,
-- specifications, proofs, created_at.
create or replace function public.get_my_invoices()
returns table (
  id               uuid,
  invoice_number   text,
  invoice_date     date,
  due_date         date,
  status           text,
  currency_code    text,
  subtotal         numeric,
  discount_total   numeric,
  shipping_charge  numeric,
  tax_total        numeric,
  total            numeric,
  amount_paid      numeric,
  balance_due      numeric,
  source_order_id  uuid,
  items            jsonb
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
