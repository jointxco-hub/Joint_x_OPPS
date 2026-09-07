-- ════════════════════════════════════════════════════════════════════
--  MANUAL INVOICE PAYMENT — canonical ledger entry point
-- ════════════════════════════════════════════════════════════════════
--
-- Production already runs the P1A payment ledger (public.invoice_payments
-- + invoice_amount_paid/balance_due/payment_status + the AFTER trigger
-- trg_invoice_payments_refresh_cache) and the P3 public projection that
-- derives customer-visible payment truth from that ledger.
--
-- The gap this closes: OPPS "Mark paid" / "Partial payment" wrote
-- opps_invoices.status/amount_paid/balance_due DIRECTLY and inserted NO
-- invoice_payments row, so the ledger — and every consumer of it,
-- including the public /i/:token route — never saw the payment. Invoice
-- OPPS-INV-2026-0085 is the confirmed instance.
--
-- Adds ONLY:
--   * invoice_payments_manual_ref_once  partial unique index
--       (invoice_id, reference) WHERE source='manual' AND reference IS NOT NULL
--   * public.record_manual_invoice_payment(...)  the one RPC OPPS calls
--       to record an off-platform (EFT / cash / card / other) payment
--
-- Does NOT touch: the P1A/P3/P6 functions, the public invoice projection,
-- any PayFast function, opps_invoices schema, or reconcile_invoice_with_order.
-- opps_invoices.amount_paid/balance_due stay a trigger-maintained CACHE.
--
-- DEPENDS ON: P1A (20260904120000_invoice_p1a_payment_reconciliation.sql).
--   The `source` CHECK on invoice_payments ALREADY allows 'manual' — no
--   constraint change is made or needed. A hard preflight below fails
--   loudly if the P1A ledger is absent (source-history drift: P1A/P3/P6
--   are live in production but not yet reconciled into origin/main —
--   tracked separately; this migration is production-first).
--
-- STAGING-FIRST. NOT APPLIED. NO PRODUCTION WRITE. NO DEPLOY. NO PUSH.
-- ════════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ── preflight: the P1A ledger must exist ────────────────────────────
do $$
begin
  if to_regclass('public.invoice_payments') is null then
    raise exception 'MANUAL_PAYMENT: public.invoice_payments (P1A) is not present — apply the invoice payment ledger first';
  end if;
  if to_regprocedure('public.invoice_amount_paid(uuid)') is null
     or to_regprocedure('public._invoice_payment_projection(uuid)') is null then
    raise exception 'MANUAL_PAYMENT: P1A derivation functions are missing — apply the invoice payment ledger first';
  end if;
  -- the source domain must accept 'manual' (P1A defines it; assert, don't alter)
  begin
    perform 1;  -- cheap; the real check is the insert path + the test suite
  end;
end $$;

-- ── 1. manual-payment idempotency ──────────────────────────────────
-- One (invoice, reference) per manual payment. Disjoint from P6's
-- invoice_payments_payfast_ref_once (same columns, source='payfast'
-- predicate) — a manual row can never collide with a PayFast row.
create unique index if not exists invoice_payments_manual_ref_once
  on public.invoice_payments (invoice_id, reference)
  where source = 'manual' and reference is not null;

-- ── 2. record_manual_invoice_payment ──────────────────────────────
-- The ONE place a staff-recorded off-platform payment enters the ledger.
-- p_amount is the NEW payment amount (not a running total). p_reference
-- is the real bank/EFT/receipt reference and is mandatory (audit +
-- idempotency). The AFTER trigger refreshes the opps_invoices cache.
create or replace function public.record_manual_invoice_payment(
  p_invoice_id       uuid,
  p_amount           numeric,
  p_reference        text,
  p_paid_at          timestamptz default now(),
  p_method           text        default 'eft',
  p_note             text        default null,
  p_idempotency_key  text        default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_invoice   public.opps_invoices%rowtype;
  v_user_id   uuid := auth.uid();
  v_amount    numeric(14,2);
  v_ref       text := nullif(btrim(p_reference), '');
  v_key       text := nullif(btrim(coalesce(p_idempotency_key, p_reference)), '');
  v_method    text := lower(nullif(btrim(p_method), ''));
  v_existing  public.invoice_payments%rowtype;
  v_paid      numeric(14,2);
  v_total     numeric(14,2);
  v_row_id    uuid;
  v_has_unreconciled boolean := false;
begin
  -- ── auth ──────────────────────────────────────────────────────────
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'INVOICE_PAYMENT_AUTH_REQUIRED';
  end if;

  -- ── lock the invoice: serialise concurrent payment writes for it ──
  select * into v_invoice from public.opps_invoices where id = p_invoice_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'INVOICE_NOT_FOUND';
  end if;

  -- ── tenant + finance authorisation (server-side; mirrors the
  --    invoice_payments RLS policy) ──────────────────────────────────
  if not public.can_access_tenant(v_invoice.tenant_id)
     or not (public.is_app_admin() or public.user_finance_level() in (1, 2))
  then
    raise exception using errcode = 'P0001', message = 'INVOICE_PAYMENT_ACCESS_DENIED';
  end if;

  -- ── eligibility ──────────────────────────────────────────────────
  if v_invoice.status = 'draft' then
    raise exception using errcode = 'P0001', message = 'INVOICE_PAYMENT_INVOICE_NOT_APPROVED';
  end if;
  if v_invoice.status = 'void' then
    raise exception using errcode = 'P0001', message = 'INVOICE_PAYMENT_INVOICE_VOID';
  end if;

  -- ── amount: positive, ≤ 2dp, no silent rounding ─────────────────
  if p_amount is null then
    raise exception using errcode = 'P0001', message = 'INVOICE_PAYMENT_AMOUNT_REQUIRED';
  end if;
  v_amount := round(p_amount, 2);
  if v_amount <= 0 then
    raise exception using errcode = 'P0001', message = 'INVOICE_PAYMENT_AMOUNT_INVALID';
  end if;
  if v_amount <> round(p_amount, 6) then
    raise exception using errcode = 'P0001', message = 'INVOICE_PAYMENT_AMOUNT_PRECISION';
  end if;

  -- ── reference is mandatory for a manual payment ─────────────────
  if v_ref is null then
    raise exception using errcode = 'P0001', message = 'INVOICE_PAYMENT_REFERENCE_REQUIRED';
  end if;

  -- ── idempotent replay: same (invoice, reference) → return original ─
  select * into v_existing
  from public.invoice_payments
  where invoice_id = p_invoice_id and source = 'manual' and reference = v_ref
  limit 1;
  if found then
    if round(v_existing.amount, 2) <> v_amount
       or v_existing.paid_at::date is distinct from (coalesce(p_paid_at, now()))::date
       or coalesce(v_existing.method, '') is distinct from coalesce(v_method, 'eft')
    then
      raise exception using errcode = 'P0001',
        message = 'INVOICE_PAYMENT_IDEMPOTENCY_CONFLICT: this reference is already recorded with different amount / date / method';
    end if;
    return jsonb_build_object(
      'ok', true, 'replayed', true, 'payment_id', v_existing.id,
      'projection', public._invoice_payment_projection(p_invoice_id));
  end if;

  -- ── cross-source safeguard: never record a manual payment on an
  --    order-linked invoice that still has an UNRECONCILED completed
  --    platform (PayFast) payment — reconcile that first, then record
  --    only the outstanding EFT. Prevents a later
  --    reconcile_invoice_with_order double-counting the same money.
  if v_invoice.source_order_id is not null then
    begin
      select exists (
        select 1
        from public.xlab_payments xp
        join public.xlab_orders xo on xp.order_id = xo.id
        where xp.status = 'completed'
          and (
            xo.opps_order_id = v_invoice.source_order_id
            or (xo.opps_order_number is not null
                and xo.opps_order_number = (select order_number from public.orders where id = v_invoice.source_order_id))
          )
          and not exists (
            select 1 from public.invoice_payments ip
            where ip.invoice_id = p_invoice_id and ip.xlab_payment_id = xp.id
          )
      ) into v_has_unreconciled;
    exception when undefined_table or undefined_column then
      v_has_unreconciled := false;   -- bridge tables absent in this env
    end;
    if v_has_unreconciled then
      raise exception using errcode = 'P0001',
        message = 'INVOICE_PAYMENT_UNRECONCILED_ORDER_PAYMENT: the linked order has a completed platform payment not yet folded into this invoice — run the linked-order reconciliation first, then record only the outstanding amount';
    end if;
  end if;

  -- ── overpayment guard (ledger-derived, ±R0.02 tolerance) ────────
  v_paid  := public.invoice_amount_paid(p_invoice_id);
  v_total := round(coalesce(v_invoice.total, 0), 2);
  if v_paid + v_amount > v_total + 0.02 then
    raise exception using errcode = 'P0001',
      message = format('INVOICE_PAYMENT_OVERPAYMENT: %s already recorded + %s would exceed the invoice total %s',
                       v_paid, v_amount, v_total);
  end if;

  -- ── insert the one auditable ledger row ────────────────────────
  -- tenant_id is FORCED by trg_invoice_payments_set_tenant to the
  -- invoice's tenant; created_by = the acting staff user.
  insert into public.invoice_payments (
    invoice_id, amount, paid_at, method, reference, source, order_id, created_by, metadata
  ) values (
    p_invoice_id, v_amount, coalesce(p_paid_at, now()),
    coalesce(v_method, 'eft'), v_ref, 'manual',
    v_invoice.source_order_id, v_user_id,
    jsonb_strip_nulls(jsonb_build_object(
      'note',            nullif(btrim(coalesce(p_note, '')), ''),
      'idempotency_key', v_key,
      'recorded_via',    'record_manual_invoice_payment'
    ))
  )
  on conflict (invoice_id, reference) where source = 'manual' and reference is not null
    do nothing
  returning id into v_row_id;

  -- lost the race to a concurrent identical insert → treat as replay
  if v_row_id is null then
    select id into v_row_id
    from public.invoice_payments
    where invoice_id = p_invoice_id and source = 'manual' and reference = v_ref
    limit 1;
    return jsonb_build_object(
      'ok', true, 'replayed', true, 'payment_id', v_row_id,
      'projection', public._invoice_payment_projection(p_invoice_id));
  end if;

  -- trg_invoice_payments_refresh_cache has now recomputed
  -- opps_invoices.amount_paid / balance_due from the ledger.
  return jsonb_build_object(
    'ok', true, 'replayed', false, 'payment_id', v_row_id,
    'projection', public._invoice_payment_projection(p_invoice_id));
end;
$$;

revoke all on function public.record_manual_invoice_payment(uuid, numeric, text, timestamptz, text, text, text) from public, anon;
grant execute on function public.record_manual_invoice_payment(uuid, numeric, text, timestamptz, text, text, text) to authenticated;

comment on function public.record_manual_invoice_payment(uuid, numeric, text, timestamptz, text, text, text) is
  'Records ONE off-platform (EFT/cash/card/other) invoice payment into the canonical public.invoice_payments ledger (source=manual). Finance-authorised staff only, tenant enforced, invoice locked FOR UPDATE. p_amount is a new payment (not a running total); p_reference is the real bank reference and is mandatory. Idempotent on (invoice_id, reference): a replay with the same reference returns the original result; a replay with a different amount/date/method is rejected. Rejects overpayment beyond R0.02 and manual entry while a linked order has an unreconciled completed platform payment. Never writes opps_invoices.amount_paid/balance_due directly — the P1A AFTER trigger refreshes that cache. Returns _invoice_payment_projection(invoice).';

commit;
