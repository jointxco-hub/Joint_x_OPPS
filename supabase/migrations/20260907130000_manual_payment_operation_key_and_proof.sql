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
-- SECURITY MODEL (corrected):
--   * payment_attachments takes NO direct INSERT/UPDATE/DELETE from
--     `authenticated`. Every mutation goes through a SECURITY DEFINER RPC
--     (stage_payment_proof / remove_staged_payment_proof /
--     cleanup_abandoned_payment_proof / attach_payment_proof /
--     supersede_payment_attachment) or the internal
--     _link_staged_payment_attachments. `authenticated` keeps SELECT only,
--     tenant + finance scoped (retired proof stays visible to finance).
--   * A BEFORE trigger makes tenant / invoice / storage identity /
--     operation key immutable after creation, restricts status to
--     staged -> linked -> superseded, refuses to unlink or reassign a
--     linked proof, refuses to delete anything not `staged`, and refuses a
--     status flip to `superseded` that is missing the reason/actor audit
--     fields — so no raw UPDATE can bypass the audited RPC.
--   * stage_payment_proof / attach_payment_proof verify the referenced
--     object ACTUALLY EXISTS in the private `uploads` bucket, sits under
--     this invoice tenant's prefix AND under this payment operation's own
--     folder, and (when the storage service recorded an uploader) was
--     uploaded by the acting staff user. A tenant-prefixed string alone is
--     not accepted; another operation's staged file cannot be claimed.
--   * A stable client operation key is REQUIRED for every new manual
--     payment. The external bank/receipt reference stays optional and is
--     never fabricated.
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
  if to_regclass('storage.objects') is null then
    raise exception 'MANUAL_PAYMENT_PROOF: storage.objects is missing — Supabase storage schema not present';
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
  'Stable per-attempt key generated once by the client and reused on retry. Internal idempotency only — NOT a bank/receipt reference. REQUIRED for every new manual payment (legacy rows may be NULL). Enforced by invoice_payments_manual_opkey_once.';

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
  object_verified_at timestamptz,
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

create index if not exists payment_attachments_payment_idx on public.payment_attachments (payment_id);
create index if not exists payment_attachments_invoice_idx on public.payment_attachments (invoice_id);
create index if not exists payment_attachments_tenant_idx  on public.payment_attachments (tenant_id);
create index if not exists payment_attachments_opkey_idx   on public.payment_attachments (operation_key) where operation_key is not null;
-- one storage object -> at most one attachment row (no shared / re-referenced files)
create unique index if not exists payment_attachments_path_once on public.payment_attachments (storage_path);

comment on table public.payment_attachments is
  'Private proof-of-payment files (JPG/PNG/PDF, <=15MB) for a specific invoice_payments row. Staged under operation_key first, then linked in the same transaction as the ledger row. Writes are RPC-only; SELECT is finance + tenant scoped. Private uploads bucket + signed URLs only. Supporting evidence — NOT proof that funds have cleared.';

-- ── 2b. immutability / lifecycle trigger ───────────────────────────
-- Fires for the RPCs too: it validates the SHAPE of every change, so no
-- caller (RPC bug, superuser slip, or a would-be raw UPDATE) can corrupt
-- identity or skip the audited path.
create or replace function public._payment_attachments_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid;
  v_path_tenant uuid;
