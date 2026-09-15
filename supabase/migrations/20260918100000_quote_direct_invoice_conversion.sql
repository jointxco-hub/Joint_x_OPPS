-- ════════════════════════════════════════════════════════════════════
--  QUOTE → INVOICE (DIRECT) — SECOND CONVERSION PATH
-- ════════════════════════════════════════════════════════════════════
--
-- Product requirement change: the Phase 1 "Quote → Order → Invoice"
-- migration (20260916090000) is extended, not replaced. OPPS now supports
-- two independent paths from an accepted quote:
--   Quote -> Order -> Invoice   (existing, UNCHANGED)
--   Quote -> Invoice -> Order   (new, this migration)
--
-- Scope discipline:
--   * Does NOT touch the quote lifecycle beyond one new event metadata
--     shape under the SAME existing 'converted' event_type (no new value).
--   * Does NOT create a second invoice-numbering system — the new RPC
--     calls the EXISTING public.next_opps_invoice_number(tenant_id), the
--     same allocator save_opps_invoice_with_items()/createInvoice() use.
--   * Does NOT touch PayFast/payment code, RLS, or the invoice lifecycle
--     status machine. A direct quote invoice starts status='draft',
--     amount_paid=0, exactly like every other invoice.
--   * Does NOT change the existing Order -> Invoice path
--     (CreateInvoiceFromOrderButton.jsx / invoiceFromOrder()) at all.
--   * DOES redefine convert_quote_to_order() — not to change its existing
--     behavior, but to add TWO things the new product requirement needs:
--     (a) propagate source_invoice_id onto the order when the quote
--         already has a direct invoice (converted_invoice_id);
--     (b) call the EXISTING, canonical link_invoice_to_order_relational()
--         RPC to set that invoice's own source_order_id — the field
--         PROVEN (not inferred) to be what listInvoices({sourceOrderId}),
--         InvoicesTab's linked-invoices query, OrderLinkPanel, and
--         sibling-invoice detection all actually key off (see the audit
--         note below). Without this, the direct invoice would NOT appear
--         in the order's own Invoices tab or be discoverable as a
--         sibling — the architecture gap this migration revision closes.
--     The reviewed body is otherwise byte-identical, with one incidental
--     correction noted inline (see "totals path fix" below) — evidence-
--     based, not new scope.
--
-- ── Audit: the canonical invoice<->order field (proven from code, not
--    inferred from naming) ───────────────────────────────────────────
-- src/api/invoices.js:1070 — listInvoices({sourceOrderId}) filters
--   `.eq("source_order_id", options.sourceOrderId)`.
-- src/features/invoices/OrderLinkPanel.jsx — linkedOrderQuery keys off
--   invoice.source_order_id; the "already linked to a different order"
--   guard the UI relies on is enforced server-side, not just client-side.
-- supabase/migrations/202608180003_invoice_relational_link_and_reopen.sql
--   — link_invoice_to_order_relational(p_invoice_id, p_order_id) is the
--   ONE existing RPC that performs this link: tenant match, client match,
--   void-invoice refusal, "already linked to a DIFFERENT order" refusal
--   (INVOICE_ALREADY_LINKED — re-linking to the SAME order is a no-op),
--   `update opps_invoices set source_order_id = p_order_id`, and an
--   opps_invoice_activity row ('invoice_linked_to_order'). This is
--   REUSED verbatim below — no parallel linking logic is written.
-- Conclusion: opps_invoices.source_order_id IS the canonical field, and
-- the existing implementation was NOT sufficient without this call — a
-- direct quote invoice would otherwise remain permanently invisible to
-- every order-side view once an order was created from the same quote.
--
-- ── Design decision: quote status stays 'accepted' after a direct
--    invoice ─────────────────────────────────────────────────────────
-- convert_quote_to_invoice() deliberately does NOT set opps_quotes.status
-- to 'converted'. If it did, convert_quote_to_order()'s existing
-- eligibility check (status = 'accepted') would permanently block a
-- later "Create Order" on the same quote — breaking exactly the UI state
-- the product spec requires ("Invoice created, no order: View Invoice,
-- Create Order"). Status only becomes 'converted' once an ORDER exists
-- (by either path), matching its original meaning ("this quote has
-- spawned real operational work"). This is the smallest change that
-- keeps both paths independently available until an order is created.
--
-- ── convert_quote_to_invoice() must not orphan-invoice an order that
--    already exists ───────────────────────────────────────────────────
-- If a quote already has converted_order_id set (Quote -> Order already
-- happened), creating an invoice for it belongs to the EXISTING, already
-- fixed Order -> Invoice path (which correctly derives shipping etc. from
-- the order), not this one. convert_quote_to_invoice() refuses with
-- QUOTE_ORDER_ALREADY_EXISTS rather than silently creating a second,
-- order-less invoice for a quote that already has operational work.
--
-- ── Financial rule ───────────────────────────────────────────────────
-- subtotal/discount_total/shipping_charge/tax_total/total are read
-- EXCLUSIVELY from the immutable accepted revision snapshot's own
-- top-level keys (confirmed shape: quote snapshots store these as
-- top-level jsonb keys, NOT nested under a 'totals' object — see the
-- totals-path fix note below). No default shipping is injected; the
-- snapshot's own shipping_charge (0 if the quote had none) is used as-is.
--
-- STAGING-FIRST. NOT APPLIED. NO PRODUCTION WRITE. NO DEPLOY. NO PUSH.
-- ════════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
begin
  if to_regclass('public.opps_invoices') is null then
    raise exception 'QUOTE_DIRECT_INVOICE: public.opps_invoices is missing';
  end if;
  if to_regclass('public.opps_quotes') is null or to_regclass('public.opps_quote_revisions') is null then
    raise exception 'QUOTE_DIRECT_INVOICE: quote schema is missing — apply the Q1 quote migration first';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'next_opps_invoice_number'
  ) then
    raise exception 'QUOTE_DIRECT_INVOICE: public.next_opps_invoice_number is missing — apply the invoice numbering migration first';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'opps_quotes_converted_order_id_fkey'
      and conrelid = 'public.opps_quotes'::regclass
  ) then
    raise exception 'QUOTE_DIRECT_INVOICE: opps_quotes_converted_order_id_fkey is missing — apply 20260916090000 first';
  end if;
  if to_regclass('public.opps_invoice_activity') is null then
    raise exception 'QUOTE_DIRECT_INVOICE: public.opps_invoice_activity is missing — apply the invoice activity migration first';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'link_invoice_to_order_relational'
  ) then
    raise exception 'QUOTE_DIRECT_INVOICE: public.link_invoice_to_order_relational is missing — apply 202608180003 first';
  end if;
