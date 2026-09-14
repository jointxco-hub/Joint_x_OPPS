-- ════════════════════════════════════════════════════════════════════
--  QUOTE → ORDER → INVOICE — PHASE 1 CONVERSION
-- ════════════════════════════════════════════════════════════════════
--
-- Closes the gap the Q1 migration reserved as "Q5": opps_quotes.
-- converted_order_id has existed since Q1 as a bare uuid ("-> public.
-- orders.id (Q5)") with no FK and nothing ever writing it. This migration
-- adds the FK, the reverse pointer on orders, and the ONE conversion RPC.
--
-- Scope discipline (per the accompanying audit):
--   * Does NOT touch the quote lifecycle (opps_quotes/opps_quote_items/
--     opps_quote_revisions/opps_quote_events/save_opps_quote_with_items/
--     the public quote RPCs) beyond adding the converted_order_id FK and
--     one new event_type value.
--   * Does NOT touch the order lifecycle, order creation paths, or the
--     orders table beyond one new nullable column + one partial unique
--     index. No new order_number allocator is introduced — the new RPC
--     mirrors the existing client-side ORD-<base36 timestamp> shape
--     (NewOrderDrawer.jsx / OrderForm.jsx) rather than inventing a
--     server-side sequence for a column that has never had one.
--   * Does NOT touch the invoice/payment system at all. Order → Invoice
--     already works end-to-end via the EXISTING createInvoice() ->
--     save_opps_invoice_with_items() path (CreateInvoiceFromOrderButton.
--     jsx already checks for and surfaces an existing sibling invoice
--     before creating another) — nothing here needs to change that, and
--     nothing here creates a competing "quote invoice" pathway.
--
-- Authoritative accepted-quote source (Phase 0A): opps_quote_revisions.
-- snapshot at opps_quotes.accepted_revision_id — already immutable
-- (append-only table, BEFORE UPDATE OR DELETE trigger, no update/delete
-- grants) and already frozen at accept_public_quote time (it is set to
-- published_revision_id, never current_revision_id). This migration adds
-- NO new snapshot table because one already exists and already does the
-- job. The RPC reads commercial/financial line values (item_name,
-- quantity, rate, discount, tax, item_total) from THIS snapshot only —
-- never from the live, editable opps_quote_items — so a quote can never
-- be edited into changing an order that has already been created from
-- it. It optionally enriches with source_client_product_id from the
-- live opps_quote_items (matched by line_number) purely for catalogue
-- traceability; this is structural, not financial, and the conversion
-- never fails or changes amounts if a line can't be matched — accepted
-- quotes are edit-locked anyway (save_opps_quote_with_items refuses
-- QUOTE_NOT_EDITABLE for status accepted/converted/declined), so in
-- practice opps_quote_items for an accepted quote cannot change either.
--
-- STAGING-FIRST. NOT APPLIED. NO PRODUCTION WRITE. NO DEPLOY. NO PUSH.
-- ════════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
begin
  if to_regclass('public.orders') is null then
    raise exception 'QUOTE_ORDER_CONVERSION: public.orders is missing';
  end if;
  if to_regclass('public.opps_quotes') is null or to_regclass('public.opps_quote_revisions') is null then
    raise exception 'QUOTE_ORDER_CONVERSION: quote schema is missing — apply the Q1 quote migration first';
  end if;
end $$;

-- ── 1. orders.source_quote_id — the reverse pointer that never existed ──
-- Nullable (an order can be created with no quote, exactly as today).
-- ON DELETE SET NULL: deleting a quote must never cascade-delete a real
-- operational order — the order stands on its own once created, same
-- posture as opps_invoices.source_order_id.
alter table public.orders
  add column if not exists source_quote_id uuid references public.opps_quotes(id) on delete set null;

comment on column public.orders.source_quote_id is
  'The accepted quote this order was created from, if any (Q5 conversion). Set exactly once, by convert_quote_to_order() — never written by ordinary order creation/editing.';

-- ── 2. one source quote -> at most one converted order (DB-enforced) ──
-- Phase 2A: idempotency/duplicate-protection at the database level, not
-- only a disabled UI button. Quote splitting is explicitly out of scope
-- for Phase 1, so this is a hard constraint, not an advisory one.
create unique index if not exists orders_source_quote_id_once
  on public.orders (source_quote_id)
  where source_quote_id is not null;

-- ── 3. opps_quotes.converted_order_id gets the FK the Q1 comment
--    deferred to "Q5" ──────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'opps_quotes_converted_order_id_fkey'
      and conrelid = 'public.opps_quotes'::regclass
  ) then
    alter table public.opps_quotes
      add constraint opps_quotes_converted_order_id_fkey
      foreign key (converted_order_id) references public.orders(id) on delete set null;
  end if;
end $$;