begin
  if tg_op = 'DELETE' then
    if old.status <> 'staged' or old.payment_id is not null then
      raise exception using errcode = 'P0001',
        message = 'PAYMENT_ATTACHMENT_LINKED_IMMUTABLE: a linked or superseded proof of payment cannot be deleted';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    select tenant_id into v_tenant from public.opps_invoices where id = new.invoice_id;
    if v_tenant is null then
      raise exception using errcode = '23503', message = 'PAYMENT_ATTACHMENT_INVOICE_NOT_FOUND';
    end if;
    new.tenant_id := v_tenant;
    new.storage_path := btrim(coalesce(new.storage_path, ''));
    v_path_tenant := public.private_upload_path_tenant_id(new.storage_path);
    if v_path_tenant is null or v_path_tenant <> v_tenant then
      raise exception using errcode = 'P0001',
        message = 'PAYMENT_ATTACHMENT_PATH_NOT_TENANT_SCOPED: the storage path must live under this invoice tenant''s private prefix';
    end if;
    if new.payment_id is not null then
      if not exists (
        select 1 from public.invoice_payments p
        where p.id = new.payment_id and p.invoice_id = new.invoice_id and p.tenant_id = v_tenant
      ) then
        raise exception using errcode = '23503', message = 'PAYMENT_ATTACHMENT_PAYMENT_MISMATCH';
      end if;
      if new.status = 'linked' and new.linked_at is null then new.linked_at := now(); end if;
    end if;
    if new.status not in ('staged', 'linked') then
      raise exception using errcode = 'P0001', message = 'PAYMENT_ATTACHMENT_BAD_INITIAL_STATUS';
    end if;
    return new;
  end if;

  -- UPDATE: identity columns never change after creation
  if new.tenant_id       is distinct from old.tenant_id
     or new.invoice_id     is distinct from old.invoice_id
     or new.storage_bucket is distinct from old.storage_bucket
     or new.storage_path   is distinct from old.storage_path
     or new.operation_key  is distinct from old.operation_key
     or new.uploaded_by    is distinct from old.uploaded_by
     or new.created_at     is distinct from old.created_at
  then
    raise exception using errcode = 'P0001',
      message = 'PAYMENT_ATTACHMENT_IDENTITY_IMMUTABLE: tenant / invoice / storage identity / operation key / uploader cannot change after creation';
  end if;

  -- payment_id: NULL -> uuid exactly once; never reassigned or cleared
  if old.payment_id is not null and new.payment_id is distinct from old.payment_id then
    raise exception using errcode = 'P0001',
      message = 'PAYMENT_ATTACHMENT_PAYMENT_IMMUTABLE: a proof already linked to a payment cannot be reassigned or unlinked';
  end if;
  if new.payment_id is not null and not exists (
    select 1 from public.invoice_payments p
    where p.id = new.payment_id and p.invoice_id = new.invoice_id and p.tenant_id = new.tenant_id
  ) then
    raise exception using errcode = '23503', message = 'PAYMENT_ATTACHMENT_PAYMENT_MISMATCH';
  end if;

  -- status: staged -> linked -> superseded, or an idempotent no-op
  if not (
       new.status = old.status
    or (old.status = 'staged' and new.status = 'linked')
    or (old.status = 'linked' and new.status = 'superseded')
  ) then
    raise exception using errcode = 'P0001',
      message = format('PAYMENT_ATTACHMENT_BAD_TRANSITION: %s -> %s is not allowed', old.status, new.status);
  end if;

  if new.status = 'linked' and old.status = 'staged' then
    if new.payment_id is null then
      raise exception using errcode = 'P0001', message = 'PAYMENT_ATTACHMENT_LINK_NEEDS_PAYMENT';
    end if;
    if new.linked_at is null then new.linked_at := now(); end if;
  end if;

  if new.status = 'superseded' and old.status = 'linked' then
    if new.supersede_reason is null or btrim(new.supersede_reason) = '' or new.superseded_by is null then
      raise exception using errcode = 'P0001',
        message = 'PAYMENT_ATTACHMENT_SUPERSEDE_NEEDS_AUDIT: a reason and actor are required to retire a linked proof';
    end if;
    if new.superseded_at is null then new.superseded_at := now(); end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_payment_attachments_guard on public.payment_attachments;
drop trigger if exists trg_payment_attachments_immutable on public.payment_attachments;
create trigger trg_payment_attachments_immutable
  before insert or update or delete on public.payment_attachments
  for each row execute function public._payment_attachments_immutable();

alter table public.payment_attachments enable row level security;

-- SELECT only, finance + tenant scoped. Retired (superseded) rows stay
-- visible so authorized finance staff keep the audit trail.
drop policy if exists payment_attachments_staff_only on public.payment_attachments;
drop policy if exists payment_attachments_finance_tenant on public.payment_attachments;
drop policy if exists payment_attachments_delete_staged_only on public.payment_attachments;
drop policy if exists payment_attachments_staff_select on public.payment_attachments;
drop policy if exists payment_attachments_finance_tenant_select on public.payment_attachments;

create policy payment_attachments_staff_select
  on public.payment_attachments as restrictive for select to authenticated
  using (public.is_opps_staff());

