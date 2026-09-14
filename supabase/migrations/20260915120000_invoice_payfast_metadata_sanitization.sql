-- ════════════════════════════════════════════════════════════════════
--  INVOICE PAYFAST — successful-payment metadata sanitization
-- ════════════════════════════════════════════════════════════════════
--
-- Forward-only follow-up to 20260913110000_invoice_payfast_payment.sql,
-- which has already been applied and reconciled on staging — that
-- migration's historical contents are NOT edited here.
--
-- Gap: apply_invoice_payfast_payment's rejected-overpayment path already
-- avoids storing the raw ITN (which carries PayFast's signature) — see
-- that migration's own comment: "No raw_itn / signature stored here".
-- The ACCEPTED-payment path did not get the same treatment: it stored
-- p_raw_itn wholesale into invoice_payments.metadata, so a genuine
-- PayFast signature (and merchant_id, customer email, routing fields,
-- everything else PayFast sends) would end up durably persisted on every
-- successful invoice payment.
--
-- Fix: CREATE OR REPLACE the ONE function, changing ONLY how the
-- successful-payment metadata object is built. Everything else —
-- signature, parameters, locking, balance/tolerance math, partial-payment
-- acceptance, duplicate/replay idempotency (still on invoice_id+reference
-- via invoice_payments_payfast_ref_once, untouched by this migration),
-- overpayment rejection, rejection dedup, already-paid precedence, the
-- compat status mirror, the activity-insert shape — is byte-for-byte
-- identical to the currently-applied function. CREATE OR REPLACE FUNCTION
-- does not reset existing REVOKE/GRANT state, so those are not reissued.
--
-- Retained metadata is a small explicit allowlist: payfast_amount_fee /
-- payfast_amount_net — PayFast's own fee breakdown, the only ITN fields
-- with no existing canonical column anywhere in this schema (amount,
-- pf_payment_id and invoice_id already have their own columns; payment_
-- status/item_name/m_payment_id/email_address/merchant_id/custom_str1-2
-- are either redundant with those or have no legitimate reason to be
-- stored, so they are dropped along with signature).
--
-- Scope: this function only. The same raw-ITN-storage pattern exists in
-- two unrelated systems — ordinary X LAB order payments (xlab_payments.
-- raw_itn, written directly in the payfast-notify edge function, no RPC)
-- and Quick Solution (commerce.qs_apply_payfast_payment, a separate
-- schema) — neither is touched here; neither is owned by this PR.
--
-- STAGING-FIRST. NOT APPLIED. NO PRODUCTION WRITE. NO DEPLOY. NO PUSH.
-- ════════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
begin
  if to_regprocedure('public.apply_invoice_payfast_payment(uuid, numeric, text, jsonb)') is null then
    raise exception 'INVOICE_PAYFAST_METADATA_SANITIZATION: apply_invoice_payfast_payment does not exist yet — apply 20260913110000_invoice_payfast_payment.sql first';
  end if;
end $$;

create or replace function public.apply_invoice_payfast_payment(
  p_invoice_id     uuid,
  p_amount         numeric,
  p_pf_payment_id  text,
  p_raw_itn        jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_invoice          public.opps_invoices%rowtype;
  v_amount           numeric(14,2);
  v_ref              text := nullif(btrim(p_pf_payment_id), '');
  v_existing_id      uuid;
  v_row_id           uuid;
  v_balance          numeric(14,2);
  v_status_before    text;
  v_status_after     text;
  v_new_status       text;
  v_effective_status text;
begin
  if v_ref is null then
    -- A COMPLETE ITN with no pf_payment_id cannot be deduplicated safely —
    -- refuse rather than risk folding it twice or never telling a
    -- legitimate retry apart from a fresh payment.
    return jsonb_build_object('ok', false, 'reason', 'PF_PAYMENT_ID_REQUIRED');
  end if;
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'AMOUNT_INVALID');
  end if;
  v_amount := round(p_amount, 2);

  -- ── lock: see ATOMICITY note in 20260913110000. ─────────────────────
  select * into v_invoice from public.opps_invoices where id = p_invoice_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'INVOICE_NOT_FOUND');
  end if;
  if v_invoice.status = 'void' then
    return jsonb_build_object('ok', false, 'reason', 'INVOICE_VOID');
  end if;

  -- ── idempotent replay: same (invoice, pf_payment_id) -> original result,
  --    no second payment, no second activity row. PayFast's own ITN can
  --    and does retry.
  select id into v_existing_id
  from public.invoice_payments
  where invoice_id = p_invoice_id and source = 'payfast' and reference = v_ref
  limit 1;
  if v_existing_id is not null then
    return jsonb_build_object(
      'ok', true, 'replayed', true, 'payment_id', v_existing_id,
      'amount_paid', public.invoice_amount_paid(p_invoice_id),
      'balance_due', public.invoice_balance_due(p_invoice_id),
      'payment_status', public.invoice_payment_status(p_invoice_id)
    );
  end if;

  -- ── already fully settled: never fold in a second, genuinely-distinct
  --    completed PayFast session against an invoice with nothing left
  --    owing (two tabs, a very late notification, a manual payment
  --    recorded meanwhile, ...). Diagnosed separately from the
  --    overpayment case below because it is a calmer, more specific
  --    situation for reconciliation to read. ──────────────────────────
  v_balance       := public.invoice_balance_due(p_invoice_id);
  v_status_before := public.invoice_payment_status(p_invoice_id);
  if v_status_before = 'paid' or v_balance <= 0 then
    return jsonb_build_object(
      'ok', true, 'ignored', true, 'reason', 'INVOICE_ALREADY_PAID',
      'amount_paid', public.invoice_amount_paid(p_invoice_id),
      'balance_due', v_balance, 'payment_status', v_status_before
    );
  end if;

  -- ── OVERPAYMENT POLICY: reject/quarantine, do not record, do not
  --    clamp. See 20260913110000's header comment for the full
  --    reasoning. ───────────────────────────────────────────────────
  if v_amount > v_balance + 0.02 then
    -- Narrow, safe dedupe: PayFast (or a manual replay) resubmitting the
    -- SAME rejected pf_payment_id must not pile up a fresh identical
    -- activity row on every retry. Concurrency safety comes from the
    -- invoice FOR UPDATE lock already held above (this whole function
    -- runs under it) — no new unique index or second ledger table is
    -- needed for that. Deliberately does NOT touch accepted-payment
    -- idempotency, which is a separate, already-indexed path
    -- (invoice_payments_payfast_ref_once).
    if not exists (
      select 1 from public.opps_invoice_activity
      where invoice_id = p_invoice_id
        and activity_type = 'invoice_payment_rejected'
        and metadata->>'reference' = v_ref
        and metadata->>'reason' = 'INVOICE_PAYMENT_OVERPAYMENT_REJECTED'
    ) then
      -- No raw_itn / signature stored here — attempted amount, the balance
      -- at decision time, and the PayFast reference are all reconciliation
      -- needs; the ITN's own signature has already served its one purpose
      -- (validated at the edge-function layer before this RPC is ever
      -- called) and has no further use once durably logged.
      insert into public.opps_invoice_activity (
        invoice_id, tenant_id, activity_type, activity_label, activity_note,
        from_status, to_status, metadata, created_by
      ) values (
        p_invoice_id, v_invoice.tenant_id,
        'invoice_payment_rejected', 'PayFast payment rejected — exceeds balance',
        format('payfast %s exceeds outstanding balance %s · pf_payment_id %s',
               to_char(v_amount, 'FM999999999990.00'), to_char(v_balance, 'FM999999999990.00'), v_ref),
        v_invoice.status, v_invoice.status,
        jsonb_strip_nulls(jsonb_build_object(
          'reason',          'INVOICE_PAYMENT_OVERPAYMENT_REJECTED',
          'amount_received', v_amount,
          'balance_due',     v_balance,
          'reference',       v_ref
        )),
        null
      );
    end if;
    return jsonb_build_object(
      'ok', false, 'reason', 'INVOICE_PAYMENT_OVERPAYMENT_REJECTED',
      'expected_max', v_balance, 'received', v_amount
    );
  end if;

  -- Metadata is a small allowlist, never the raw ITN. `signature` (and
  -- everything else PayFast sends) is dropped here regardless of what the
  -- caller passes as p_raw_itn — the same "no raw_itn / signature stored"
  -- guarantee the rejected-overpayment path above already gives, now
  -- applied to the accepted path too. Only fields with standalone
  -- reconciliation value and no existing canonical column are kept:
  -- amount/pf_payment_id/invoice_id already have their own columns above,
  -- so payment_status, item_name and m_payment_id are redundant with them
  -- and are deliberately left out; amount_fee/amount_net are PayFast's own
  -- fee breakdown and are not captured anywhere else in this schema.
  -- ── valid amount (exact, or a genuine partial ≤ balance): record it ──
  insert into public.invoice_payments (
    tenant_id, invoice_id, amount, paid_at, method, reference, source, order_id, created_by, metadata
  ) values (
    v_invoice.tenant_id, p_invoice_id, v_amount, now(), 'payfast', v_ref, 'payfast',
    v_invoice.source_order_id, null,
    jsonb_strip_nulls(jsonb_build_object(
      'recorded_via', 'apply_invoice_payfast_payment',
      'payfast_amount_fee', nullif(p_raw_itn->>'amount_fee', '')::numeric,
      'payfast_amount_net', nullif(p_raw_itn->>'amount_net', '')::numeric
    ))
  )
  on conflict (invoice_id, reference) where source = 'payfast' and reference is not null
    do nothing
  returning id into v_row_id;

  -- lost a race to a concurrent identical ITN retry -> treat as replay,
  -- not a second payment / second activity row.
  if v_row_id is null then
    select id into v_row_id
    from public.invoice_payments
    where invoice_id = p_invoice_id and source = 'payfast' and reference = v_ref
    limit 1;
    return jsonb_build_object(
      'ok', true, 'replayed', true, 'payment_id', v_row_id,
      'amount_paid', public.invoice_amount_paid(p_invoice_id),
      'balance_due', public.invoice_balance_due(p_invoice_id),
      'payment_status', public.invoice_payment_status(p_invoice_id)
    );
  end if;

  -- trg_invoice_payments_refresh_cache has now recomputed
  -- opps_invoices.amount_paid / balance_due from the ledger.

  -- ── compat status mirror — identical safe-transition rules to
  --    record_manual_invoice_payment (never overwrites draft / void /
  --    exported / imported_to_zoho).
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
    update public.opps_invoices set status = v_new_status where id = p_invoice_id;
    v_effective_status := v_new_status;
  end if;

  -- ── canonical payment audit event (same transaction) ────────────
  -- created_by is NULL: this is a customer-initiated, webhook-reconciled
  -- payment, not a staff action.
  insert into public.opps_invoice_activity (
    invoice_id, tenant_id, activity_type, activity_label, activity_note,
    from_status, to_status, metadata, created_by
  ) values (
    p_invoice_id, v_invoice.tenant_id,
    'invoice_payment_recorded', 'Payment recorded',
    format('payfast %s · pf_payment_id %s', to_char(v_amount, 'FM999999999990.00'), v_ref),
    v_invoice.status, v_effective_status,
    jsonb_strip_nulls(jsonb_build_object(
      'payment_id',     v_row_id,
      'amount',         v_amount,
      'source',         'payfast',
      'method',         'payfast',
      'reference',      v_ref,
      'payment_status', v_status_after,
      'amount_paid',    public.invoice_amount_paid(p_invoice_id),
      'balance_due',    public.invoice_balance_due(p_invoice_id)
    )),
    null
  );

  return jsonb_build_object(
    'ok', true, 'replayed', false, 'payment_id', v_row_id,
    'amount_paid', public.invoice_amount_paid(p_invoice_id),
    'balance_due', public.invoice_balance_due(p_invoice_id),
    'payment_status', v_status_after
  );
