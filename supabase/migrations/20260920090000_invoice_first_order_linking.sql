-- ════════════════════════════════════════════════════════════════════
--  INVOICE-FIRST -> ORDER LINKING — explicit, NULL-only client attach
-- ════════════════════════════════════════════════════════════════════
--
-- Forward-only follow-up to 202608180003_invoice_relational_link_and_reopen.sql
-- and 20260918110000_quote_order_client_mismatch_fix.sql. Neither is
-- edited in place; this is the third extension of the SAME canonical
-- function, still the one and only invoice<->order relational linker.
--
-- ── What this adds ──────────────────────────────────────────────────
-- The invoice-first workflow (Create Order / Link Existing Order on the
-- invoice detail drawer) needs to link an invoice to an order when one
-- or both sides have NO client record at all yet — a normal, supported
-- state (see 20260918110000's header). Until now the only way past
-- CLIENT_MISMATCH in that situation was the narrow same-source-quote
-- case. This adds a second, deliberately narrow escape hatch:
--
--   p_attach_client_id — a client the STAFF has explicitly selected or
--   just created in the UI. When supplied, this function fills ONLY
--   whichever side(s) currently have a NULL client reference
--   (opps_invoices.customer_id / orders.client_id) with that client id,
--   then falls through to the exact same identity check as before.
--
-- This is intentionally NOT a general override:
--   * Two DIFFERENT non-null client ids on either side is still an
--     unconditional refusal (ATTACH_CLIENT_INVOICE_CONFLICT /
--     ATTACH_CLIENT_ORDER_CONFLICT) — attaching never reassigns or
--     bypasses an existing client link, only fills an absence. A real
--     mismatch between two already-identified clients must be resolved
--     by staff merging/correcting client identity first, not by this
--     function.
--   * There is no server-side "trust the email/phone match" path at
--     all. Any contact-detail comparison happens client-side, for
--     suggesting a client to attach/create — it is never sent to or
--     trusted by this function as identity proof. The only thing this
--     function ever trusts is a real, tenant-verified clients.id the
--     caller explicitly passed.
--   * Once the attach step (if any) resolves both sides to the SAME
--     non-null client_id, everything downstream — void check, already-
--     linked check, the update itself, activity logging — is byte-
--     identical to the existing function. This still writes
--     source_order_id ONLY; it never touches items, totals, or any
--     other financial field on the invoice.
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
    raise exception 'INVOICE_FIRST_ORDER_LINKING: public.link_invoice_to_order_relational is missing — apply 202608180003 and 20260918110000 first';
  end if;
end $$;

-- Drop the old 2-arg signature explicitly first: Postgres treats a
-- function with a new trailing DEFAULT parameter as a distinct overload
-- unless the exact old signature is removed, which would leave two
-- link_invoice_to_order_relational(uuid, uuid) functions resolvable and
-- break the "grant/revoke by exact signature" calls below.
drop function if exists public.link_invoice_to_order_relational(uuid, uuid);

create or replace function public.link_invoice_to_order_relational(
  p_invoice_id uuid,
  p_order_id uuid,
  p_attach_client_id uuid default null
)
returns public.opps_invoices
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_invoice public.opps_invoices%rowtype;
  v_order public.orders%rowtype;
  v_attach_client public.clients%rowtype;
  v_link_mode text := 'relational_only';
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

  -- ── Explicit, NULL-only client attach (new) ──────────────────────
  -- Only ever FILLS an absent client_id/customer_id. Never overwrites
  -- or reassigns one that is already set to something else - that is a
  -- conflict, not something this function resolves.
  if p_attach_client_id is not null then
    select * into v_attach_client from public.clients where id = p_attach_client_id;
    if v_attach_client.id is null then
      raise exception using errcode = 'P0001', message = 'ATTACH_CLIENT_NOT_FOUND';
    end if;
    if not public.can_access_tenant(v_attach_client.tenant_id)
       or v_attach_client.tenant_id is distinct from v_invoice.tenant_id then
      raise exception using errcode = '42501', message = 'ATTACH_CLIENT_TENANT_MISMATCH';
    end if;

    if v_invoice.customer_id is not null and v_invoice.customer_id is distinct from p_attach_client_id then
      raise exception using errcode = 'P0001', message = 'ATTACH_CLIENT_INVOICE_CONFLICT';
    end if;
    if v_order.client_id is not null and v_order.client_id is distinct from p_attach_client_id then
      raise exception using errcode = 'P0001', message = 'ATTACH_CLIENT_ORDER_CONFLICT';
    end if;

    if v_invoice.customer_id is null then
      update public.opps_invoices
      set customer_id = p_attach_client_id
      where id = p_invoice_id
      returning * into v_invoice;
    end if;

    if v_order.client_id is null then
      update public.orders
      set client_id = p_attach_client_id
      where id = p_order_id
      returning * into v_order;
    end if;

    v_link_mode := 'attached_client_and_relational';
  end if;

  -- Identity proof, EITHER of (unchanged from 20260918110000, now
  -- evaluated AFTER the attach step above, so a successful attach
  -- naturally satisfies branch (a) below):
  --   (a) both sides have the SAME non-null client; OR
  --   (b) both sides have NO client link at all, but both trace back to
  --       the EXACT SAME non-null source_quote_id.
  -- Every other combination - including two different non-null client
  -- ids, which p_attach_client_id can never change - still refuses with
  -- CLIENT_MISMATCH. There is no override for that case; staff must
  -- resolve/merge client identity first.
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
    jsonb_build_object(
      'order_id', p_order_id, 'order_number', v_order.order_number, 'link_mode', v_link_mode,
      'attached_client_id', p_attach_client_id
    ),
    auth.uid()
  );

  return v_invoice;
end;
$function$;

revoke all on function public.link_invoice_to_order_relational(uuid, uuid, uuid) from public, anon;
grant execute on function public.link_invoice_to_order_relational(uuid, uuid, uuid) to authenticated;

comment on function public.link_invoice_to_order_relational(uuid, uuid, uuid) is
  'Canonical relational invoice<->order link (writes opps_invoices.source_order_id only, plus optionally filling a NULL customer_id/client_id via p_attach_client_id). Tenant-matched, then client-identity-matched by EITHER (a) both sides share the same non-null client_id (after any attach step), or (b) both sides have no client link at all but share the same non-null source_quote_id — CLIENT_MISMATCH otherwise, no override path for two different non-null client ids. p_attach_client_id only ever FILLS a NULL customer_id/client_id with a tenant-verified, caller-selected client id; it refuses (ATTACH_CLIENT_INVOICE_CONFLICT/ATTACH_CLIENT_ORDER_CONFLICT) if either side already points to a different client — it never reassigns one. Void invoices refused (INVOICE_VOID). Re-linking to the same order is a no-op; linking to a DIFFERENT order while already linked is refused, never silently reassigned (INVOICE_ALREADY_LINKED). Logs one opps_invoice_activity row per successful link, with link_mode noting whether an attach happened.';

commit;
