-- ════════════════════════════════════════════════════════════════════
--  PUBLIC INVOICE PAYFAST PAYMENT — invoice-scoped init + reconciliation
-- ════════════════════════════════════════════════════════════════════
--
-- Closes the gap behind "approved unpaid public invoices show no Pay
-- button": the /i/:token route (X LAB) and get_public_invoice() already
-- return can_pay / balance_due, but nothing existed for the frontend to
-- CALL when the customer taps Pay. A prior, unmerged X LAB branch
-- (release/invoice-payfast-xlab, phases P2-P6) built this once already;
-- its backend RPCs were designed but never committed to any repo (see
-- that branch's own commit messages: "Migration not applied"). This
-- migration authors them fresh, against the P1A ledger that IS in this
-- repo (20260907120000_record_manual_invoice_payment.sql), reusing its
-- exact invoice_payments shape and idempotency pattern rather than a
-- second one.
--
-- Adds exactly two SECURITY DEFINER RPCs, both revoked from
-- public/anon/authenticated — reachable ONLY via the Supabase
-- service-role key (i.e. only from the init-payfast / payfast-notify
-- edge functions in the X LAB repo, never directly from a browser):
--
--   * public.begin_invoice_payment(p_token text)
--       Resolves an invoice STRICTLY by its public share_token (the
--       same eligibility checks get_public_invoice's own callers use:
--       public_visible, not revoked, not expired, not draft/void), and
--       returns the CURRENT canonical balance_due as the amount to
--       charge. The client never supplies an amount. A single generic
--       {ok:false, reason:'UNAVAILABLE'} covers not-found / revoked /
--       expired / draft / void, and a separate {ok:false,
--       reason:'ALREADY_PAID'} covers balance_due <= 0 — no other
--       invoice state is leaked to an anonymous caller.
--
--   * public.apply_invoice_payfast_payment(p_invoice_id, p_amount,
--       p_pf_payment_id, p_raw_itn)
--       The ONE place a completed PayFast invoice payment enters the
--       ledger. Idempotent on (invoice_id, pf_payment_id) via a new
--       partial unique index (source='payfast'), disjoint from the
--       existing manual-payment index (source='manual') — a PayFast row
--       can never collide with a manual one. Same atomic shape as
--       record_manual_invoice_payment: one invoice_payments insert, the
--       P1A AFTER trigger refreshes the amount_paid/balance_due cache,
--       the same safe payment-cycle status mirror, one
--       opps_invoice_activity row. created_by is NULL (no acting staff
--       user — this is a customer-initiated, webhook-reconciled
--       payment), which is why it is a SEPARATE function from
--       record_manual_invoice_payment rather than a mode flag on it:
--       the two have materially different trust models (authenticated
--       finance staff vs. an unauthenticated PayFast webhook that has
--       already been signature-validated at the edge-function layer).
--       OVERPAYMENT HARDENING (invoice-payfast-overpayment-hardening):
--       an amount up to the invoice's current balance_due (±R0.02) is
--       recorded at the actual amount received — this also covers a
--       genuine partial payment, should a future checkout ever
--       intentionally initiate one. An amount ABOVE the balance is
--       REJECTED, not recorded and not clamped: OPPS has no client-credit
--       ledger to place the excess in, so the safest, most auditable
--       response is to leave the ledger untouched and log the rejection
--       to opps_invoice_activity (attempted amount, balance at decision
--       time, PayFast reference — never the raw ITN/signature) for manual
--       reconciliation. A repeat rejection of the same (invoice,
--       pf_payment_id) reuses the existing activity row rather than
--       piling up identical rows on retry — concurrency-safe under the
--       same FOR UPDATE lock the rest of the function already holds, no
--       new unique index or second ledger needed. An invoice with
--       nothing left owing ignores a further completed ITN
--       (INVOICE_ALREADY_PAID) rather than treating it as an
--       overpayment. Only structurally invalid input (no amount, no
--       pf_payment_id, invoice not found, invoice void) is rejected
--       outright. See the function's own header comment for the full
--       reasoning and the atomicity/locking guarantee.
--
-- Does NOT touch: get_public_invoice, record_manual_invoice_payment,
-- payment_attachments, PayFast for storefront ORDERS (xlab_orders /
-- xlab_payments — a completely separate ledger, untouched by this
-- migration), opps_invoices/opps_invoice_activity schema.
--
-- NOTE ON "online_payments_enabled": no per-tenant/store payment-provider
-- config table exists anywhere in this codebase (grepped both repos) —
-- PayFast is one shared merchant account gated globally by whether
-- PAYFAST_MERCHANT_ID/PAYFAST_MERCHANT_KEY are configured (already
-- enforced at the edge-function layer in init-payfast). There is no
-- additional per-tenant toggle to check here.
--
-- DEPENDS ON: P1A (20260904120000_invoice_p1a_payment_reconciliation.sql)
-- and the manual-payment migration's invoice_payments shape — same
-- "production-first, not yet reconciled into origin/main" situation
-- documented there.
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
    raise exception 'INVOICE_PAYFAST: public.invoice_payments (P1A) is not present — apply the invoice payment ledger first';
  end if;
  if to_regprocedure('public.invoice_amount_paid(uuid)') is null
     or to_regprocedure('public.invoice_balance_due(uuid)') is null
     or to_regprocedure('public.invoice_payment_status(uuid)') is null then
    raise exception 'INVOICE_PAYFAST: P1A derivation functions are missing — apply the invoice payment ledger first';
  end if;
  if to_regclass('public.opps_invoice_activity') is null then
    raise exception 'INVOICE_PAYFAST: public.opps_invoice_activity is missing — the invoicing schema is not present';
  end if;
  if to_regclass('public.opps_invoices') is null then
    raise exception 'INVOICE_PAYFAST: public.opps_invoices is missing';
  end if;
end $$;

-- ── 1. payfast idempotency (disjoint from the manual-payment index) ──
create unique index if not exists invoice_payments_payfast_ref_once
  on public.invoice_payments (invoice_id, reference)
  where source = 'payfast' and reference is not null;

-- ── 2. begin_invoice_payment ────────────────────────────────────────
create or replace function public.begin_invoice_payment(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_invoice public.opps_invoices%rowtype;
  v_token   text := nullif(btrim(p_token), '');
  v_balance numeric(14,2);
begin
  if v_token is null then
    return jsonb_build_object('ok', false, 'reason', 'UNAVAILABLE');
  end if;

  select * into v_invoice
  from public.opps_invoices
  where share_token = v_token
  limit 1;

  if not found
     or v_invoice.public_visible is not true
     or v_invoice.share_revoked_at is not null
     or (v_invoice.share_expires_at is not null and v_invoice.share_expires_at < now())
     or v_invoice.status in ('draft', 'void')
  then
    -- not-found / revoked / expired / draft / void all collapse to one
    -- generic reason, matching get_public_invoice's own posture: no
    -- invoice state is leaked to an anonymous caller.
    return jsonb_build_object('ok', false, 'reason', 'UNAVAILABLE');
  end if;

  v_balance := public.invoice_balance_due(v_invoice.id);
  if v_balance is null or round(v_balance, 2) <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'ALREADY_PAID');
  end if;

  return jsonb_build_object(
    'ok', true,
    'amount', round(v_balance, 2),
    'invoice_id', v_invoice.id,
    'invoice_number', v_invoice.invoice_number,
    'customer_name', v_invoice.customer_name,
    'customer_email', v_invoice.customer_email
  );
end;
$$;

revoke all on function public.begin_invoice_payment(text) from public, anon, authenticated;

comment on function public.begin_invoice_payment(text) is
  'Resolves a public invoice by share_token for PayFast initiation ONLY (service-role callers, i.e. the init-payfast edge function — never callable from a browser). Same eligibility gate as get_public_invoice (public_visible, not revoked, not expired, not draft/void) plus balance_due > 0. Returns the server''s own canonical balance_due as the amount to charge — the client never supplies one. A single generic UNAVAILABLE reason covers every ineligible state except ALREADY_PAID, so nothing is leaked to an anonymous caller.';

-- ── 3. apply_invoice_payfast_payment ────────────────────────────────
--
-- OVERPAYMENT POLICY (hardened — see the invoice-payfast-overpayment
-- task): OPPS has no client-credit/overpayment ledger. An amount up to
-- the invoice's CURRENT outstanding balance (±R0.02 rounding tolerance,
-- the same tolerance record_manual_invoice_payment already uses) is
-- accepted and recorded at the actual amount received — this also
-- covers a genuine partial payment, should a future invoice checkout
-- ever intentionally initiate one; begin_invoice_payment today always
-- requests the full balance, so in practice this is the exact-match
-- case. An amount ABOVE the balance is REJECTED — not recorded with the
-- excess silently dropped, and not clamped to the balance: PayFast has
-- already irreversibly captured that exact amount, so silently
-- recording a smaller number than what was actually charged would
-- misrepresent settled reality to reconciliation, and there is nowhere
-- safe to put the difference without inventing a credit ledger this
-- codebase does not have. The rejection is logged to
-- opps_invoice_activity (durable, queryable, visible on the invoice
-- itself, not just an edge-function console log) so the captured money
-- is never silently lost track of — finance sees exactly what PayFast
-- settled versus what the invoice could actually absorb, and reconciles
-- the excess manually (refund via PayFast, apply to another invoice,
-- etc). The ledger and opps_invoices cache are left completely
-- unchanged on rejection.
--
-- ATOMICITY: `select ... for update` locks the invoice row before ANY
-- balance read. Two concurrent ITNs for the SAME invoice serialise on
-- that lock — the second waits for the first to commit, then re-reads
-- the POST-commit balance (a fresh statement under READ COMMITTED sees
-- the first transaction's now-committed invoice_payments row), so it
-- correctly evaluates against the balance the first payment already
-- consumed. This is what prevents two concurrent distinct payments from
-- both observing the pre-payment balance and jointly over-crediting the
-- invoice. Two concurrent identical pf_payment_id retries are further
-- guarded by the invoice_payments_payfast_ref_once unique index — the
-- loser's insert hits `on conflict do nothing` and is treated as a
-- replay, never a second row.
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

  -- ── lock: see ATOMICITY note above. ─────────────────────────────────
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
  --    clamp. See the header comment above this function for the full
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

  -- ── valid amount (exact, or a genuine partial ≤ balance): record it ──
  insert into public.invoice_payments (
    tenant_id, invoice_id, amount, paid_at, method, reference, source, order_id, created_by, metadata
  ) values (
    v_invoice.tenant_id, p_invoice_id, v_amount, now(), 'payfast', v_ref, 'payfast',
    v_invoice.source_order_id, null,
    jsonb_strip_nulls(jsonb_build_object(
      'recorded_via', 'apply_invoice_payfast_payment',
      'raw_itn', p_raw_itn
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

revoke all on function public.apply_invoice_payfast_payment(uuid, numeric, text, jsonb) from public, anon, authenticated;

comment on function public.apply_invoice_payfast_payment(uuid, numeric, text, jsonb) is
  'Records ONE completed PayFast invoice payment (source=payfast) in a single transaction: invoice locked FOR UPDATE -> balance validated against the CURRENT ledger-derived balance_due -> ledger row -> P1A cache trigger -> safe payment-cycle status mirror -> one opps_invoice_activity row (created_by NULL — customer-initiated, not a staff action). Service-role callers only (the payfast-notify edge function, after its own ITN signature validation) — never callable from a browser. Idempotent on (invoice_id, pf_payment_id): a replayed ITN returns the original result and writes neither a second payment nor a second activity row. OVERPAYMENT POLICY: an amount up to the current balance_due (±R0.02) is recorded at the actual amount (covers exact payment and any future genuine partial payment); an amount exceeding it is REJECTED — never recorded, never clamped — because OPPS has no client-credit ledger to place the excess in; the rejection is logged to opps_invoice_activity (attempted amount, balance at decision time, and the PayFast reference — never the raw ITN/signature) for reconciliation and the ledger/cache are left unchanged. A REPEAT rejection of the same (invoice, pf_payment_id) reuses the existing activity row rather than piling up duplicates on retry. An invoice with no balance left owing ignores a further completed ITN (INVOICE_ALREADY_PAID) rather than treating it as an overpayment. Only structurally invalid input (missing pf_payment_id/amount, invoice not found, invoice void) is rejected outright.';

commit;