end $$;

-- ── 1. opps_invoices.source_quote_id — new reverse pointer for the
--    direct-invoice path. Nullable (a normal, order-derived, or manual
--    invoice has no quote). ON DELETE SET NULL: same posture as
--    source_order_id / orders.source_quote_id — deleting a quote must
--    never cascade-delete a real financial record. ──────────────────
alter table public.opps_invoices
  add column if not exists source_quote_id uuid references public.opps_quotes(id) on delete set null;

comment on column public.opps_invoices.source_quote_id is
  'The accepted quote this invoice was created directly from, if any (Quote -> Invoice path). Set exactly once, by convert_quote_to_invoice() — never written by ordinary invoice creation/editing/order-derived creation.';

-- ── 2. one source quote -> at most one direct invoice (DB-enforced) ────
-- opps_quotes.converted_invoice_id (already FK'd since Q1) is the other
-- half of this guarantee — this partial unique index is the same
-- second, independent layer used for orders_source_quote_id_once.
create unique index if not exists opps_invoices_source_quote_id_once
  on public.opps_invoices (source_quote_id)
  where source_quote_id is not null;

-- ── 3. orders.source_invoice_id — provenance when an order is created
--    AFTER a direct quote invoice already exists (Quote -> Invoice ->
--    Order). Nullable; only convert_quote_to_order() ever sets it, only
--    when the quote it's converting already has converted_invoice_id. ──
alter table public.orders
  add column if not exists source_invoice_id uuid references public.opps_invoices(id) on delete set null;

comment on column public.orders.source_invoice_id is
  'The direct quote invoice that preceded this order, if the Quote -> Invoice -> Order path was used (converted_quote_to_order() propagates opps_quotes.converted_invoice_id here). Null for every other order, including plain Quote -> Order.';

-- No new unique index needed on source_invoice_id: orders_source_quote_id_once
-- (from 20260916090000) already guarantees at most one order per quote
-- regardless of which path created it, since both paths write the SAME
-- orders.source_quote_id column.

-- ── 4. convert_quote_to_invoice — the direct Quote -> Invoice entry
--    point ─────────────────────────────────────────────────────────────
create or replace function public.convert_quote_to_invoice(p_quote_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_quote            public.opps_quotes%rowtype;
  v_snapshot         jsonb;
  v_items            jsonb;
  v_item             jsonb;
  v_invoice_id       uuid;
  v_invoice_number   text;
  v_line_number      integer := 0;
begin
  if not (public.is_app_admin() or public.user_finance_level() in (1, 2)) then
    raise exception using errcode = '42501', message = 'QUOTE_INVOICE_FINANCE_PERMISSION_REQUIRED';
  end if;

  select * into v_quote from public.opps_quotes where id = p_quote_id for update;
  if v_quote.id is null then
    raise exception using errcode = 'P0001', message = 'QUOTE_NOT_FOUND';
  end if;
  if not public.can_access_tenant(v_quote.tenant_id) then
    raise exception using errcode = '42501', message = 'QUOTE_TENANT_ACCESS_DENIED';
  end if;

  -- ── idempotent: already has a direct invoice -> return the SAME
  --    invoice, not a second one. Same FOR UPDATE + check-then-act
  --    pattern as convert_quote_to_order(). ───────────────────────────
  if v_quote.converted_invoice_id is not null then
    select invoice_number into v_invoice_number from public.opps_invoices where id = v_quote.converted_invoice_id;
    return jsonb_build_object(
      'ok', true, 'replayed', true,
      'invoice_id', v_quote.converted_invoice_id, 'invoice_number', v_invoice_number,
      'quote_id', v_quote.id, 'quote_number', v_quote.quote_number
    );
  end if;

  -- An order already exists for this quote: the correct, already-working
  -- path for its invoice is Order -> Invoice (CreateInvoiceFromOrderButton),
  -- which derives shipping/etc. from the order, not the quote snapshot.
  -- Refuse rather than silently create a second, order-less invoice.
  if v_quote.converted_order_id is not null then
    raise exception using errcode = 'P0001', message = 'QUOTE_ORDER_ALREADY_EXISTS';
  end if;

  if v_quote.status <> 'accepted' then
    raise exception using errcode = 'P0001', message = 'QUOTE_NOT_CONVERTIBLE';
  end if;
  if v_quote.accepted_revision_id is null then
    raise exception using errcode = 'P0001', message = 'QUOTE_NO_ACCEPTED_SNAPSHOT';
  end if;

  select snapshot into v_snapshot
  from public.opps_quote_revisions
  where id = v_quote.accepted_revision_id and quote_id = v_quote.id;
  if v_snapshot is null then
    raise exception using errcode = 'P0001', message = 'QUOTE_ACCEPTED_SNAPSHOT_MISSING';
  end if;

  v_items := coalesce(v_snapshot->'items', '[]'::jsonb);
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    raise exception using errcode = 'P0001', message = 'QUOTE_SNAPSHOT_EMPTY_ITEMS';
  end if;

  v_invoice_number := public.next_opps_invoice_number(v_quote.tenant_id);

  -- Every commercial field below comes from the frozen snapshot's own
  -- top-level keys (subtotal/discount_total/shipping_charge/tax_total/
  -- total) — never from the live, editable opps_quotes row, and never a
  -- default. A quote with no shipping charge produces shipping_charge=0
  -- here, exactly preserved, never replaced by any invoice default.
  insert into public.opps_invoices (
    invoice_number, customer_id, customer_name, customer_email, customer_phone,
    customer_billing_address, invoice_date, due_date, payment_terms, currency_code,
    status, reference_number, subtotal, discount_total, shipping_charge, adjustment,
    tax_total, total, amount_paid, balance_due, notes, terms, internal_notes,
    source_quote_id, tenant_id, created_by, updated_by
  ) values (
    v_invoice_number, v_quote.customer_id, v_quote.customer_name, v_quote.customer_email, v_quote.customer_phone,
    coalesce(nullif(v_snapshot->>'customer_billing_address', ''), v_quote.customer_billing_address),
    current_date, null, v_quote.payment_terms, coalesce(nullif(v_snapshot->>'currency_code', ''), 'ZAR'),
    'draft', v_quote.quote_number,
    coalesce(nullif(v_snapshot->>'subtotal', '')::numeric, 0),
    coalesce(nullif(v_snapshot->>'discount_total', '')::numeric, 0),
    coalesce(nullif(v_snapshot->>'shipping_charge', '')::numeric, 0),
    0,
    coalesce(nullif(v_snapshot->>'tax_total', '')::numeric, 0),
    coalesce(nullif(v_snapshot->>'total', '')::numeric, 0),
    0,
    coalesce(nullif(v_snapshot->>'total', '')::numeric, 0),
    v_quote.notes, coalesce(nullif(v_snapshot->>'terms', ''), v_quote.terms),
    'Created directly from OPPS quote ' || v_quote.quote_number,
    v_quote.id, v_quote.tenant_id, auth.uid(), auth.uid()
  )
  returning id into v_invoice_id;

  for v_item in select * from jsonb_array_elements(v_items)
  loop
    v_line_number := v_line_number + 1;
    insert into public.opps_invoice_items (
      invoice_id, line_number, item_name, item_description, item_type,
      quantity, unit, rate, discount, tax_name, tax_percentage, account_name, item_total
    ) values (
      v_invoice_id, v_line_number,
      coalesce(nullif(v_item->>'item_name', ''), 'Item'),
      nullif(v_item->>'item_description', ''),
      'goods',
      coalesce(nullif(v_item->>'quantity', '')::numeric, 1),
      nullif(v_item->>'unit', ''),
      coalesce(nullif(v_item->>'rate', '')::numeric, 0),
      coalesce(nullif(v_item->>'discount', '')::numeric, 0),
      nullif(v_item->>'tax_name', ''),
      coalesce(nullif(v_item->>'tax_percentage', '')::numeric, 0),
      '',
      coalesce(nullif(v_item->>'item_total', '')::numeric, 0)
    );
  end loop;

  -- Parity with save_opps_invoice_with_items' own v_is_create branch,
  -- which always logs an 'invoice_created' activity row — so the new
  -- invoice's Activity tab is never empty just because it took this
  -- creation path instead of the editor.
  insert into public.opps_invoice_activity (
    invoice_id, activity_type, activity_label, to_status, metadata, tenant_id, created_by
  ) values (
    v_invoice_id, 'invoice_created', 'Invoice created', 'draft',
    jsonb_build_object('item_count', jsonb_array_length(v_items), 'source', 'quote', 'source_quote_id', v_quote.id, 'quote_number', v_quote.quote_number),
    v_quote.tenant_id, auth.uid()
  );

  -- status is deliberately NOT changed here — see header note. Only the
  -- new reverse pointer is set.
  update public.opps_quotes
  set converted_invoice_id = v_invoice_id,
      updated_at = now(),
      updated_by = auth.uid()
  where id = v_quote.id;

  insert into public.opps_quote_events (
    quote_id, tenant_id, revision_id, event_type, actor_kind, actor_user_id, metadata
  ) values (
    v_quote.id, v_quote.tenant_id, v_quote.accepted_revision_id, 'converted', 'staff', auth.uid(),
    jsonb_build_object('invoice_id', v_invoice_id, 'invoice_number', v_invoice_number, 'conversion_type', 'direct_invoice')
  );

  return jsonb_build_object(
    'ok', true, 'replayed', false,
    'invoice_id', v_invoice_id, 'invoice_number', v_invoice_number,
    'quote_id', v_quote.id, 'quote_number', v_quote.quote_number
  );
end;
$$;

revoke all on function public.convert_quote_to_invoice(uuid) from public, anon;
grant execute on function public.convert_quote_to_invoice(uuid) to authenticated;

comment on function public.convert_quote_to_invoice(uuid) is
  'Quote -> Invoice direct conversion (second Phase 1 path). Requires status=accepted and no existing converted_order_id (an order-bearing quote must use the existing Order -> Invoice path instead — QUOTE_ORDER_ALREADY_EXISTS). Idempotent (replays the same invoice, never a second one — also enforced by opps_invoices_source_quote_id_once). Reads subtotal/discount_total/shipping_charge/tax_total/total ONLY from the immutable accepted revision snapshot''s own top-level keys — never a default, never the live quote row. Uses the existing public.next_opps_invoice_number() allocator — no second numbering system. Creates exactly one opps_invoices row + its items + one opps_invoice_activity row (invoice_created, matching save_opps_invoice_with_items'' own parity) + one opps_quote_events row. Creates no payment rows; invoice starts draft/unpaid like any other. source_order_id is left null here (no order exists yet) — convert_quote_to_order() sets it later via the canonical link_invoice_to_order_relational() RPC if/when an order is created from the same quote.';

-- ── 5. convert_quote_to_order — redefined to propagate source_invoice_id
--    when a direct invoice already exists for this quote. Everything
--    else in this function is UNCHANGED from 20260916090000, with one
--    incidental correction: the original read
--    v_snapshot->'totals'->>'total' from a key that does not exist in
--    the snapshot shape (totals fields are top-level, not nested under
--    'totals' — confirmed against save_opps_quote_with_items' own
--    snapshot construction). That expression always evaluated to NULL
--    and silently fell through to v_quote.total, which happens to hold
--    the same value in every real case today (accepted quotes are
--    edit-locked, so opps_quotes.total cannot drift from the accepted
--    snapshot after acceptance) — so this was never user-visible, but
--    is corrected here to the real key (v_snapshot->>'total') while this
--    exact line is already being touched for the source_invoice_id
--    change, rather than left carrying a latent, no-longer-exercised
--    error forward. No other line changed. ─────────────────────────────
create or replace function public.convert_quote_to_order(p_quote_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_quote               public.opps_quotes%rowtype;
  v_snapshot            jsonb;
  v_items               jsonb;
  v_products            jsonb := '[]'::jsonb;
  v_order_id            uuid;
  v_order_number        text;
  v_item                jsonb;
  v_client_product      uuid;
  v_line                jsonb;
  v_invoice_link_status text := 'not_applicable';
begin
  if not (public.is_app_admin() or public.user_finance_level() in (1, 2)) then
    raise exception using errcode = '42501', message = 'QUOTE_ORDER_FINANCE_PERMISSION_REQUIRED';
  end if;

  select * into v_quote from public.opps_quotes where id = p_quote_id for update;
  if v_quote.id is null then
    raise exception using errcode = 'P0001', message = 'QUOTE_NOT_FOUND';
  end if;
  if not public.can_access_tenant(v_quote.tenant_id) then
    raise exception using errcode = '42501', message = 'QUOTE_TENANT_ACCESS_DENIED';
  end if;

  if v_quote.converted_order_id is not null then
    select order_number into v_order_number from public.orders where id = v_quote.converted_order_id;
    return jsonb_build_object(
      'ok', true, 'replayed', true,
      'order_id', v_quote.converted_order_id, 'order_number', v_order_number,
      'quote_id', v_quote.id, 'quote_number', v_quote.quote_number
    );
  end if;

  if v_quote.status <> 'accepted' then
    raise exception using errcode = 'P0001', message = 'QUOTE_NOT_CONVERTIBLE';
  end if;
  if v_quote.accepted_revision_id is null then
    raise exception using errcode = 'P0001', message = 'QUOTE_NO_ACCEPTED_SNAPSHOT';
  end if;

  select snapshot into v_snapshot
  from public.opps_quote_revisions
  where id = v_quote.accepted_revision_id and quote_id = v_quote.id;
  if v_snapshot is null then
    raise exception using errcode = 'P0001', message = 'QUOTE_ACCEPTED_SNAPSHOT_MISSING';
  end if;

  v_items := coalesce(v_snapshot->'items', '[]'::jsonb);
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    raise exception using errcode = 'P0001', message = 'QUOTE_SNAPSHOT_EMPTY_ITEMS';
  end if;

  for v_item in select * from jsonb_array_elements(v_items)
  loop
    v_client_product := null;
    select source_client_product_id into v_client_product
    from public.opps_quote_items
    where quote_id = v_quote.id
      and line_number = nullif(v_item->>'line_number', '')::int
    limit 1;

    v_line := jsonb_strip_nulls(jsonb_build_object(
      'line_id', gen_random_uuid()::text,
      'line_role', coalesce(nullif(v_item->>'role', ''), 'product'),
      'name', v_item->>'item_name',
      'notes', nullif(v_item->>'item_description', ''),
      'quantity', coalesce(nullif(v_item->>'quantity', '')::numeric, 1),
      'unit_price', coalesce(nullif(v_item->>'rate', '')::numeric, 0),
      'price', coalesce(nullif(v_item->>'rate', '')::numeric, 0),
      'discount', coalesce(nullif(v_item->>'discount', '')::numeric, 0),
      'line_total', coalesce(nullif(v_item->>'item_total', '')::numeric, 0),
      'image_url', nullif(v_item->>'image_url', ''),
      'client_product_id', v_client_product,
      'source', 'quote',
      'source_metadata', jsonb_build_object(
        'converted_from_quote_id', v_quote.id,
        'quote_line_number', nullif(v_item->>'line_number', '')::int,
        'tax_name', nullif(v_item->>'tax_name', ''),
        'tax_percentage', nullif(v_item->>'tax_percentage', '')::numeric
      )
    ));
    v_products := v_products || jsonb_build_array(v_line);
  end loop;

  v_order_number := 'ORD-Q-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

  insert into public.orders (
    client_name, client_email, client_phone, client_id, tenant_id,
    order_number, status, priority, source, products, total_amount,
    notes, source_quote_id, source_invoice_id, source_metadata
  ) values (
    v_quote.customer_name, v_quote.customer_email, v_quote.customer_phone, v_quote.customer_id, v_quote.tenant_id,
    v_order_number, 'confirmed', 'normal', 'opps', v_products,
    coalesce(nullif(v_snapshot->>'total', '')::numeric, v_quote.total),
    v_quote.notes, v_quote.id, v_quote.converted_invoice_id,
    jsonb_build_object(
      'converted_from_quote_id', v_quote.id,
      'quote_number', v_quote.quote_number,
      'quote_accepted_revision_id', v_quote.accepted_revision_id,
      'converted_at', now()
    )
  )
  returning id into v_order_id;

  -- ── Quote -> Invoice -> Order: make the pre-existing direct invoice a
  --    FULLY NORMAL, canonically-linked invoice of this order, using the
  --    SAME RPC a human would use from OrderLinkPanel — not a parallel
  --    UPDATE. This is what makes the invoice show up in the order's own
  --    Invoices tab (listInvoices({sourceOrderId})), be found by sibling-
  --    invoice detection, and show the order on the invoice's own
  --    OrderLinkPanel. Wrapped so a genuinely unexpected conflict here
  --    (the invoice got linked to a DIFFERENT order by someone else in
  --    the meantime, or was voided) reports a safe status rather than
  --    reassigning it — and, critically, does NOT abort the order the
  --    user explicitly asked to create. Any OTHER error is re-raised,
  --    not swallowed. ────────────────────────────────────────────────
  if v_quote.converted_invoice_id is not null then
    begin
      perform public.link_invoice_to_order_relational(v_quote.converted_invoice_id, v_order_id);
      v_invoice_link_status := 'linked';
    exception
      when others then
        if sqlerrm like '%INVOICE_ALREADY_LINKED%' then
          v_invoice_link_status := 'skipped_already_linked_elsewhere';
        elsif sqlerrm like '%INVOICE_VOID%' then
          v_invoice_link_status := 'skipped_void';
        else
          raise;
        end if;
    end;
  end if;

  update public.opps_quotes
  set status = 'converted',
      converted_order_id = v_order_id,
      updated_at = now(),
      updated_by = auth.uid()
  where id = v_quote.id;

  insert into public.opps_quote_events (
    quote_id, tenant_id, revision_id, event_type, actor_kind, actor_user_id, metadata
  ) values (
    v_quote.id, v_quote.tenant_id, v_quote.accepted_revision_id, 'converted', 'staff', auth.uid(),
    jsonb_build_object('order_id', v_order_id, 'order_number', v_order_number, 'invoice_link_status', v_invoice_link_status)
  );

  return jsonb_build_object(
    'ok', true, 'replayed', false,
    'order_id', v_order_id, 'order_number', v_order_number,
    'quote_id', v_quote.id, 'quote_number', v_quote.quote_number,
    'invoice_link_status', v_invoice_link_status
  );
end;
$$;

revoke all on function public.convert_quote_to_order(uuid) from public, anon;
grant execute on function public.convert_quote_to_order(uuid) to authenticated;

comment on function public.convert_quote_to_order(uuid) is
  'The Quote -> Order conversion entry point (Q5), supporting BOTH Quote -> Order -> Invoice and Quote -> Invoice -> Order. Requires status=accepted; idempotent (a second call for an already-converted quote returns the same order, never creates a second one — also enforced independently by the orders_source_quote_id_once unique index). Reads commercial line values ONLY from the immutable opps_quote_revisions.snapshot at accepted_revision_id, never from the live, editable opps_quote_items. If the quote already has a direct invoice (converted_invoice_id, set by convert_quote_to_invoice): (1) the new order''s source_invoice_id is set to it (provenance), and (2) the invoice itself is linked to the new order via the EXISTING, canonical public.link_invoice_to_order_relational() RPC, setting opps_invoices.source_order_id — the field listInvoices({sourceOrderId})/InvoicesTab/OrderLinkPanel/sibling-detection all actually key off — so the invoice becomes a normal, fully-linked invoice of the order, not a second-class one. That link is best-effort: if the invoice was already linked to a DIFFERENT order or voided in the meantime, the order is still created (invoice_link_status in the return/event metadata reports the outcome; the invoice is never silently reassigned). Optionally enriches each product line with source_client_product_id from the live opps_quote_items (matched by line_number) for catalogue traceability only. Creates exactly one orders row, sets opps_quotes.status=converted + converted_order_id, and logs one opps_quote_events row (event_type=converted). Does not touch payments or the order tenant/client validation trigger (assert_order_tenant_links) beyond what a normal order insert already goes through.';

commit;
