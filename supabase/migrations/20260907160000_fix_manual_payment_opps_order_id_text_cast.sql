-- ════════════════════════════════════════════════════════════════════
--  HOTFIX — record_manual_invoice_payment: opps_order_id is text, not uuid
-- ════════════════════════════════════════════════════════════════════
--
-- P0 (production): recording / reconciling a manual payment on an
-- ORDER-LINKED invoice raised
--
--     operator does not exist: text = uuid
--
-- Root cause: the cross-source safeguard in record_manual_invoice_payment
-- compares
--
--     xo.opps_order_id = v_invoice.source_order_id
--
-- but in production (and staging) `public.xlab_orders.opps_order_id` is
-- `text` while `public.opps_invoices.source_order_id` is `uuid`. Postgres
-- has no `text = uuid` operator, so the guard errors out. It only runs when
-- `source_order_id is not null`, so it never fired for standalone invoices
-- and was masked by the disposable test harness, which declared
-- `xlab_orders.opps_order_id uuid`. Every other live query on this column
-- (e.g. 20260829100000_xos_2_6_tenant_identity_polish.sql) already casts
-- the uuid side: `xo.opps_order_id = <uuid>::text`.
--
-- The error is SQLSTATE 42883 (undefined_function), so it was NOT caught by
-- the block's `exception when undefined_table or undefined_column` handler
-- and propagated raw to the client. The RPC is one transaction, so the
-- whole call rolled back: no invoice_payments row, no opps_invoice_activity
-- row, no opps_invoices change. Verified read-only against invoice
-- OPPS-INV-2026-0085 (0 ledger rows, 0 activity rows since the attempt,
-- invoice row untouched).
--
-- Fix: cast the uuid identifier to text to match the real column type and
-- the existing production contract — `v_invoice.source_order_id::text`.
-- `::text` on a real uuid never throws; the `opps_order_id::uuid` direction
-- was rejected because a legacy/malformed `xlab_orders.opps_order_id` row
-- could raise 22P02.
--
-- Idempotent `create or replace`; the 7-arg contract, grants, and every
-- other line are byte-identical to the version shipped by
-- 20260907130000_manual_payment_operation_key_and_proof.sql.
--
-- NO data change. NO PayFast. NO schema change. Does not reconcile 0085.
-- ════════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'record_manual_invoice_payment'
      and pg_get_function_arguments(p.oid) like '%p_operation_key%'
  ) then
    raise exception 'MANUAL_PAYMENT_HOTFIX: 7-arg record_manual_invoice_payment is not present — apply 20260907130000 first';
  end if;
  if (select data_type from information_schema.columns
        where table_schema = 'public' and table_name = 'xlab_orders'
          and column_name = 'opps_order_id') is distinct from 'text' then
    raise exception 'MANUAL_PAYMENT_HOTFIX: xlab_orders.opps_order_id is not text on this database — re-derive the correct cast before applying';
  end if;
end $$;

