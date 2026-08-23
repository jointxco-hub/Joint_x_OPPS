-- Fixes a live, already-manifested defect: invoice -> order sync
-- (buildInvoiceOrderSyncPlan / syncOrderItemsFromInvoice) creates a fresh
-- order line for each still-unmatched invoice item, but nothing ever
-- wrote that new line_id back onto the originating
-- opps_invoice_items.source_order_item_id. Every subsequent sync of the
-- same still-unmatched invoice item therefore re-treats it as brand new
-- and mints another duplicate order line - confirmed live on order
-- ORD-MT4NPA4O (bea3af04-d6c8-4561-9eda-91b2ad735b70), which now carries
-- two duplicate pairs for "X1 - Satin Labels" and "B4A Spirit of
-- Understanding Wrap-Print T-Shirt".
--
-- The previous implementation did this as two separate REST calls
-- (orders.update, then a separate activity insert, with no write-back at
-- all) - a failure between them could already leave the order updated
-- with no activity record, and the missing write-back guaranteed
-- duplication on every re-sync regardless of failure. This function
-- performs the order update, every invoice-item write-back, and the
-- activity log entry inside one plpgsql function body, which Postgres
-- runs as a single transaction - either everything commits or nothing
-- does, so "order line created but invoice item still unmatched" is no
-- longer reachable.
--
-- Every id this function is given (order, invoice, and each invoice item
-- inside the pairings array) is independently re-verified server-side -
-- tenant access, tenant match between order and invoice, that the
-- invoice is actually linked to this order, and that each paired
-- invoice_item_id truly belongs to this invoice and tenant before its
-- source_order_item_id is touched. A caller can supply anything in
-- p_products/p_line_pairings; none of it is trusted for identity or
-- authorization, only for the commercial line content itself.
create or replace function public.apply_invoice_order_sync(
  p_order_id uuid,
  p_invoice_id uuid,
  p_products jsonb,
  p_line_pairings jsonb default '[]'::jsonb,
  p_activity_metadata jsonb default '{}'::jsonb,
  p_apply_shipping_fee boolean default null,
  p_shipping_fee numeric default null
)
returns public.orders
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order public.orders%rowtype;
  v_order_before public.orders%rowtype;
  v_invoice public.opps_invoices%rowtype;
  v_pairing jsonb;
  v_invoice_item_id uuid;
  v_new_line_id text;
  v_actor text;