-- ── 4. confirm the quote-event type check already permits 'converted'
--    (it has existed in the Q1 CHECK list and as a status value/UI label
--    since Q1; nothing has ever inserted an event with it until now, so
--    this is the first real exercise of it) ─────────────────────────────
do $$
declare
  v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
  from pg_constraint
  where conname = 'opps_quote_events_event_type_check'
    and conrelid = 'public.opps_quote_events'::regclass;

  if v_def is not null and v_def not like '%converted%' then
    raise exception 'QUOTE_ORDER_CONVERSION: opps_quote_events_event_type_check no longer permits ''converted'' — widen it before applying this migration';
  end if;
end $$;

-- ── 5. convert_quote_to_order — the ONE conversion entry point ─────────
-- Atomic: quote row locked FOR UPDATE for the whole transaction, so two
-- concurrent calls (double-click, retry, two tabs) serialize through the
-- lock; the second one sees converted_order_id already set and returns
-- the FIRST call's order rather than creating a second (idempotent, not
-- an error). The partial unique index above is the second, independent
-- layer of the same guarantee.
create or replace function public.convert_quote_to_order(p_quote_id uuid)
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
  v_products         jsonb := '[]'::jsonb;
  v_order_id         uuid;
  v_order_number     text;
  v_item             jsonb;
  v_live_item        record;
  v_client_product   uuid;
  v_line              jsonb;
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

  -- ── idempotent: already converted -> return the SAME order, not a
  --    second one. Covers double-click, browser retry, two concurrent
  --    requests (the FOR UPDATE lock above makes the second caller wait,
  --    then see this branch once the first commits). ───────────────────
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
    -- Should be unreachable — accept_public_quote always sets this in the
    -- same statement that sets status='accepted' — but a conversion must
    -- never proceed without a genuine frozen snapshot to read, so this is
    -- a hard stop, not a fallback to the live (editable) quote_items.
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

  -- ── map the FROZEN snapshot's commercial lines onto orders.products
  --    (jsonb array, the order system's own item representation — see
  --    orderToInvoiceItems.js for the established reverse mapping this
  --    mirrors). Every money/quantity/description field comes from
  --    v_snapshot ONLY. source_client_product_id is the one field that
  --    cannot survive in the snapshot (the customer-safe projection
  --    strips it) — it is looked up, best-effort, from the LIVE
  --    opps_quote_items by line_number purely for catalogue
  --    traceability; a missing match never blocks conversion or changes
  --    a single amount. ────────────────────────────────────────────────
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

  -- Mirrors the existing client-side shape (NewOrderDrawer.jsx /
  -- OrderForm.jsx: `ORD-${Date.now().toString(36).toUpperCase()}`) —
  -- there is no server-side order_number sequence to reuse, so this
  -- server-side conversion generates an equally-unique, equally
  -- unformatted-sequence value rather than inventing one. 'ORD-Q-'
  -- prefix keeps it visually distinguishable as quote-originated in
  -- lists, without being a second numbering SYSTEM (it's still just a
  -- unique label, exactly like the client-generated ones).
  v_order_number := 'ORD-Q-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

  insert into public.orders (
    client_name, client_email, client_phone, client_id, tenant_id,
    order_number, status, priority, source, products, total_amount,
    notes, source_quote_id, source_metadata
  ) values (
    v_quote.customer_name, v_quote.customer_email, v_quote.customer_phone, v_quote.customer_id, v_quote.tenant_id,
    v_order_number, 'confirmed', 'normal', 'opps', v_products,
    coalesce(nullif(v_snapshot->'totals'->>'total', '')::numeric, v_quote.total),
    v_quote.notes, v_quote.id,
    jsonb_build_object(
      'converted_from_quote_id', v_quote.id,
      'quote_number', v_quote.quote_number,
      'quote_accepted_revision_id', v_quote.accepted_revision_id,
      'converted_at', now()
    )
  )
  returning id into v_order_id;

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
    jsonb_build_object('order_id', v_order_id, 'order_number', v_order_number)
  );

  return jsonb_build_object(
    'ok', true, 'replayed', false,
    'order_id', v_order_id, 'order_number', v_order_number,
    'quote_id', v_quote.id, 'quote_number', v_quote.quote_number
  );
end;
$$;

revoke all on function public.convert_quote_to_order(uuid) from public, anon;
grant execute on function public.convert_quote_to_order(uuid) to authenticated;

comment on function public.convert_quote_to_order(uuid) is
  'The ONE quote -> order conversion entry point (Q5). Requires status=accepted; idempotent (a second call for an already-converted quote returns the same order, never creates a second one — also enforced independently by the orders_source_quote_id_once unique index). Reads commercial line values (name/qty/rate/discount/total) ONLY from the immutable opps_quote_revisions.snapshot at accepted_revision_id, never from the live, editable opps_quote_items — a quote edited after acceptance cannot be edited at all (QUOTE_NOT_EDITABLE), but even if that ever changed, this function would still be unaffected. Optionally enriches each line with source_client_product_id from the live opps_quote_items (matched by line_number) for catalogue traceability only — never required, never blocks, never changes an amount. Creates exactly one orders row, sets opps_quotes.status=converted + converted_order_id, and logs one opps_quote_events row (event_type=converted). Does not touch invoices, payments, or the order tenant/client validation trigger (assert_order_tenant_links) beyond what a normal order insert already goes through.';

commit;