create policy payment_attachments_finance_tenant_select
  on public.payment_attachments for select to authenticated
  using ((public.is_app_admin() or public.user_finance_level() in (1, 2)) and public.can_access_tenant(tenant_id));

-- writes are RPC-only
revoke insert, update, delete, truncate on public.payment_attachments from authenticated, anon, public;
grant select on public.payment_attachments to authenticated;

-- ── 3. internal helpers ────────────────────────────────────────────
create or replace function public._link_staged_payment_attachments(
  p_invoice_id uuid, p_operation_key text, p_payment_id uuid, p_tenant_id uuid
)
returns integer
language plpgsql volatile security definer
set search_path = pg_catalog, public
as $$
declare v_count integer := 0;
begin
  if p_operation_key is null then return 0; end if;
  update public.payment_attachments
     set payment_id = p_payment_id, status = 'linked', linked_at = now()
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

-- Raise INVOICE_PAYMENT_OPERATION_CONFLICT unless p_row matches this
-- request on amount / date / method / reference / operation key.
create or replace function public._assert_manual_payment_matches(
  p_row public.invoice_payments,
  p_amount numeric, p_paid_at timestamptz,
  p_method text, p_ref text, p_opkey text
)
returns void
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if round(p_row.amount, 2) <> round(p_amount, 2)
     or p_row.paid_at::date is distinct from p_paid_at::date
     or coalesce(p_row.method, '')    is distinct from coalesce(p_method, 'eft')
     or coalesce(p_row.reference, '')  is distinct from coalesce(p_ref, '')
     or coalesce(p_row.client_operation_key, '') is distinct from coalesce(p_opkey, '')
  then
    raise exception using errcode = 'P0001',
      message = 'INVOICE_PAYMENT_OPERATION_CONFLICT: this operation key is already recorded with different amount / date / method / reference';
  end if;
end;
$$;
revoke all on function public._assert_manual_payment_matches(public.invoice_payments, numeric, timestamptz, text, text, text) from public, anon, authenticated;

-- ── 3b. record_manual_invoice_payment (operation key required) ──────
drop function if exists public.record_manual_invoice_payment(uuid, numeric, text, timestamptz, text, text);

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

comment on function public.record_manual_invoice_payment(uuid, numeric, text, timestamptz, text, text, text) is
  'Records ONE off-platform invoice payment in a single transaction: ledger row (source=manual) -> P1A cache trigger -> safe payment-cycle status mirror -> staged proof link -> one opps_invoice_activity row. Finance staff only, tenant enforced, invoice locked FOR UPDATE. p_operation_key is REQUIRED and must be reused on retry: same (invoice, key) + identical amount/date/method/reference returns the original payment (re-linking any staged proof) with no second row/event; different details -> INVOICE_PAYMENT_OPERATION_CONFLICT. p_reference (bank/receipt) is OPTIONAL and never fabricated; a reference already used on the invoice by a DIFFERENT operation -> INVOICE_PAYMENT_IDEMPOTENCY_CONFLICT (never a silent replay/proof attach). Different keys with no reference may record two intentional identical payments. Server generates the payment UUID. Overpayment (>R0.02), unreconciled linked-order platform payments, and a missing order/payment bridge (fail closed) all reject; draft/void/exported/imported_to_zoho status is never overwritten. Any downstream failure rolls the payment back.';