begin
  if not public.is_opps_staff() then
    raise exception using errcode = '42501', message = 'STAFF_ACCESS_REQUIRED';
  end if;

  if jsonb_typeof(p_products) is distinct from 'array' then
    raise exception using errcode = 'P0001', message = 'INVALID_PRODUCTS_PAYLOAD';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if v_order.id is null then
    raise exception using errcode = 'P0001', message = 'ORDER_NOT_FOUND';
  end if;
  if not public.can_access_tenant(v_order.tenant_id) then
    raise exception using errcode = '42501', message = 'TENANT_ACCESS_DENIED';
  end if;

  select * into v_invoice from public.opps_invoices where id = p_invoice_id;
  if v_invoice.id is null then
    raise exception using errcode = 'P0001', message = 'INVOICE_NOT_FOUND';
  end if;
  if not public.can_access_tenant(v_invoice.tenant_id) then
    raise exception using errcode = '42501', message = 'TENANT_ACCESS_DENIED';
  end if;

  if v_invoice.tenant_id is distinct from v_order.tenant_id then
    raise exception using errcode = 'P0001', message = 'TENANT_MISMATCH';
  end if;

  -- The invoice must actually be the one linked to this order - a valid
  -- invoice id and a valid order id are not, on their own, permission to
  -- sync one into the other.
  if v_invoice.source_order_id is distinct from p_order_id then
    raise exception using errcode = 'P0001', message = 'INVOICE_NOT_LINKED_TO_ORDER';
  end if;

  if v_invoice.status = 'paid' then
    raise exception using errcode = 'P0001', message = 'PAID_INVOICE_SYNC_BLOCKED';
  end if;
  if v_invoice.status = 'void' then
    raise exception using errcode = 'P0001', message = 'VOID_INVOICE_SYNC_BLOCKED';
  end if;

  -- Mirrors isOrderProductsLocked() exactly (orderToInvoiceItems.js) -
  -- an invoice-originated line never bypasses the order correction lock,
  -- regardless of what the client believes the lock state to be.
  if (v_order.status is not null and v_order.status <> 'confirmed') or v_order.products_locked_at is not null then
    raise exception using errcode = 'P0001', message = 'ORDER_PRODUCTS_LOCKED';
  end if;

  v_order_before := v_order;

  update public.orders
  set products = p_products,
      apply_shipping_fee = coalesce(p_apply_shipping_fee, apply_shipping_fee),
      shipping_fee = coalesce(p_shipping_fee, shipping_fee),
      updated_at = now()
  where id = p_order_id
  returning * into v_order;

  for v_pairing in select * from jsonb_array_elements(coalesce(p_line_pairings, '[]'::jsonb))
  loop
    v_invoice_item_id := nullif(v_pairing ->> 'invoiceItemId', '')::uuid;
    v_new_line_id := nullif(btrim(coalesce(v_pairing ->> 'newLineId', '')), '');

    if v_invoice_item_id is null or v_new_line_id is null then
      continue;
    end if;

    -- Scoped to invoice_id + tenant_id, not just id, so a stale or
    -- malicious pairing can never write source_order_item_id onto an
    -- invoice item belonging to a different invoice or tenant.
    --
    -- source_order_item_id is uuid, not text (confirmed live via
    -- disposable rollback verification - a plain v_new_line_id
    -- assignment fails with "column is of type uuid but expression is
    -- of type text"). Every line_id ever reaching this point is already
    -- a well-formed UUID string - the enforce_order_product_line_identity
    -- trigger on orders.products rejects anything else - so this cast
    -- can never fail in practice, only make explicit what was
    -- previously an implicit, incorrect assumption.
    update public.opps_invoice_items
    set source_order_item_id = v_new_line_id::uuid
    where id = v_invoice_item_id
      and invoice_id = p_invoice_id
      and tenant_id = v_order.tenant_id;
  end loop;

  -- auth.email() reads only the JWT's email claim, which is not
  -- guaranteed present on every session shape (confirmed via disposable
  -- verification: a session authenticated only via sub/role, with no
  -- email claim, left auth.email() null and broke the NOT NULL
  -- actor_email column below). Falls back to the same public.users
  -- lookup is_opps_staff() itself already relies on to identify the
  -- caller - a genuine OPPS staff member who just passed that check is
  -- guaranteed to have a row there.
  v_actor := coalesce(auth.email(), (select u.user_email from public.users u where u.auth_user_id = auth.uid()));

  insert into public.opps_activity_events (
    tenant_id, actor_email, actor_name, event_type, entity_type, entity_id, summary, metadata
  ) values (
    v_order.tenant_id, v_actor, v_actor, 'order_synced_from_invoice', 'order', p_order_id,
    'Synced from invoice ' || coalesce(v_invoice.invoice_number, v_invoice.id::text),
    coalesce(p_activity_metadata, '{}'::jsonb) || jsonb_build_object('invoice_id', p_invoice_id)
  );

  if p_apply_shipping_fee is not null and (
    v_order.apply_shipping_fee is distinct from v_order_before.apply_shipping_fee
    or v_order.shipping_fee is distinct from v_order_before.shipping_fee
  ) then
    insert into public.opps_activity_events (
      tenant_id, actor_email, actor_name, event_type, entity_type, entity_id, summary, metadata
    ) values (
      v_order.tenant_id, v_actor, v_actor, 'order_shipping_charge_changed', 'order', p_order_id,
      format('Shipping changed via invoice sync: R%s -> R%s',
        coalesce(v_order_before.shipping_fee, 0), coalesce(v_order.shipping_fee, 0)),
      jsonb_build_object(
        'invoice_id', p_invoice_id,
        'before', jsonb_build_object('apply_shipping_fee', v_order_before.apply_shipping_fee, 'shipping_fee', v_order_before.shipping_fee),
        'after', jsonb_build_object('apply_shipping_fee', v_order.apply_shipping_fee, 'shipping_fee', v_order.shipping_fee)
      )
    );
  end if;

  return v_order;
end;
$function$;

revoke all on function public.apply_invoice_order_sync(uuid, uuid, jsonb, jsonb, jsonb, boolean, numeric) from public, anon;
grant execute on function public.apply_invoice_order_sync(uuid, uuid, jsonb, jsonb, jsonb, boolean, numeric) to authenticated;