create or replace function public.record_manual_invoice_payment(
  p_invoice_id    uuid,
  p_amount        numeric,
  p_reference     text        default null,
  p_paid_at       timestamptz default now(),
  p_method        text        default 'eft',
  p_note          text        default null,
  p_operation_key text        default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_invoice       public.opps_invoices%rowtype;
  v_user_id       uuid := auth.uid();
  v_amount        numeric(14,2);
  v_ref           text := nullif(btrim(p_reference), '');
  v_opkey         text := nullif(btrim(p_operation_key), '');
  v_note          text := nullif(btrim(coalesce(p_note, '')), '');
  v_method        text := lower(nullif(btrim(p_method), ''));
  v_paid_at       timestamptz := coalesce(p_paid_at, now());
  v_existing      public.invoice_payments%rowtype;
  v_paid          numeric(14,2);
  v_total         numeric(14,2);
  v_row_id        uuid;
  v_status_after     text;
  v_new_status       text;
  v_effective_status text;
  v_proof_count      integer := 0;
  v_has_unreconciled boolean := false;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'INVOICE_PAYMENT_AUTH_REQUIRED';
  end if;

  select * into v_invoice from public.opps_invoices where id = p_invoice_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'INVOICE_NOT_FOUND';
  end if;

  if not public.can_access_tenant(v_invoice.tenant_id)
     or not (public.is_app_admin() or public.user_finance_level() in (1, 2))
  then
    raise exception using errcode = 'P0001', message = 'INVOICE_PAYMENT_ACCESS_DENIED';
  end if;

  if v_invoice.status = 'draft' then
    raise exception using errcode = 'P0001', message = 'INVOICE_PAYMENT_INVOICE_NOT_APPROVED';
  end if;
  if v_invoice.status = 'void' then
    raise exception using errcode = 'P0001', message = 'INVOICE_PAYMENT_INVOICE_VOID';
  end if;

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

  -- a stable client operation key is mandatory (reuse it across retries);
  -- the external reference stays optional and is never fabricated.
  if v_opkey is null then
    raise exception using errcode = 'P0001',
      message = 'INVOICE_PAYMENT_OPERATION_KEY_REQUIRED: a stable client operation key is required and must be reused on retry';
  end if;

  -- ── (1) operation-key match: the retry-safe replay path ─────────
  select * into v_existing
  from public.invoice_payments
  where invoice_id = p_invoice_id and source = 'manual' and client_operation_key = v_opkey
  limit 1;
  if found then
    perform public._assert_manual_payment_matches(v_existing, v_amount, v_paid_at, v_method, v_ref, v_opkey);
    v_proof_count := public._link_staged_payment_attachments(p_invoice_id, v_opkey, v_existing.id, v_invoice.tenant_id);
    return jsonb_build_object(
      'ok', true, 'replayed', true, 'payment_id', v_existing.id,
      'proof_linked', v_proof_count,
      'projection', public._invoice_payment_projection(p_invoice_id));
  end if;

  -- ── (2) reference reused by a DIFFERENT operation → hard conflict ─
  -- (never a silent replay, never a proof attach onto an unrelated row)
  if v_ref is not null and exists (
    select 1 from public.invoice_payments
    where invoice_id = p_invoice_id and source = 'manual' and reference = v_ref
  ) then
    raise exception using errcode = 'P0001',
      message = 'INVOICE_PAYMENT_IDEMPOTENCY_CONFLICT: this reference is already recorded on this invoice under a different operation — reload before recording another payment';
  end if;

  -- ── cross-source safeguard (fail closed on a missing bridge) ────
  if v_invoice.source_order_id is not null then
    begin
      select exists (
        select 1
        from public.xlab_payments xp
        join public.xlab_orders xo on xp.order_id = xo.id
        where xp.status = 'completed'
          and (
            -- xlab_orders.opps_order_id is TEXT; source_order_id is UUID.
            xo.opps_order_id = v_invoice.source_order_id::text
            or (xo.opps_order_number is not null
                and xo.opps_order_number = (select order_number from public.orders where id = v_invoice.source_order_id))
          )
          and not exists (
            select 1 from public.invoice_payments ip
            where ip.invoice_id = p_invoice_id and ip.xlab_payment_id = xp.id
          )
      ) into v_has_unreconciled;
    exception when undefined_table or undefined_column then
      raise exception using errcode = 'P0001',
        message = 'INVOICE_PAYMENT_BRIDGE_SCHEMA_MISSING: the order/payment bridge schema needed to check for existing platform payments on this order-linked invoice is absent or incompatible — resolve the sync schema before recording a manual payment';
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
  begin
    insert into public.invoice_payments (
      invoice_id, amount, paid_at, method, reference, source, order_id,
      created_by, client_operation_key, metadata
    ) values (
      p_invoice_id, v_amount, v_paid_at,
      coalesce(v_method, 'eft'), v_ref, 'manual',
      v_invoice.source_order_id, v_user_id, v_opkey,
      jsonb_strip_nulls(jsonb_build_object(
        'note', v_note, 'recorded_via', 'record_manual_invoice_payment'
      ))
    )
    returning id into v_row_id;
  exception when unique_violation then
    -- a concurrent request won a race. Identify the ACTUAL conflicting
    -- row and validate it before returning replayed=true.
    select * into v_existing
    from public.invoice_payments
    where invoice_id = p_invoice_id and source = 'manual' and client_operation_key = v_opkey
    limit 1;
    if v_existing.id is not null then
      perform public._assert_manual_payment_matches(v_existing, v_amount, v_paid_at, v_method, v_ref, v_opkey);
      v_proof_count := public._link_staged_payment_attachments(p_invoice_id, v_opkey, v_existing.id, v_invoice.tenant_id);
      return jsonb_build_object(
        'ok', true, 'replayed', true, 'payment_id', v_existing.id,
        'proof_linked', v_proof_count,
        'projection', public._invoice_payment_projection(p_invoice_id));
    end if;
    if v_ref is not null and exists (
      select 1 from public.invoice_payments
      where invoice_id = p_invoice_id and source = 'manual' and reference = v_ref
    ) then
      raise exception using errcode = 'P0001',
        message = 'INVOICE_PAYMENT_IDEMPOTENCY_CONFLICT: this reference is already recorded on this invoice under a different operation';
    end if;
    raise;  -- unknown unique_violation → propagate
  end;

  -- ── compat status mirror (safe payment-cycle transitions only) ──
  v_status_after     := public.invoice_payment_status(p_invoice_id);
  v_effective_status := v_invoice.status;
  if v_invoice.status in ('approved', 'partially_paid') then
    v_new_status := case v_status_after
                      when 'paid'    then 'paid'
                      when 'partial' then 'partially_paid'
                      else null
                    end;
  elsif v_invoice.status = 'overdue' and v_status_after = 'paid' then
    v_new_status := 'paid';
  end if;
  if v_new_status is not null and v_new_status is distinct from v_invoice.status then
    update public.opps_invoices
       set status = v_new_status, updated_by = v_user_id
     where id = p_invoice_id;
    v_effective_status := v_new_status;
  end if;

  -- ── link staged proof-of-payment files (same transaction) ───────
  v_proof_count := public._link_staged_payment_attachments(p_invoice_id, v_opkey, v_row_id, v_invoice.tenant_id);

  -- ── canonical payment audit event (same transaction) ───────────
  insert into public.opps_invoice_activity (
    invoice_id, tenant_id, activity_type, activity_label, activity_note,
    from_status, to_status, metadata, created_by
  ) values (
    p_invoice_id, v_invoice.tenant_id,
    'invoice_payment_recorded', 'Payment recorded',
    format('%s %s%s',
           coalesce(v_method, 'eft'),
           to_char(v_amount, 'FM999999999990.00'),
           case when v_ref is not null then ' · ref ' || v_ref else '' end),
    v_invoice.status,
    v_effective_status,
    jsonb_strip_nulls(jsonb_build_object(
      'payment_id',     v_row_id,
      'amount',         v_amount,
      'source',         'manual',
      'method',         coalesce(v_method, 'eft'),
      'reference',      v_ref,
      'operation_key',  v_opkey,
      'paid_at',        v_paid_at,
      'note',           v_note,
      'actor',          v_user_id,
      'proof_count',    v_proof_count,
      'payment_status', v_status_after,
      'amount_paid',    public.invoice_amount_paid(p_invoice_id),
      'balance_due',    public.invoice_balance_due(p_invoice_id)
    )),
    v_user_id
  );

  return jsonb_build_object(
    'ok', true, 'replayed', false, 'payment_id', v_row_id,
    'proof_linked', v_proof_count,
    'projection', public._invoice_payment_projection(p_invoice_id));
end;
$$;

revoke all on function public.record_manual_invoice_payment(uuid, numeric, text, timestamptz, text, text, text) from public, anon;
grant execute on function public.record_manual_invoice_payment(uuid, numeric, text, timestamptz, text, text, text) to authenticated;

commit;
