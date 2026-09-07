-- ════════════════════════════════════════════════════════════════════
--  MANUAL INVOICE PAYMENT — operation key + proof-of-payment attachments
-- ════════════════════════════════════════════════════════════════════
--
-- Phase-1 (backend) upgrade on top of
-- 20260907120000_record_manual_invoice_payment.sql. Purely additive.
-- Does NOT drop or rewrite any existing invoice_payments row (the staging
-- OPPS-INV-2026-0001 R430 manual payment keeps working unchanged — it has
-- client_operation_key NULL and is not covered by the new partial index).
--
-- Adds:
--   1. invoice_payments.client_operation_key  (nullable text) + a partial
--      unique index (invoice_id, client_operation_key) WHERE source='manual'.
--      A stable per-attempt key the client generates once and reuses on
--      retry. It is NOT a bank reference and is never surfaced as one.
--   2. public.payment_attachments  — private proof-of-payment files that
--      belong to a SPECIFIC payment (or, before the payment row exists, to
--      an operation_key). Mirrors expense_attachments: private `uploads`
--      bucket, tenant-prefixed path, signed-URL access only.
--   3. record_manual_invoice_payment(...)  gains p_operation_key (7th arg)
--      and makes p_reference OPTIONAL. In the same transaction as the
--      ledger row it now also links any staged payment_attachments for the
--      operation key to the new payment. Reference-based duplicate
--      detection is preserved; operation-key replay is added.
--   4. attach_payment_proof(...) / supersede_payment_attachment(...) — add
--      proof to an already-recorded payment, and retire a linked proof
--      through an auditable action (never a silent delete).
--
-- Does NOT touch: PayFast, reconcile_invoice_with_order, the public
-- invoice projection, opps_invoices schema, storage bucket definitions or
-- storage.objects RLS (the existing private `uploads` perimeter from
-- 202606270001 / 20260817173003 is reused as-is).
--
-- STAGING-FIRST. NOT APPLIED TO PRODUCTION. NO DEPLOY. NO PUSH.
-- ════════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ── preflight ──────────────────────────────────────────────────────
do $$
begin
  -- accept either the base 6-arg signature or an already-upgraded one
  if not exists (
    select 1 from pg_proc
    where proname = 'record_manual_invoice_payment'
      and pronamespace = 'public'::regnamespace
  ) then
    raise exception 'MANUAL_PAYMENT_PROOF: base migration 20260907120000 (record_manual_invoice_payment) is not present';
  end if;
  if to_regclass('public.invoice_payments') is null
     or to_regclass('public.opps_invoice_activity') is null
     or to_regclass('public.opps_invoices') is null then
    raise exception 'MANUAL_PAYMENT_PROOF: invoice payment schema is missing';
  end if;
  if to_regprocedure('public.private_upload_path_tenant_id(text)') is null then
    raise exception 'MANUAL_PAYMENT_PROOF: private_upload_path_tenant_id(text) is missing — apply the private uploads migration first';
  end if;
  if to_regprocedure('public.is_opps_staff()') is null
     or to_regprocedure('public.user_finance_level()') is null
     or to_regprocedure('public.can_access_tenant(uuid)') is null
     or to_regprocedure('public.is_app_admin()') is null then
    raise exception 'MANUAL_PAYMENT_PROOF: RLS helper functions are missing';
  end if;
end $$;

-- ── 1. operation key on invoice_payments ───────────────────────────
alter table public.invoice_payments
  add column if not exists client_operation_key text;

comment on column public.invoice_payments.client_operation_key is
  'Stable per-attempt key generated once by the client and reused on retry. Internal idempotency only — NOT a bank/receipt reference. Enforced by invoice_payments_manual_opkey_once.';

-- one manual payment per (invoice, operation key). Disjoint from
-- invoice_payments_manual_ref_once — a payment may carry both, either, or
-- (for legacy rows) neither.
create unique index if not exists invoice_payments_manual_opkey_once
  on public.invoice_payments (invoice_id, client_operation_key)
  where source = 'manual' and client_operation_key is not null;

-- ── 2. payment_attachments ─────────────────────────────────────────
create table if not exists public.payment_attachments (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete restrict,
  invoice_id     uuid not null references public.opps_invoices(id) on delete cascade,
  payment_id     uuid references public.invoice_payments(id) on delete cascade,
  operation_key  text,
  storage_bucket text not null default 'uploads',
  storage_path   text not null,
  filename       text,
  mime_type      text,
  byte_size      bigint,
  status         text not null default 'staged'
                   check (status in ('staged', 'linked', 'superseded')),
  uploaded_by    uuid,
  superseded_by  uuid,
  supersede_reason text,
  created_at     timestamptz not null default now(),
  linked_at      timestamptz,
  superseded_at  timestamptz,
  constraint payment_attachments_owner_check
    check (payment_id is not null or operation_key is not null),
  constraint payment_attachments_mime_check
    check (mime_type is null or lower(mime_type) in
           ('image/jpeg', 'image/jpg', 'image/png', 'application/pdf')),
  constraint payment_attachments_size_check
    check (byte_size is null or (byte_size > 0 and byte_size <= 15 * 1024 * 1024)),
  constraint payment_attachments_bucket_check
    check (storage_bucket = 'uploads')
);