end;
$$;

comment on function public.apply_invoice_payfast_payment(uuid, numeric, text, jsonb) is
  'Records ONE completed PayFast invoice payment (source=payfast) in a single transaction: invoice locked FOR UPDATE -> balance validated against the CURRENT ledger-derived balance_due -> ledger row -> P1A cache trigger -> safe payment-cycle status mirror -> one opps_invoice_activity row (created_by NULL — customer-initiated, not a staff action). Service-role callers only (the payfast-notify edge function, after its own ITN signature validation) — never callable from a browser. Idempotent on (invoice_id, pf_payment_id): a replayed ITN returns the original result and writes neither a second payment nor a second activity row. OVERPAYMENT POLICY: an amount up to the current balance_due (±R0.02) is recorded at the actual amount (covers exact payment and any future genuine partial payment); an amount exceeding it is REJECTED — never recorded, never clamped — because OPPS has no client-credit ledger to place the excess in; the rejection is logged to opps_invoice_activity (attempted amount, balance at decision time, and the PayFast reference — never the raw ITN/signature) for reconciliation and the ledger/cache are left unchanged. A REPEAT rejection of the same (invoice, pf_payment_id) reuses the existing activity row rather than piling up duplicates on retry. An invoice with no balance left owing ignores a further completed ITN (INVOICE_ALREADY_PAID) rather than treating it as an overpayment. Only structurally invalid input (missing pf_payment_id/amount, invoice not found, invoice void) is rejected outright. SUCCESSFUL-PAYMENT METADATA (20260915120000): a small explicit allowlist only — payfast_amount_fee / payfast_amount_net — never the raw ITN and never PayFast''s signature.';

commit;
