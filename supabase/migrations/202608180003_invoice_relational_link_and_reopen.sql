-- Extends invoice<->order linking beyond draft-only, with the same-client
-- and same-tenant safety enforced SERVER-SIDE for the first time (the
-- existing InvoicesTab/OrderLinkPanel picker only re-verified this in JS -
-- see orderInvoiceCandidates.js - so a direct RPC call could previously
-- have linked cross-client). Adds a purely relational linking path
-- (writes source_order_id only - never items/totals/customer snapshot)
-- for non-draft invoices, since the existing linkInvoiceToOrder() always
-- resyncs items through save_opps_invoice_with_items(), which hard-blocks
-- any non-draft invoice (INVOICE_NOT_EDITABLE). The existing draft
-- resync-on-link behavior is left completely untouched.
--
-- Also adds a controlled invoice reopen (approved/exported/
-- imported_to_zoho/overdue/partially_paid -> draft) so staff are never
-- forced into creating a duplicate invoice just because the original was
-- approved. Paid and void invoices can never be reopened by this
-- function - OPPS has no credit-note/adjustment architecture, so
-- reopening a paid invoice's financials is left unsupported rather than
-- inventing one silently.

create or replace function public.link_invoice_to_order_relational(p_invoice_id uuid, p_order_id uuid)
returns public.opps_invoices
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_invoice public.opps_invoices%rowtype;
  v_order public.orders%rowtype;
begin
  if not (public.is_app_admin() or public.user_finance_level() in (1, 2)) then
    raise exception using errcode = '42501', message = 'FINANCE_PERMISSION_REQUIRED';
  end if;

  select * into v_invoice from public.opps_invoices where id = p_invoice_id;
  if v_invoice.id is null then
    raise exception using errcode = 'P0001', message = 'INVOICE_NOT_FOUND';
  end if;
  if not public.can_access_tenant(v_invoice.tenant_id) then
    raise exception using errcode = '42501', message = 'TENANT_ACCESS_DENIED';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if v_order.id is null then
    raise exception using errcode = 'P0001', message = 'ORDER_NOT_FOUND';
  end if;
  if not public.can_access_tenant(v_order.tenant_id) then
    raise exception using errcode = '42501', message = 'TENANT_ACCESS_DENIED';
  end if;

  if v_invoice.tenant_id is distinct from v_order.tenant_id then
    raise exception using errcode = 'P0001', message = 'TENANT_MISMATCH';
  end if;

  -- The one non-negotiable safety check this whole migration exists for:
  -- previously only enforced in orderInvoiceCandidates.js (JS), never
  -- here. No override path - a mismatch always blocks.
  if v_invoice.customer_id is null or v_order.client_id is null
     or v_invoice.customer_id is distinct from v_order.client_id then
    raise exception using errcode = 'P0001', message = 'CLIENT_MISMATCH';
  end if;

  if v_invoice.status = 'void' then
    raise exception using errcode = 'P0001', message = 'INVOICE_VOID';
  end if;

  -- Re-linking to the SAME order is a harmless no-op; linking to a
  -- DIFFERENT order while already linked is refused outright rather than
  -- silently reassigned - conservative by design (section 3F). An
  -- explicit unlink-then-relink stays available through the existing
  -- draft-only OrderLinkPanel/unlinkInvoiceFromOrder path.
  if v_invoice.source_order_id is not null and v_invoice.source_order_id is distinct from p_order_id then
    raise exception using errcode = 'P0001', message = 'INVOICE_ALREADY_LINKED';
  end if;

  update public.opps_invoices
  set source_order_id = p_order_id,
      updated_at = now(),
      updated_by = auth.uid()
  where id = p_invoice_id
  returning * into v_invoice;

  insert into public.opps_invoice_activity (
    invoice_id, tenant_id, activity_type, activity_label, activity_note, metadata, created_by
  ) values (
    p_invoice_id, v_invoice.tenant_id, 'invoice_linked_to_order', 'Linked to order (relational)', null,
    jsonb_build_object('order_id', p_order_id, 'order_number', v_order.order_number, 'link_mode', 'relational_only'),
    auth.uid()
  );

  return v_invoice;
end;
$function$;

revoke all on function public.link_invoice_to_order_relational(uuid, uuid) from public, anon;
grant execute on function public.link_invoice_to_order_relational(uuid, uuid) to authenticated;

create or replace function public.reopen_invoice(p_invoice_id uuid, p_reason text)
returns public.opps_invoices
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_invoice public.opps_invoices%rowtype;
  v_prev_status text;
begin
  -- Strictest tier this schema has (admin / owner-email override only -
  -- see user_finance_level()). "finance"/"finance_admin"/"manager" share
  -- level 2 with no finer split available, so level 1 is the only way to
  -- make this meaningfully stricter than ordinary invoice management
  -- without inventing a new role tier.
  if not (public.is_app_admin() or public.user_finance_level() = 1) then
    raise exception using errcode = '42501', message = 'FINANCE_ADMIN_REQUIRED';
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception using errcode = 'P0001', message = 'REASON_REQUIRED';
  end if;

  select * into v_invoice from public.opps_invoices where id = p_invoice_id;
  if v_invoice.id is null then
    raise exception using errcode = 'P0001', message = 'INVOICE_NOT_FOUND';
  end if;
  if not public.can_access_tenant(v_invoice.tenant_id) then
    raise exception using errcode = '42501', message = 'TENANT_ACCESS_DENIED';
  end if;

  v_prev_status := v_invoice.status;

  if v_prev_status = 'draft' then
    raise exception using errcode = 'P0001', message = 'INVOICE_ALREADY_DRAFT';
  end if;
  if v_prev_status = 'paid' then
    raise exception using errcode = 'P0001', message = 'PAID_INVOICE_REOPEN_BLOCKED';
  end if;
  if v_prev_status = 'void' then
    raise exception using errcode = 'P0001', message = 'VOID_INVOICE_REOPEN_BLOCKED';
  end if;

  update public.opps_invoices
  set status = 'draft',
      updated_at = now(),
      updated_by = auth.uid()
  where id = p_invoice_id
  returning * into v_invoice;

  -- from_status/to_status/activity_note already exist on this table for
  -- exactly this purpose - "Approved -> Reopened -> edited -> re-approved"
  -- is fully reconstructable from this one table, no parallel history.
  insert into public.opps_invoice_activity (
    invoice_id, tenant_id, activity_type, activity_label, activity_note, from_status, to_status, metadata, created_by
  ) values (
    p_invoice_id, v_invoice.tenant_id, 'invoice_reopened', 'Invoice reopened for correction', p_reason,
    v_prev_status, 'draft', jsonb_build_object('reason', p_reason), auth.uid()
  );

  return v_invoice;
end;
$function$;

revoke all on function public.reopen_invoice(uuid, text) from public, anon;
grant execute on function public.reopen_invoice(uuid, text) to authenticated;
