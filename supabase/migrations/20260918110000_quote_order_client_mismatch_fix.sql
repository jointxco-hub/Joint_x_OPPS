-- ════════════════════════════════════════════════════════════════════
--  QUOTE -> INVOICE -> ORDER — clientless same-quote linking
-- ════════════════════════════════════════════════════════════════════
--
-- Forward-only follow-up to 20260918100000_quote_direct_invoice_conversion.sql
-- (already applied/reconciled on staging) AND to
-- 202608180003_invoice_relational_link_and_reopen.sql (applied long
-- before this whole engagement). Neither is edited in place.
--
-- ── Why the earlier "safe-skip" draft of this file was insufficient ───
-- A prior draft of this migration (never applied) added CLIENT_MISMATCH
-- as a third "skip the link, still create the order" branch inside
-- convert_quote_to_order(). That stopped Create Order from failing, but
-- left opps_invoices.source_order_id permanently null — the pre-existing
-- direct invoice would never become a normal linked invoice of the
-- order: absent from the order's own Invoices tab
-- (listInvoices({sourceOrderId})), invisible to sibling-invoice
-- detection, showing "Not linked to an order" on its own OrderLinkPanel.
-- That breaks the product requirement that Quote -> Invoice -> Order
-- ends in the SAME cross-linked state as Quote -> Order -> Invoice.
--
-- ── Root cause (unchanged from that earlier analysis) ──────────────────
-- opps_quotes.customer_id is a nullable FK; QuoteEditor.jsx's "Client"
-- picker is optional/clearable, separate from the required "Customer
-- name" field — a quote with no linked client record is a normal,
-- supported OPPS quoting state. Both convert_quote_to_invoice() and
-- convert_quote_to_order() copy customer_id/client_id from the SAME
-- v_quote.customer_id, so when it's null, it's null on BOTH the
-- invoice and the order — not actually "mismatched" in value, just both
-- absent. link_invoice_to_order_relational()'s existing client check
-- treats any null as a hard refusal, with no path to prove two null-
-- client records legitimately belong together.
--
-- ── Fix: extend the ONE canonical linker, not a parallel one ───────────
-- Per instruction (Option A over Option B): link_invoice_to_order_relational()
-- itself now accepts a second, narrowly-scoped form of identity proof
-- alongside "same non-null client_id": both sides have NO client link at
-- all, AND both trace back to the exact same non-null source_quote_id
-- (already tenant-matched by the existing check above it). This is
-- reused by manual OrderLinkPanel linking too, not just quote
-- conversion — there is still exactly one linking implementation, no
-- duplicated logic, and the tenant/void/already-linked/activity-logging
-- behavior is completely unchanged.
--
-- Every OTHER combination still rejects, unchanged:
--   * two different non-null client_ids -> still CLIENT_MISMATCH
--   * one null, one non-null -> still CLIENT_MISMATCH (first branch
--     requires invoice.customer_id is not null; second branch requires
--     BOTH null)
--   * both null but DIFFERENT source_quote_id (or either side's
--     source_quote_id is null) -> still CLIENT_MISMATCH
-- The shared, non-null quote identity is the only new form of proof
-- accepted, and only when there is truly no client identity to compare
-- at all. Normal client-identity matching for every other case is
-- completely untouched.
--
-- convert_quote_to_order() also gets CLIENT_MISMATCH added to its
-- existing safe-skip branches (alongside INVOICE_ALREADY_LINKED /
-- INVOICE_VOID) as defense-in-depth: after the fix above, the Quote ->
-- Invoice -> Order call site can no longer actually TRIGGER
-- CLIENT_MISMATCH (its invoice and order always share source_quote_id
-- by construction — convert_quote_to_invoice() and convert_quote_to_order()
-- both stamp it from the same quote), but if it ever did (e.g. a future
-- code path, or manual data surgery), the order the user asked to create
-- must still not be rolled back over it.
--
-- STAGING-FIRST. NOT APPLIED. NO PRODUCTION WRITE. NO DEPLOY. NO PUSH.
-- ════════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'link_invoice_to_order_relational'
  ) then
    raise exception 'QUOTE_ORDER_CLIENT_MISMATCH_FIX: public.link_invoice_to_order_relational is missing — apply 202608180003 first';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'opps_invoices' and column_name = 'source_quote_id'
  ) then
    raise exception 'QUOTE_ORDER_CLIENT_MISMATCH_FIX: opps_invoices.source_quote_id is missing — apply 20260918100000 first';
  end if;