create index if not exists payment_attachments_payment_idx   on public.payment_attachments (payment_id);
create index if not exists payment_attachments_invoice_idx   on public.payment_attachments (invoice_id);
create index if not exists payment_attachments_tenant_idx    on public.payment_attachments (tenant_id);
create index if not exists payment_attachments_opkey_idx     on public.payment_attachments (operation_key) where operation_key is not null;

comment on table public.payment_attachments is
  'Private proof-of-payment files (JPG/PNG/PDF) for a specific invoice_payments row. Staged under operation_key before the payment exists, then linked. Private uploads bucket only; signed-URL access; tenant + finance RLS. Supporting evidence only — NOT proof that funds have cleared.';

-- BEFORE trigger: force tenant_id from the invoice, and require the
-- storage path to live under THAT tenant's private prefix (server-side
-- file-ownership validation — the client cannot smuggle a cross-tenant
-- path in).
create or replace function public._payment_attachments_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid;
  v_path_tenant uuid;
begin
  select tenant_id into v_tenant from public.opps_invoices where id = new.invoice_id;
  if v_tenant is null then
    raise exception using errcode = '23503', message = 'PAYMENT_ATTACHMENT_INVOICE_NOT_FOUND';
  end if;
  new.tenant_id := v_tenant;

  if new.payment_id is not null then
    -- the payment must belong to the same invoice + tenant
    if not exists (
      select 1 from public.invoice_payments p
      where p.id = new.payment_id and p.invoice_id = new.invoice_id and p.tenant_id = v_tenant
    ) then
      raise exception using errcode = '23503', message = 'PAYMENT_ATTACHMENT_PAYMENT_MISMATCH';
    end if;
  end if;

  new.storage_path := btrim(coalesce(new.storage_path, ''));
  v_path_tenant := public.private_upload_path_tenant_id(new.storage_path);
  if v_path_tenant is null or v_path_tenant <> v_tenant then
    raise exception using errcode = 'P0001',
      message = 'PAYMENT_ATTACHMENT_PATH_NOT_TENANT_SCOPED: the storage path must live under this invoice tenant''s private prefix';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_payment_attachments_guard on public.payment_attachments;
create trigger trg_payment_attachments_guard
  before insert or update on public.payment_attachments
  for each row execute function public._payment_attachments_guard();

alter table public.payment_attachments enable row level security;

-- RESTRICTIVE: OPPS staff only (no external client identities, ever)
drop policy if exists payment_attachments_staff_only on public.payment_attachments;
create policy payment_attachments_staff_only
  on public.payment_attachments as restrictive for all to authenticated
  using (public.is_opps_staff())
  with check (public.is_opps_staff());

-- PERMISSIVE: finance-authorised + same tenant
drop policy if exists payment_attachments_finance_tenant on public.payment_attachments;
create policy payment_attachments_finance_tenant
  on public.payment_attachments for all to authenticated
  using ((public.is_app_admin() or public.user_finance_level() in (1, 2)) and public.can_access_tenant(tenant_id))
  with check ((public.is_app_admin() or public.user_finance_level() in (1, 2)) and public.can_access_tenant(tenant_id));

-- A LINKED or SUPERSEDED attachment is never removed by an ordinary
-- table DELETE — only staged rows can be cleaned up that way. Retiring a
-- linked proof goes through supersede_payment_attachment() (auditable).
drop policy if exists payment_attachments_delete_staged_only on public.payment_attachments;
create policy payment_attachments_delete_staged_only
  on public.payment_attachments as restrictive for delete to authenticated
  using (status = 'staged');

grant select, insert, update, delete on public.payment_attachments to authenticated;

-- ── 3. internal: link staged attachments to a payment (same txn) ────
create or replace function public._link_staged_payment_attachments(
  p_invoice_id  uuid,
  p_operation_key text,
  p_payment_id  uuid,
  p_tenant_id   uuid
)
returns integer
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_count integer := 0;
begin
  if p_operation_key is null then
    return 0;
  end if;
  update public.payment_attachments
     set payment_id = p_payment_id,
         status = 'linked',
         linked_at = now()
   where operation_key = p_operation_key
     and invoice_id = p_invoice_id
     and tenant_id = p_tenant_id
     and payment_id is null
     and status = 'staged';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public._link_staged_payment_attachments(uuid, text, uuid, uuid) from public, anon, authenticated;

