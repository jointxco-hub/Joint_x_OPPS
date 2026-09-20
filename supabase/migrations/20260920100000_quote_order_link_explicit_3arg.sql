-- ════════════════════════════════════════════════════════════════════
--  convert_quote_to_order() — call the canonical 3-arg linker explicitly
-- ════════════════════════════════════════════════════════════════════
--
-- Forward-only follow-up to 20260920090000_invoice_first_order_linking.sql,
-- which is now the canonical definition of
-- public.link_invoice_to_order_relational(uuid, uuid, uuid) (it dropped
-- the old 2-arg overload outright - there is exactly one signature of
-- this function from that migration onward, never a parallel 2-arg one
-- reintroduced here or anywhere else).
--
-- ── Why this migration exists ───────────────────────────────────────
-- public.convert_quote_to_order(uuid) - last defined in
-- 20260918110000_quote_order_client_mismatch_fix.sql, NOT edited in
-- place, kept as historical context only - calls the linker with two
-- positional arguments: perform public.link_invoice_to_order_relational
-- (v_quote.converted_invoice_id, v_order_id). Postgres already resolves
-- that 2-arg call against the current 3-arg function via its
-- p_attach_client_id default (null), so behavior has been unchanged
-- since 20260920090000 shipped - this migration changes nothing
-- functionally. It exists purely so this call site's SOURCE TEXT
-- explicitly names the current canonical signature (three arguments,
-- attach left null - i.e. calling it "normally", no attach/override),
-- rather than reading, in the migration history, like a stale 2-arg
-- call that happens to still work by accident of a default parameter
-- defined three migrations away.
--
-- Every other statement in convert_quote_to_order() below is
-- byte-identical to 20260918110000's version. This migration touches
-- ONLY that one function, and does NOT create, replace, or reference
-- any 2-arg overload of link_invoice_to_order_relational - the 3-arg
-- version from 20260920090000 remains the one and only signature.
--
-- STAGING-FIRST. NOT APPLIED. NO PRODUCTION WRITE. NO DEPLOY. NO PUSH.
-- ════════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'link_invoice_to_order_relational'
      and p.pronargs = 3
  ) then
    raise exception 'QUOTE_ORDER_LINK_EXPLICIT_3ARG: public.link_invoice_to_order_relational(uuid, uuid, uuid) is missing — apply 20260920090000 first';
  end if;
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'link_invoice_to_order_relational'
      and p.pronargs = 2
  ) then
    raise exception 'QUOTE_ORDER_LINK_EXPLICIT_3ARG: a 2-arg public.link_invoice_to_order_relational(uuid, uuid) overload still exists — this migration must never run alongside a parallel 2-arg linker';
  end if;
end $$;

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
  --    UPDATE. link_invoice_to_order_relational() itself recognizes the
  --    clientless-same-quote case as valid identity proof, so this
  --    succeeds even when the quote has no linked client. The third
  --    argument is explicit and null - this call site never attaches a
  --    client (that is an invoice-first, staff-confirmed action only,
  --    via LinkExistingOrderDialog); it calls the canonical linker the
  --    same "normal" way it always has. Still wrapped: an unexpected
  --    conflict (linked to a DIFFERENT order by someone else in the
  --    meantime, voided, or — defense-in-depth, not expected to be
  --    reachable here — a genuine client mismatch) reports a safe
  --    status rather than aborting the order the user explicitly asked
  --    to create. Any OTHER error is re-raised. ────────────────────────
  if v_quote.converted_invoice_id is not null then
    begin
      perform public.link_invoice_to_order_relational(v_quote.converted_invoice_id, v_order_id, null);
      v_invoice_link_status := 'linked';
    exception
      when others then
        if sqlerrm like '%INVOICE_ALREADY_LINKED%' then
          v_invoice_link_status := 'skipped_already_linked_elsewhere';
        elsif sqlerrm like '%INVOICE_VOID%' then
          v_invoice_link_status := 'skipped_void';
        elsif sqlerrm like '%CLIENT_MISMATCH%' then
          v_invoice_link_status := 'skipped_client_mismatch';
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
  'The Quote -> Order conversion entry point (Q5), supporting BOTH Quote -> Order -> Invoice and Quote -> Invoice -> Order. Requires status=accepted; idempotent (a second call for an already-converted quote returns the same order, never creates a second one — also enforced independently by the orders_source_quote_id_once unique index). Reads commercial line values ONLY from the immutable opps_quote_revisions.snapshot at accepted_revision_id, never from the live, editable opps_quote_items. If the quote already has a direct invoice (converted_invoice_id, set by convert_quote_to_invoice): (1) the new order''s source_invoice_id is set to it (provenance), and (2) the invoice is linked to the new order via the canonical public.link_invoice_to_order_relational(uuid, uuid, uuid) RPC (third argument explicit and null - never attaches a client from this call site), setting opps_invoices.source_order_id — including when the quote has no linked client, via that RPC''s clientless-same-quote identity proof. That link is best-effort and never blocks order creation (invoice_link_status reports the outcome); an invoice already linked to a genuinely different order, voided, or a genuine cross-client mismatch is skipped, never force-linked or reassigned. Creates exactly one orders row, sets opps_quotes.status=converted + converted_order_id, and logs one opps_quote_events row (event_type=converted). Does not touch payments or the order tenant/client validation trigger (assert_order_tenant_links) beyond what a normal order insert already goes through.';

commit;