end $$;

-- ── 1. link_invoice_to_order_relational — the ONE canonical linker,
--    client check extended (everything else byte-identical to
--    202608180003) ───────────────────────────────────────────────────
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

  -- Identity proof, EITHER of:
  --   (a) both sides have the SAME non-null client — the original,
  --       unweakened check; OR
  --   (b) both sides have NO client link at all, but both trace back to
  --       the EXACT SAME non-null source_quote_id — the shared quote
  --       identity substitutes for a missing client identity. Any other
  --       combination (different clients, one null one not, both null
  --       with no/different quote provenance) falls through to the same
  --       CLIENT_MISMATCH refusal as before — no override path, still.
  if not (
    (v_invoice.customer_id is not null and v_invoice.customer_id is not distinct from v_order.client_id)
    or (
      v_invoice.customer_id is null and v_order.client_id is null
      and v_invoice.source_quote_id is not null
      and v_order.source_quote_id is not null
      and v_invoice.source_quote_id = v_order.source_quote_id
    )
  ) then
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

comment on function public.link_invoice_to_order_relational(uuid, uuid) is
  'Canonical relational invoice<->order link (writes opps_invoices.source_order_id only). Tenant-matched, then client-identity-matched by EITHER (a) both sides share the same non-null client_id, or (b) both sides have no client link at all but share the same non-null source_quote_id (proof the invoice and order both trace back to one quote conversion) — CLIENT_MISMATCH otherwise, no override path. Void invoices refused (INVOICE_VOID). Re-linking to the same order is a no-op; linking to a DIFFERENT order while already linked is refused, never silently reassigned (INVOICE_ALREADY_LINKED). Logs one opps_invoice_activity row per successful link.';

-- ── 2. convert_quote_to_order — CLIENT_MISMATCH added to the existing
--    safe-skip branches as defense-in-depth. After the fix above this
--    call site cannot actually trigger it (its invoice and order always
--    share source_quote_id by construction), but a real order must never
--    be rolled back over a linking-step problem regardless. Everything
--    else is byte-identical to 20260918100000. ─────────────────────────
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
  --    UPDATE. As of this migration, link_invoice_to_order_relational
  --    itself recognizes the clientless-same-quote case as valid identity
  --    proof, so this succeeds even when the quote has no linked client.
  --    Still wrapped: an unexpected conflict (linked to a DIFFERENT order
  --    by someone else in the meantime, voided, or — defense-in-depth,
  --    not expected to be reachable here — a genuine client mismatch)
  --    reports a safe status rather than aborting the order the user
  --    explicitly asked to create. Any OTHER error is re-raised. ────────
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
  'The Quote -> Order conversion entry point (Q5), supporting BOTH Quote -> Order -> Invoice and Quote -> Invoice -> Order. Requires status=accepted; idempotent (a second call for an already-converted quote returns the same order, never creates a second one — also enforced independently by the orders_source_quote_id_once unique index). Reads commercial line values ONLY from the immutable opps_quote_revisions.snapshot at accepted_revision_id, never from the live, editable opps_quote_items. If the quote already has a direct invoice (converted_invoice_id, set by convert_quote_to_invoice): (1) the new order''s source_invoice_id is set to it (provenance), and (2) the invoice is linked to the new order via the canonical public.link_invoice_to_order_relational() RPC, setting opps_invoices.source_order_id — including when the quote has no linked client, via that RPC''s clientless-same-quote identity proof. That link is best-effort and never blocks order creation (invoice_link_status reports the outcome); an invoice already linked to a genuinely different order, voided, or a genuine cross-client mismatch is skipped, never force-linked or reassigned. Creates exactly one orders row, sets opps_quotes.status=converted + converted_order_id, and logs one opps_quote_events row (event_type=converted). Does not touch payments or the order tenant/client validation trigger (assert_order_tenant_links) beyond what a normal order insert already goes through.';

commit;