-- ── 4. stage_payment_proof ─────────────────────────────────────────
create or replace function public.stage_payment_proof(
  p_invoice_id    uuid,
  p_operation_key text,
  p_storage_path  text,
  p_filename      text default null,
  p_mime_type     text default null,
  p_byte_size     bigint default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, storage
as $$
declare
  v_user_id   uuid := auth.uid();
  v_tenant    uuid;
  v_opkey     text := nullif(btrim(p_operation_key), '');
  v_seg       text;
  v_path      text := btrim(coalesce(p_storage_path, ''));
  v_mime      text := lower(nullif(btrim(coalesce(p_mime_type, '')), ''));
  v_obj_owner text;
  v_att_id    uuid;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'INVOICE_PAYMENT_AUTH_REQUIRED';
  end if;
  if v_opkey is null then
    raise exception using errcode = 'P0001', message = 'PAYMENT_ATTACHMENT_OPERATION_KEY_REQUIRED';
  end if;

  select tenant_id into v_tenant from public.opps_invoices where id = p_invoice_id;
  if v_tenant is null then
    raise exception using errcode = 'P0001', message = 'INVOICE_NOT_FOUND';
  end if;
  if not public.can_access_tenant(v_tenant)
     or not (public.is_app_admin() or public.user_finance_level() in (1, 2))
  then
    raise exception using errcode = 'P0001', message = 'INVOICE_PAYMENT_ACCESS_DENIED';
  end if;

  -- the file must sit under this tenant AND this operation's own folder
  v_seg := regexp_replace(v_opkey, '[^a-zA-Z0-9._-]', '_', 'g');
  if public.private_upload_path_tenant_id(v_path) is distinct from v_tenant
     or position(v_tenant::text || '/finance/payment-proof/' || v_seg || '/' in v_path) <> 1
  then
    raise exception using errcode = 'P0001',
      message = 'PAYMENT_ATTACHMENT_PATH_NOT_OPERATION_SCOPED: the file must be uploaded under this invoice tenant and this payment operation''s private folder';
  end if;

  -- the object must ACTUALLY exist in the private uploads bucket
  select owner_id into v_obj_owner
  from storage.objects
  where bucket_id = 'uploads' and name = v_path
  limit 1;
  if not found then
    raise exception using errcode = 'P0001',
      message = 'PAYMENT_ATTACHMENT_OBJECT_NOT_FOUND: no matching private upload exists for this path';
  end if;
  if v_obj_owner is not null and v_obj_owner <> v_user_id::text then
    raise exception using errcode = 'P0001',
      message = 'PAYMENT_ATTACHMENT_OBJECT_NOT_OWNED: this file was uploaded by another user';
  end if;

  if v_mime is not null and v_mime not in ('image/jpeg', 'image/jpg', 'image/png', 'application/pdf') then
    raise exception using errcode = 'P0001', message = 'PAYMENT_ATTACHMENT_BAD_TYPE';
  end if;
  if p_byte_size is not null and (p_byte_size <= 0 or p_byte_size > 15 * 1024 * 1024) then
    raise exception using errcode = 'P0001', message = 'PAYMENT_ATTACHMENT_TOO_LARGE';
  end if;

  insert into public.payment_attachments (
    invoice_id, operation_key, storage_bucket, storage_path,
    filename, mime_type, byte_size, status, uploaded_by, object_verified_at
  ) values (
    p_invoice_id, v_opkey, 'uploads', v_path,
    nullif(btrim(coalesce(p_filename, '')), ''), v_mime, p_byte_size,
    'staged', v_user_id, now()
  )
  returning id into v_att_id;

  return jsonb_build_object('ok', true, 'attachment_id', v_att_id);
end;
$$;

revoke all on function public.stage_payment_proof(uuid, text, text, text, text, bigint) from public, anon;
grant execute on function public.stage_payment_proof(uuid, text, text, text, text, bigint) to authenticated;

-- ── 4b. remove_staged_payment_proof ────────────────────────────────
create or replace function public.remove_staged_payment_proof(p_attachment_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_att     public.payment_attachments%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'INVOICE_PAYMENT_AUTH_REQUIRED';
  end if;

  select * into v_att from public.payment_attachments where id = p_attachment_id for update;
  if not found then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if not public.can_access_tenant(v_att.tenant_id)
     or not (public.is_app_admin() or public.user_finance_level() in (1, 2))
  then
    raise exception using errcode = 'P0001', message = 'INVOICE_PAYMENT_ACCESS_DENIED';
  end if;
  if v_att.status <> 'staged' or v_att.payment_id is not null then
    raise exception using errcode = 'P0001',
      message = 'PAYMENT_ATTACHMENT_LINKED_IMMUTABLE: only an unlinked staged proof can be removed — retire a linked one instead';
  end if;

  delete from public.payment_attachments where id = p_attachment_id;
  return jsonb_build_object('ok', true, 'storage_bucket', v_att.storage_bucket, 'storage_path', v_att.storage_path);
end;
$$;

revoke all on function public.remove_staged_payment_proof(uuid) from public, anon;
grant execute on function public.remove_staged_payment_proof(uuid) to authenticated;

-- ── 4c. cleanup_abandoned_payment_proof ────────────────────────────
-- Bounded sweep of a SINGLE operation's abandoned staged uploads. Cannot
-- touch linked or superseded evidence. Age floor 5 minutes so it can
-- never race a live confirm. Returns the storage paths for the client to
-- delete the objects.
create or replace function public.cleanup_abandoned_payment_proof(
  p_operation_key      text,
  p_older_than_minutes integer default 30
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_opkey   text := nullif(btrim(p_operation_key), '');
  v_cutoff  timestamptz;
  v_paths   text[] := '{}';
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'INVOICE_PAYMENT_AUTH_REQUIRED';
  end if;
  if v_opkey is null then
    raise exception using errcode = 'P0001', message = 'PAYMENT_ATTACHMENT_OPERATION_KEY_REQUIRED';
  end if;
  v_cutoff := now() - make_interval(mins => greatest(coalesce(p_older_than_minutes, 30), 5));

  with removed as (
    delete from public.payment_attachments
     where operation_key = v_opkey
       and payment_id is null
       and status = 'staged'
       and created_at < v_cutoff
       and public.can_access_tenant(tenant_id)
       and (public.is_app_admin() or public.user_finance_level() in (1, 2))
     returning storage_path
  )
  select coalesce(array_agg(storage_path), '{}') into v_paths from removed;

  return jsonb_build_object('ok', true, 'removed', to_jsonb(v_paths));
end;
$$;

revoke all on function public.cleanup_abandoned_payment_proof(text, integer) from public, anon;
grant execute on function public.cleanup_abandoned_payment_proof(text, integer) to authenticated;

-- ── 4d. attach_payment_proof: proof for an already-recorded payment ─
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
set search_path = pg_catalog, public, storage
as $$
declare
  v_user_id uuid := auth.uid();
  v_payment public.invoice_payments%rowtype;
  v_path    text := btrim(coalesce(p_storage_path, ''));
  v_mime    text := lower(nullif(btrim(coalesce(p_mime_type, '')), ''));
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

  if public.private_upload_path_tenant_id(v_path) is distinct from v_payment.tenant_id
     or position(v_payment.tenant_id::text || '/finance/payment-proof/late-' || p_payment_id::text || '/' in v_path) <> 1
  then
    raise exception using errcode = 'P0001',
      message = 'PAYMENT_ATTACHMENT_PATH_NOT_OPERATION_SCOPED: the file must be uploaded under this payment''s private folder';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'uploads' and name = v_path) then
    raise exception using errcode = 'P0001',
      message = 'PAYMENT_ATTACHMENT_OBJECT_NOT_FOUND: no matching private upload exists for this path';
  end if;
  if v_mime is not null and v_mime not in ('image/jpeg', 'image/jpg', 'image/png', 'application/pdf') then
    raise exception using errcode = 'P0001', message = 'PAYMENT_ATTACHMENT_BAD_TYPE';
  end if;
  if p_byte_size is not null and (p_byte_size <= 0 or p_byte_size > 15 * 1024 * 1024) then
    raise exception using errcode = 'P0001', message = 'PAYMENT_ATTACHMENT_TOO_LARGE';
  end if;

  insert into public.payment_attachments (
    invoice_id, payment_id, operation_key, storage_bucket, storage_path,
    filename, mime_type, byte_size, status, uploaded_by, linked_at, object_verified_at
  ) values (
    v_payment.invoice_id, p_payment_id, null, 'uploads', v_path,
    nullif(btrim(coalesce(p_filename, '')), ''), v_mime, p_byte_size,
    'linked', v_user_id, now(), now()
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

-- ── 4e. supersede_payment_attachment: retire a linked proof (audited) ─
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
  if not public.can_access_tenant(v_att.tenant_id)
     or not (public.is_app_admin() or public.user_finance_level() in (1, 2))
  then
    raise exception using errcode = 'P0001', message = 'INVOICE_PAYMENT_ACCESS_DENIED';
  end if;
  if v_att.status = 'superseded' then
    return jsonb_build_object('ok', true, 'already', true, 'attachment_id', v_att.id);
  end if;
  if v_att.status <> 'linked' then
    raise exception using errcode = 'P0001',
      message = 'PAYMENT_ATTACHMENT_NOT_LINKED: only a linked proof can be retired — remove a staged one instead';
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