-- ── 3b. record_manual_invoice_payment: +p_operation_key, optional ref ─
drop function if exists public.record_manual_invoice_payment(uuid, numeric, text, timestamptz, text, text);

create or replace function public.record_manual_invoice_payment(
  p_invoice_id       uuid,
  p_amount           numeric,
  p_reference        text        default null,
  p_paid_at          timestamptz default now(),
  p_method           text        default 'eft',
  p_note             text        default null,
  p_operation_key    text        default null
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

  -- amount: positive, <= 2dp, no silent rounding
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

  -- p_reference is OPTIONAL. When present it still acts as an idempotency
  -- + duplicate-detection key (see below). p_operation_key is the primary
  -- retry-safe key; the client generates it once per attempt.

  -- ── replay by operation key (same invoice + key) ────────────────
  if v_opkey is not null then
    select * into v_existing
    from public.invoice_payments
    where invoice_id = p_invoice_id and source = 'manual' and client_operation_key = v_opkey
    limit 1;
    if found then
      if round(v_existing.amount, 2) <> v_amount
         or v_existing.paid_at::date is distinct from v_paid_at::date
         or coalesce(v_existing.method, '') is distinct from coalesce(v_method, 'eft')
         or coalesce(v_existing.reference, '') is distinct from coalesce(v_ref, '')
      then
        raise exception using errcode = 'P0001',
          message = 'INVOICE_PAYMENT_OPERATION_CONFLICT: this operation key is already recorded with different amount / date / method / reference';
      end if;
      v_proof_count := public._link_staged_payment_attachments(p_invoice_id, v_opkey, v_existing.id, v_invoice.tenant_id);
      return jsonb_build_object(
        'ok', true, 'replayed', true, 'payment_id', v_existing.id,
        'proof_linked', v_proof_count,
        'projection', public._invoice_payment_projection(p_invoice_id));
    end if;
  end if;

  -- ── replay by real reference (same invoice + reference) ─────────
  if v_ref is not null then
    select * into v_existing
    from public.invoice_payments
    where invoice_id = p_invoice_id and source = 'manual' and reference = v_ref
    limit 1;
    if found then
      if round(v_existing.amount, 2) <> v_amount
         or v_existing.paid_at::date is distinct from v_paid_at::date
         or coalesce(v_existing.method, '') is distinct from coalesce(v_method, 'eft')
      then
        raise exception using errcode = 'P0001',
          message = 'INVOICE_PAYMENT_IDEMPOTENCY_CONFLICT: this reference is already recorded with different amount / date / method';
      end if;
      v_proof_count := public._link_staged_payment_attachments(p_invoice_id, v_opkey, v_existing.id, v_invoice.tenant_id);
      return jsonb_build_object(
        'ok', true, 'replayed', true, 'payment_id', v_existing.id,
        'proof_linked', v_proof_count,
        'projection', public._invoice_payment_projection(p_invoice_id));
    end if;
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
        'note',         v_note,
        'recorded_via', 'record_manual_invoice_payment'
      ))
    )
    returning id into v_row_id;
  exception when unique_violation then
    -- a concurrent identical submit won the race on _manual_opkey_once
    -- or _manual_ref_once → treat as a replay (no 2nd row, no 2nd event)
    select id into v_row_id
    from public.invoice_payments
    where invoice_id = p_invoice_id and source = 'manual'
      and (
        (v_opkey is not null and client_operation_key = v_opkey)
        or (v_ref is not null and reference = v_ref)
      )
    limit 1;
    if v_row_id is null then raise; end if;
    v_proof_count := public._link_staged_payment_attachments(p_invoice_id, v_opkey, v_row_id, v_invoice.tenant_id);
    return jsonb_build_object(
      'ok', true, 'replayed', true, 'payment_id', v_row_id,
      'proof_linked', v_proof_count,
      'projection', public._invoice_payment_projection(p_invoice_id));
  end;

  -- trg_invoice_payments_refresh_cache has refreshed the cache columns.

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

comment on function public.record_manual_invoice_payment(uuid, numeric, text, timestamptz, text, text, text) is
  'Records ONE off-platform invoice payment in a single transaction: ledger row (source=manual) -> P1A cache trigger -> safe payment-cycle status mirror -> staged proof-of-payment link -> one opps_invoice_activity row. Finance staff only, tenant enforced, invoice locked FOR UPDATE. p_amount is a new payment (2dp, no silent rounding). p_reference (bank/receipt) is OPTIONAL; when given it is a duplicate-detection + idempotency key. p_operation_key is the primary retry-safe key: same (invoice, key) + same amount/date/method/reference returns the original payment (and re-links its staged proof) with no second row or event; conflicting details reject; different keys allow separate intentional identical payments. Server generates the payment UUID. Rejects overpayment beyond R0.02, unreconciled linked-order platform payments, missing bridge schema (fail closed), and never overwrites draft/void/exported/imported_to_zoho status. Any failure (status mirror, proof link, or audit insert) rolls the payment back.';

-- ── 4. attach_payment_proof: add proof to an already-recorded payment ─
create or replace function public.attach_payment_proof(
  p_payment_id   uuid,
  p_storage_path text,
  p_filename     text default null,
  p_mime_type    text default null,
  p_byte_size    bigint default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_payment public.invoice_payments%rowtype;
  v_att_id  uuid;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'INVOICE_PAYMENT_AUTH_REQUIRED';
  end if;

  select * into v_payment from public.invoice_payments where id = p_payment_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'INVOICE_PAYMENT_NOT_FOUND';
  end if;

  if not public.can_access_tenant(v_payment.tenant_id)
     or not (public.is_app_admin() or public.user_finance_level() in (1, 2))
  then
    raise exception using errcode = 'P0001', message = 'INVOICE_PAYMENT_ACCESS_DENIED';
  end if;

  -- the guard trigger re-checks tenant scoping of the path + mime/size
  insert into public.payment_attachments (
    invoice_id, payment_id, operation_key, storage_bucket, storage_path,
    filename, mime_type, byte_size, status, uploaded_by, linked_at
  ) values (
    v_payment.invoice_id, p_payment_id, null, 'uploads', p_storage_path,
    nullif(btrim(coalesce(p_filename, '')), ''),
    lower(nullif(btrim(coalesce(p_mime_type, '')), '')),
    p_byte_size, 'linked', v_user_id, now()
  )
  returning id into v_att_id;

  insert into public.opps_invoice_activity (
    invoice_id, tenant_id, activity_type, activity_label, activity_note,
    from_status, to_status, metadata, created_by
  ) values (
    v_payment.invoice_id, v_payment.tenant_id,
    'invoice_payment_proof_added', 'Proof of payment added',
    coalesce(nullif(btrim(coalesce(p_filename, '')), ''), 'attachment'),
    null, null,
    jsonb_strip_nulls(jsonb_build_object(
      'payment_id', p_payment_id, 'attachment_id', v_att_id,
      'filename', p_filename, 'mime_type', p_mime_type, 'actor', v_user_id
    )),
    v_user_id
  );

  return jsonb_build_object('ok', true, 'attachment_id', v_att_id);
end;
$$;

revoke all on function public.attach_payment_proof(uuid, text, text, text, bigint) from public, anon;
grant execute on function public.attach_payment_proof(uuid, text, text, text, bigint) to authenticated;

-- ── 4b. supersede_payment_attachment: retire a linked proof (auditable) ─
create or replace function public.supersede_payment_attachment(
  p_attachment_id uuid,
  p_reason        text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_att     public.payment_attachments%rowtype;
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'INVOICE_PAYMENT_AUTH_REQUIRED';
  end if;
  if v_reason is null then
    raise exception using errcode = 'P0001', message = 'PAYMENT_ATTACHMENT_REASON_REQUIRED';
  end if;

  select * into v_att from public.payment_attachments where id = p_attachment_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'PAYMENT_ATTACHMENT_NOT_FOUND';
  end if;

  -- retiring a linked proof is finance/admin only (ordinary staff cannot)
  if not public.can_access_tenant(v_att.tenant_id)
     or not (public.is_app_admin() or public.user_finance_level() in (1, 2))
  then
    raise exception using errcode = 'P0001', message = 'INVOICE_PAYMENT_ACCESS_DENIED';
  end if;

  if v_att.status = 'superseded' then
    return jsonb_build_object('ok', true, 'already', true, 'attachment_id', v_att.id);
  end if;

  update public.payment_attachments
     set status = 'superseded', superseded_by = v_user_id,
         supersede_reason = v_reason, superseded_at = now()
   where id = p_attachment_id;

  insert into public.opps_invoice_activity (
    invoice_id, tenant_id, activity_type, activity_label, activity_note,
    from_status, to_status, metadata, created_by
  ) values (
    v_att.invoice_id, v_att.tenant_id,
    'invoice_payment_proof_superseded', 'Proof of payment retired',
    v_reason, null, null,
    jsonb_strip_nulls(jsonb_build_object(
      'payment_id', v_att.payment_id, 'attachment_id', v_att.id,
      'reason', v_reason, 'actor', v_user_id
    )),
    v_user_id
  );

  return jsonb_build_object('ok', true, 'attachment_id', v_att.id);
end;
$$;

revoke all on function public.supersede_payment_attachment(uuid, text) from public, anon;
grant execute on function public.supersede_payment_attachment(uuid, text) to authenticated;

commit;
