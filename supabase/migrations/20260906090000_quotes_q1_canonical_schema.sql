-- ════════════════════════════════════════════════════════════════════
--  QUOTES Q1 — CANONICAL QUOTE SCHEMA
-- ════════════════════════════════════════════════════════════════════
--
-- The first, distinct commercial-record foundation for
--   QUOTE -> CLIENT ACCEPTANCE -> ORDER -> INVOICE -> PAYMENT
-- (see the Phase 0 audit). Q1 is SCHEMA ONLY:
--   * no frontend
--   * no /q/:token share or public route  (Q4)
--   * no accept / request-changes / decline RPC  (Q4)
--   * no quote -> order conversion  (Q5)
--   * no change to opps_invoices / opps_invoice_items / invoice_payments
--     / any invoice status / any PayFast or reconciliation path
--
-- A quote is NOT an invoice in another status. `opps_invoices.status`
-- gains no 'quote' value here or anywhere.
--
-- Adds:
--   public.opps_quote_number_config       per-tenant number prefix + pad width
--   public.opps_quote_number_sequences    tenant + year sequence allocation
--   public._next_quote_number(uuid)        allocator -> e.g. QT-2026-000001
--   public.opps_quotes                     quote header (mutable working copy)
--   public.opps_quote_items                mutable working line items
--   public.opps_quote_revisions            APPEND-ONLY immutable snapshots
--   public.opps_quote_events               APPEND-ONLY acceptance / activity audit
--   public._quote_item_price_breakdown(jsonb)   customer-safe composed-pricing projector
--   public._quote_document_projection(uuid)     the ONE customer-safe quote shape
--   public.save_opps_quote_with_items(...)  staff editor entry point; every
--                                           successful save appends a new
--                                           immutable revision snapshot
--
-- RLS mirrors the accepted OPPS invoice/finance discipline verbatim
-- (restrictive is_opps_staff() + permissive
--  (is_app_admin() OR user_finance_level() IN (1,2)) AND can_access_tenant()).
-- Depends on helpers already live in production:
--   is_opps_staff()            20260817173001_xos_opps_staff_authority.sql
--   is_app_admin()             202606230006_fix_internal_order_access.sql
--   user_finance_level()       20260523_finance_rls_tighten.sql
--   can_access_tenant(uuid)    202606200001_multi_tenant_foundation.sql
--   opps_invoicing_touch_updated_at()   202606180001_opps_invoicing.sql
--
-- Circular FK (opps_quotes.current_revision_id / accepted_revision_id  <->
-- opps_quote_revisions.quote_id) is resolved by DDL order: the header is
-- created with those two columns as plain uuid, the revisions table is
-- created referencing the header, then the two FKs are added by ALTER.
--
-- STAGING-FIRST. NOT APPLIED. NO PRODUCTION. NO DEPLOY. NO PUSH.
-- ════════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ===================================================================
-- 1. TENANT / YEAR QUOTE-NUMBER ALLOCATION
--    The immutable identity of a quote is opps_quotes.id (uuid).
--    quote_number is a per-tenant DISPLAY label, unique only within a
--    tenant. The prefix is per-tenant configuration, never hardcoded:
--    a future tenant can be given its own prefix without any existing
--    quote's id or quote_number changing.
-- ===================================================================
create table if not exists public.opps_quote_number_config (
  tenant_id   uuid primary key references public.tenants(id) on delete cascade,
  prefix      text not null default 'QT'
                check (prefix ~ '^[A-Z][A-Z0-9]{0,7}$'),
  pad_width   smallint not null default 6 check (pad_width between 3 and 12),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.opps_quote_number_config is
  'Per-tenant quote-number formatting. prefix defaults to QT; an admin may set a tenant-specific prefix later. Changing it never alters an existing quote_number or opps_quotes.id.';

create table if not exists public.opps_quote_number_sequences (
  tenant_id    uuid not null references public.tenants(id) on delete restrict,
  year         integer not null,
  last_number  integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (tenant_id, year)
);

comment on table public.opps_quote_number_sequences is
  'Quote-number allocation counter, scoped per (tenant_id, year). Never a global business sequence.';

-- Allocator. security definer: bumps the tenant/year counter and formats
-- the label. Caller must be able to access the tenant.
create or replace function public._next_quote_number(p_tenant_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_year    integer := extract(year from now())::integer;
  v_prefix  text;
  v_pad     smallint;
  v_next    integer;
begin
  if p_tenant_id is null or not public.can_access_tenant(p_tenant_id) then
    raise exception using errcode = 'P0001', message = 'QUOTE_NUMBER_TENANT_DENIED';
  end if;

  insert into public.opps_quote_number_config (tenant_id)
  values (p_tenant_id)
  on conflict (tenant_id) do nothing;

  select prefix, pad_width into v_prefix, v_pad
  from public.opps_quote_number_config
  where tenant_id = p_tenant_id;

  insert into public.opps_quote_number_sequences (tenant_id, year, last_number)
  values (p_tenant_id, v_year, 1)
  on conflict (tenant_id, year) do update
    set last_number = public.opps_quote_number_sequences.last_number + 1,
        updated_at  = now()
  returning last_number into v_next;

  return v_prefix || '-' || v_year::text || '-' || lpad(v_next::text, v_pad, '0');
end;
$$;

revoke all on function public._next_quote_number(uuid) from public, anon, authenticated;
-- callable only from save_opps_quote_with_items (also security definer)
grant execute on function public._next_quote_number(uuid) to authenticated;

-- ===================================================================
-- 2. QUOTE HEADER  (revision FKs added in section 5)
-- ===================================================================
create table if not exists public.opps_quotes (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants(id) on delete restrict,
  quote_number            text not null,

  status                  text not null default 'draft'
                            check (status in (
                              'draft', 'sent', 'viewed', 'accepted',
                              'changes_requested', 'declined', 'expired', 'converted'
                            )),

  -- customer identity: any subset may be known (account client, known
  -- OPPS client without an account, or a bare name + email/WhatsApp lead)
  customer_id             uuid references public.clients(id) on delete set null,
  customer_name           text not null,
  customer_email          text,
  customer_phone          text,
  customer_whatsapp       text,
  customer_billing_address text,
  shipping_address        text,

  currency_code           text not null default 'ZAR',
  valid_until             date,
  payment_terms           text,
  reference_number        text,
  notes                   text,   -- STAFF ONLY. never projected.
  terms                   text,   -- customer-facing T&Cs

  subtotal                numeric not null default 0,
  discount_total          numeric not null default 0,
  shipping_charge         numeric not null default 0,
  tax_total               numeric not null default 0,
  total                   numeric not null default 0,
  total_override_reason   text,
  total_override_by       uuid references auth.users(id) on delete set null,
  total_override_at       timestamptz,

  -- revision pointers (FK constraints added in section 5)
  current_revision_id     uuid,
  accepted_revision_id    uuid,

  -- acceptance snapshot (populated by the Q4 accept RPC; columns exist now
  -- so Q4 adds no schema). accepted_revision_id points at an already
  -- immutable revision — acceptance never mutates a revision.
  accepted_at             timestamptz,
  accepted_actor_kind     text check (accepted_actor_kind in ('staff', 'customer', 'public_link', 'system')),
  accepted_actor_user_id  uuid references auth.users(id) on delete set null,
  accepted_ack_name       text,   -- typed full name (REQUIRED for public acceptance, enforced in Q4)
  accepted_ack_email      text,   -- optional / pre-filled when known

  -- lineage (soft references — no FK, to keep the quote domain decoupled
  -- from the X LAB intake table and the Q5 conversion targets)
  source_request_id       uuid,   -- -> public.client_quote_requests.id
  supersedes_quote_id     uuid references public.opps_quotes(id) on delete set null,
  converted_order_id      uuid,   -- -> public.orders.id  (Q5)
  converted_invoice_id    uuid references public.opps_invoices(id) on delete set null,

  -- P3-style share columns (verbatim shape from opps_invoices). Inert in
  -- Q1: no issue/revoke/rotate/get_public_quote RPC exists yet (Q4).
  share_token             text,
  share_expires_at        timestamptz,
  public_visible          boolean not null default false,
  share_revoked_at        timestamptz,

  created_by              uuid references auth.users(id) on delete set null,
  updated_by              uuid references auth.users(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint opps_quotes_tenant_number_key unique (tenant_id, quote_number),
  constraint opps_quotes_share_token_key   unique (share_token)
);

comment on column public.opps_quotes.id is
  'Immutable true identity of the quote. quote_number is a per-tenant display label only.';
comment on column public.opps_quotes.accepted_revision_id is
  'Points at an already-immutable opps_quote_revisions row. Set once, by the Q4 accept RPC. save_opps_quote_with_items never sets or clears it.';
comment on column public.opps_quotes.notes is
  'Internal staff notes. Never returned by _quote_document_projection().';

create index if not exists idx_opps_quotes_tenant_status_created
  on public.opps_quotes (tenant_id, status, created_at desc);
create index if not exists idx_opps_quotes_customer_id
  on public.opps_quotes (customer_id);
create index if not exists idx_opps_quotes_customer_email_lower
  on public.opps_quotes (lower(btrim(customer_email)))
  where customer_email is not null and btrim(customer_email) <> '';
create index if not exists idx_opps_quotes_source_request
  on public.opps_quotes (source_request_id)
  where source_request_id is not null;
create unique index if not exists idx_opps_quotes_share_token_active
  on public.opps_quotes (share_token)
  where share_token is not null;

drop trigger if exists trg_opps_quotes_updated_at on public.opps_quotes;
create trigger trg_opps_quotes_updated_at
  before update on public.opps_quotes
  for each row execute function public.opps_invoicing_touch_updated_at();

-- ===================================================================
-- 3. QUOTE WORKING LINE ITEMS  (the current mutable draft)
-- ===================================================================
create table if not exists public.opps_quote_items (
  id                        uuid primary key default gen_random_uuid(),
  quote_id                  uuid not null references public.opps_quotes(id) on delete cascade,
  tenant_id                 uuid not null references public.tenants(id) on delete restrict,
  line_number               integer not null,
  role                      text not null default 'product'
                              check (role in ('product', 'addon', 'setup_fee', 'shipping', 'discount')),
  item_name                 text not null,
  item_description           text,
  quantity                  numeric not null check (quantity > 0),
  unit                      text,
  rate                      numeric not null check (rate >= 0),
  discount                  numeric not null default 0 check (discount >= 0),
  tax_name                  text,
  tax_percentage            numeric not null default 0 check (tax_percentage >= 0),
  item_total                numeric not null,
  image_url                 text,   -- customer-safe artwork / mockup URL only
  -- staff provenance — NEVER enters a revision snapshot or the projection
  source_client_product_id  uuid,
  source_metadata           jsonb not null default '{}'::jsonb,
  created_at                timestamptz not null default now(),
  constraint opps_quote_items_quote_line_key unique (quote_id, line_number)
);

comment on column public.opps_quote_items.source_client_product_id is
  'Provenance for staff. Never projected, never copied into a revision snapshot.';
comment on column public.opps_quote_items.source_metadata is
  'May hold a composed price_breakdown. Only the customer-safe allowlist (via _quote_item_price_breakdown) is ever surfaced; raw source_metadata is never returned.';

create index if not exists idx_opps_quote_items_quote on public.opps_quote_items (quote_id);
create index if not exists idx_opps_quote_items_tenant on public.opps_quote_items (tenant_id);

-- ===================================================================
-- 4. QUOTE REVISIONS  (APPEND-ONLY, immutable snapshots)
-- ===================================================================
create table if not exists public.opps_quote_revisions (
  id               uuid primary key default gen_random_uuid(),
  quote_id         uuid not null references public.opps_quotes(id) on delete cascade,
  tenant_id        uuid not null references public.tenants(id) on delete restrict,
  revision_number  integer not null,
  -- FULL customer-safe frozen document: header allowlist + items[] + price
  -- breakdowns already projected. No tenant_id, customer_id, customer_email,
  -- notes, source_metadata or source_client_product_id ever enter here.
  snapshot         jsonb not null,
  totals           jsonb not null,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint opps_quote_revisions_quote_number_key unique (quote_id, revision_number)
);

comment on table public.opps_quote_revisions is
  'Append-only history. No UPDATE and no DELETE on any normal path (grants revoked + trigger enforced). Editing a quote changes opps_quotes / opps_quote_items and the next save_opps_quote_with_items appends a NEW revision. accepted_revision_id merely points at one of these already-immutable rows.';

create index if not exists idx_opps_quote_revisions_quote on public.opps_quote_revisions (quote_id, revision_number desc);

-- ===================================================================
-- 5. RESOLVE THE CIRCULAR FK  (header -> revisions)
-- ===================================================================
-- Postgres has no ADD CONSTRAINT IF NOT EXISTS. Guard each so this
-- historical migration re-runs cleanly on an environment that already
-- carries the Q1 schema (same name, same definition, same behaviour).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.opps_quotes'::regclass
      and conname  = 'opps_quotes_current_revision_fk'
  ) then
    alter table public.opps_quotes
      add constraint opps_quotes_current_revision_fk
        foreign key (current_revision_id) references public.opps_quote_revisions(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.opps_quotes'::regclass
      and conname  = 'opps_quotes_accepted_revision_fk'
  ) then
    alter table public.opps_quotes
      add constraint opps_quotes_accepted_revision_fk
        foreign key (accepted_revision_id) references public.opps_quote_revisions(id) on delete set null;
  end if;
end
$$;

-- ===================================================================
-- 6. QUOTE EVENTS  (APPEND-ONLY acceptance / activity audit)
--    Q1 defines the surface Q4's accept / request-changes / decline RPCs
--    will write; no RPC writes to it yet.
-- ===================================================================
create table if not exists public.opps_quote_events (
  id                uuid primary key default gen_random_uuid(),
  quote_id          uuid not null references public.opps_quotes(id) on delete cascade,
  tenant_id         uuid not null references public.tenants(id) on delete restrict,
  revision_id       uuid references public.opps_quote_revisions(id) on delete set null,
  event_type        text not null check (event_type in (
                      'created', 'sent', 'viewed', 'revised',
                      'accepted', 'changes_requested', 'declined',
                      'expired', 'converted',
                      'share_issued', 'share_revoked', 'share_rotated'
                    )),
  actor_kind        text not null check (actor_kind in ('staff', 'customer', 'system', 'public_link')),
  actor_user_id     uuid references auth.users(id) on delete set null,
  actor_label       text,   -- typed full name on a public action (REQUIRED for public acceptance, enforced in Q4)
  actor_email       text,   -- optional / pre-filled when known
  share_token_used  text,   -- which share token the public action came through
  ip_hash           text,   -- sha256(ip + rotating salt); never a raw IP
  user_agent        text,
  note              text,   -- customer's "request changes" message
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

comment on table public.opps_quote_events is
  'Append-only audit. A row with event_type=accepted + actor_kind + actor_label + created_at + revision_id + share_token_used IS the acceptance certificate for the Q4 public accept flow.';

create index if not exists idx_opps_quote_events_quote on public.opps_quote_events (quote_id, created_at desc);
create index if not exists idx_opps_quote_events_type on public.opps_quote_events (event_type);

-- ===================================================================
-- 7. INTEGRITY TRIGGERS
-- ===================================================================

-- 7a. tenant_id on every child row is FORCED from the parent quote,
--     never trusted from the caller (mirrors _invoice_payments_set_tenant).
create or replace function public._opps_quote_child_set_tenant()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.opps_quotes where id = new.quote_id;
  if v_tenant is null then
    raise exception using errcode = '23503', message = 'QUOTE_CHILD_QUOTE_NOT_FOUND';
  end if;
  new.tenant_id := v_tenant;
  return new;
end;
$$;

drop trigger if exists trg_opps_quote_items_set_tenant on public.opps_quote_items;
create trigger trg_opps_quote_items_set_tenant
  before insert or update on public.opps_quote_items
  for each row execute function public._opps_quote_child_set_tenant();

drop trigger if exists trg_opps_quote_revisions_set_tenant on public.opps_quote_revisions;
create trigger trg_opps_quote_revisions_set_tenant
  before insert or update on public.opps_quote_revisions
  for each row execute function public._opps_quote_child_set_tenant();

drop trigger if exists trg_opps_quote_events_set_tenant on public.opps_quote_events;
create trigger trg_opps_quote_events_set_tenant
  before insert or update on public.opps_quote_events
  for each row execute function public._opps_quote_child_set_tenant();

-- 7b. opps_quote_revisions is append-only for EVERY caller. UPDATE is
--     always refused. DELETE is refused unless it is a cascade from the
--     parent quote itself being deleted (parent already gone in-snapshot).
create or replace function public._opps_quote_revision_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception using errcode = 'P0001', message = 'QUOTE_REVISION_IMMUTABLE';
  end if;
  -- DELETE
  if exists (select 1 from public.opps_quotes q where q.id = old.quote_id) then
    raise exception using errcode = 'P0001', message = 'QUOTE_REVISION_IMMUTABLE';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_opps_quote_revision_immutable on public.opps_quote_revisions;
create trigger trg_opps_quote_revision_immutable
  before update or delete on public.opps_quote_revisions
  for each row execute function public._opps_quote_revision_immutable();

-- 7c. opps_quote_events is append-only: refuse UPDATE and non-cascade DELETE.
create or replace function public._opps_quote_event_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception using errcode = 'P0001', message = 'QUOTE_EVENT_IMMUTABLE';
  end if;
  if exists (select 1 from public.opps_quotes q where q.id = old.quote_id) then
    raise exception using errcode = 'P0001', message = 'QUOTE_EVENT_IMMUTABLE';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_opps_quote_event_immutable on public.opps_quote_events;
create trigger trg_opps_quote_event_immutable
  before update or delete on public.opps_quote_events
  for each row execute function public._opps_quote_event_immutable();

-- ===================================================================
-- 8. RLS  — mirrors public.invoice_payments verbatim
--    RESTRICTIVE is_opps_staff()  +  PERMISSIVE finance/admin + tenant
-- ===================================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'opps_quote_number_config',
    'opps_quote_number_sequences',
    'opps_quotes',
    'opps_quote_items',
    'opps_quote_revisions',
    'opps_quote_events'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists xos1_require_opps_staff on public.%I', t);
    execute format($f$
      create policy xos1_require_opps_staff on public.%I
        as restrictive for all to authenticated
        using (public.is_opps_staff()) with check (public.is_opps_staff())
    $f$, t);

    execute format('drop policy if exists tenant_finance_manage_%s on public.%I', t, t);
    execute format($f$
      create policy tenant_finance_manage_%s on public.%I
        for all to authenticated
        using ((public.is_app_admin() or public.user_finance_level() in (1, 2)) and public.can_access_tenant(tenant_id))
        with check ((public.is_app_admin() or public.user_finance_level() in (1, 2)) and public.can_access_tenant(tenant_id))
    $f$, t, t);

    -- start closed, then grant only what the contract needs
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- normal read/write tables (still fully gated by the two policies above)
grant select, insert, update, delete on public.opps_quote_number_config    to authenticated;
grant select, insert, update, delete on public.opps_quote_number_sequences to authenticated;
grant select, insert, update, delete on public.opps_quotes                 to authenticated;
grant select, insert, update, delete on public.opps_quote_items            to authenticated;

-- append-only tables: no UPDATE, no DELETE grant to anyone
grant select, insert on public.opps_quote_revisions to authenticated;
grant select, insert on public.opps_quote_events    to authenticated;

-- anon has no path to any quote table in Q1 (no public route until Q4)
revoke all on public.opps_quote_number_config    from anon;
revoke all on public.opps_quote_number_sequences from anon;
revoke all on public.opps_quotes                 from anon;
revoke all on public.opps_quote_items            from anon;
revoke all on public.opps_quote_revisions        from anon;
revoke all on public.opps_quote_events           from anon;

-- ===================================================================
-- 9. CUSTOMER-SAFE COMPOSED-PRICING PROJECTOR
--    Same allowlist principle as the invoice CommercialDocument model's
--    normalizePriceBreakdown / _xos_customer_invoice_item_breakdown:
--    label + amount + method + placement only. Never a cost, margin,
--    supplier, component id or procurement field, never raw metadata.
-- ===================================================================
create or replace function public._quote_item_price_breakdown(p_source_metadata jsonb)
returns jsonb
language plpgsql
immutable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_pb       jsonb := coalesce(p_source_metadata -> 'price_breakdown', 'null'::jsonb);
  v_per_unit jsonb;
begin
  if v_pb is null or jsonb_typeof(v_pb) <> 'object' then
    return null;
  end if;
  if coalesce(v_pb ->> 'mode', '') <> 'composed' then
    return null;
  end if;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'label',     coalesce(row_in ->> 'label', row_in ->> 'role', 'Item'),
             'role',      row_in ->> 'role',
             'amount',    round(coalesce(nullif(row_in ->> 'amount', '')::numeric, 0), 2),
             'method',    coalesce(row_in ->> 'production_method', row_in ->> 'method'),
             'placement', row_in ->> 'placement'
           )
           order by ord
         ), '[]'::jsonb)
    into v_per_unit
  from jsonb_array_elements(coalesce(v_pb -> 'per_unit', '[]'::jsonb)) with ordinality as t(row_in, ord)
  where coalesce(row_in ->> 'label', row_in ->> 'role', '') <> '';

  if v_per_unit = '[]'::jsonb then
    return null;
  end if;

  return jsonb_build_object(
    'per_unit',   v_per_unit,
    'reconciled', case when jsonb_typeof(v_pb -> 'reconciled') = 'boolean' then v_pb -> 'reconciled' else null end,
    'difference', case when jsonb_typeof(v_pb -> 'difference') = 'number'  then v_pb -> 'difference' else null end,
    'unit_price', case when jsonb_typeof(v_pb -> 'unit_price') = 'number'  then v_pb -> 'unit_price' else null end
  );
end;
$$;

revoke all on function public._quote_item_price_breakdown(jsonb) from public, anon, authenticated;

-- ===================================================================
-- 10. _quote_document_projection — the ONE customer-safe quote shape
--     the future buildQuoteDocumentModel() consumes. Reads the ACCEPTED
--     revision when present, else the current revision. Internal-only:
--     Q4's get_public_quote() / get_my_quotes() will call this after
--     gating identity, exactly as the invoice projection is used.
--
--     Never returns: tenant_id, customer_id, customer_email,
--     customer_phone, notes, source_client_product_id, raw source_metadata,
--     created_by / updated_by, source_request_id, converted_*,
--     share_token, total_override_*.
-- ===================================================================
create or replace function public._quote_document_projection(p_quote_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_quote    public.opps_quotes%rowtype;
  v_revision public.opps_quote_revisions%rowtype;
  v_snap     jsonb;
begin
  select * into v_quote from public.opps_quotes where id = p_quote_id;
  if not found then
    return null;
  end if;

  select * into v_revision
  from public.opps_quote_revisions
  where id = coalesce(v_quote.accepted_revision_id, v_quote.current_revision_id);
  if not found then
    return null;
  end if;

  -- The snapshot is already customer-safe by construction (see
  -- save_opps_quote_with_items). This projection re-emits it through an
  -- explicit allowlist so a future snapshot-shape change cannot leak.
  v_snap := v_revision.snapshot;

  return jsonb_build_object(
    'kind',                     'quote',
    'id',                       v_quote.id,
    'quote_number',             v_quote.quote_number,
    'status',                   v_quote.status,
    'created_date',             v_quote.created_at::date,
    'valid_until',              v_quote.valid_until,
    'currency_code',            coalesce(v_snap ->> 'currency_code', v_quote.currency_code),
    'payment_terms',            v_snap ->> 'payment_terms',
    'reference_number',         v_snap ->> 'reference_number',
    'terms',                    v_snap ->> 'terms',
    'revision_number',          v_revision.revision_number,
    'is_accepted_revision',     (v_quote.accepted_revision_id is not null
                                 and v_quote.accepted_revision_id = v_revision.id),
    'accepted_at',              v_quote.accepted_at,
    'customer_name',            coalesce(v_snap ->> 'customer_name', v_quote.customer_name),
    'customer_billing_address', v_snap ->> 'customer_billing_address',
    'shipping_address',         v_snap ->> 'shipping_address',
    'subtotal',                 coalesce(nullif(v_snap ->> 'subtotal', '')::numeric, 0),
    'discount_total',           coalesce(nullif(v_snap ->> 'discount_total', '')::numeric, 0),
    'shipping_charge',          coalesce(nullif(v_snap ->> 'shipping_charge', '')::numeric, 0),
    'tax_total',                coalesce(nullif(v_snap ->> 'tax_total', '')::numeric, 0),
    'total',                    coalesce(nullif(v_snap ->> 'total', '')::numeric, 0),
    'items', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'line_number',      it ->> 'line_number',
          'role',             it ->> 'role',
          'item_name',        it ->> 'item_name',
          'item_description',  it ->> 'item_description',
          'quantity',         coalesce(nullif(it ->> 'quantity', '')::numeric, 0),
          'unit',             it ->> 'unit',
          'rate',             coalesce(nullif(it ->> 'rate', '')::numeric, 0),
          'discount',         coalesce(nullif(it ->> 'discount', '')::numeric, 0),
          'tax_name',         it ->> 'tax_name',
          'tax_percentage',   coalesce(nullif(it ->> 'tax_percentage', '')::numeric, 0),
          'item_total',       coalesce(nullif(it ->> 'item_total', '')::numeric, 0),
          'image_url',        it ->> 'image_url',
          'price_breakdown',  it -> 'price_breakdown'
        )
        order by coalesce(nullif(it ->> 'line_number', '')::int, 0)
      ), '[]'::jsonb)
      from jsonb_array_elements(coalesce(v_snap -> 'items', '[]'::jsonb)) as t(it)
    )
  );
end;
$$;

revoke all on function public._quote_document_projection(uuid) from public, anon, authenticated;

-- ===================================================================
-- 11. save_opps_quote_with_items — staff editor entry point.
--     Mirrors save_opps_invoice_with_items: auth-gate, tenant-gate,
--     optimistic-lock on updated_at, expected-item-count guard, numeric
--     item validation, ±R0.02 total invariant. Additionally: every
--     successful call APPENDS a new immutable revision snapshot and
--     repoints current_revision_id. Never mutates a prior revision.
--     Never touches accepted_revision_id. Refuses edits when status is
--     accepted / converted / declined.
-- ===================================================================
create or replace function public.save_opps_quote_with_items(
  p_tenant_id             uuid,
  p_quote_id              uuid,
  p_quote                 jsonb,
  p_items                 jsonb,
  p_expected_updated_at   timestamptz default null,
  p_expected_item_count   integer default null,
  p_allow_total_override  boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id            uuid := auth.uid();
  v_items              jsonb := coalesce(p_items, '[]'::jsonb);
  v_is_create          boolean := p_quote_id is null;
  v_quote              public.opps_quotes%rowtype;
  v_existing           public.opps_quotes%rowtype;
  v_existing_count     integer := 0;
  v_billable_subtotal  numeric := 0;
  v_billable_discount  numeric := 0;
  v_billable_tax       numeric := 0;
  v_shipping           numeric := coalesce(nullif(p_quote ->> 'shipping_charge', '')::numeric, 0);
  v_computed_total     numeric := 0;
  v_stated_total       numeric := coalesce(nullif(p_quote ->> 'total', '')::numeric, 0);
  v_override_reason    text := nullif(btrim(p_quote ->> 'total_override_reason'), '');
  v_did_override       boolean := false;
  v_quote_number       text;
  v_next_revision      integer;
  v_new_revision_id    uuid;
  v_snapshot           jsonb;
  v_totals             jsonb;
  v_setup_fees         numeric := 0;
begin
  -- ── identity + authority ──────────────────────────────────────────
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'QUOTE_AUTH_REQUIRED';
  end if;
  if p_tenant_id is null
     or not public.can_access_tenant(p_tenant_id)
     or not (public.is_app_admin() or public.user_finance_level() in (1, 2))
  then
    raise exception using errcode = 'P0001', message = 'QUOTE_ACCESS_DENIED';
  end if;

  -- ── item shape ────────────────────────────────────────────────────
  if jsonb_typeof(v_items) <> 'array' then
    raise exception using errcode = 'P0001', message = 'QUOTE_ITEMS_INVALID';
  end if;
  if jsonb_array_length(v_items) = 0 then
    raise exception using errcode = 'P0001', message = 'QUOTE_EMPTY_ITEMS_BLOCKED';
  end if;

  -- ── per-item validation (name, numeric qty/rate/discount) ─────────
  begin
    if exists (
      select 1
      from jsonb_array_elements(v_items) as e(item)
      where nullif(btrim(item ->> 'item_name'), '') is null
        or coalesce(nullif(item ->> 'quantity', '')::numeric, 0) <= 0
        or coalesce(nullif(item ->> 'rate', '')::numeric, 0) < 0
        or coalesce(nullif(item ->> 'discount', '')::numeric, 0) < 0
        or coalesce(nullif(item ->> 'tax_percentage', '')::numeric, 0) < 0
        or coalesce(item ->> 'role', 'product') not in ('product', 'addon', 'setup_fee', 'shipping', 'discount')
    ) then
      raise exception using errcode = '23514', message = 'QUOTE_ITEM_INVALID_VALUES';
    end if;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception using errcode = '23514', message = 'QUOTE_ITEM_INVALID_VALUES';
  end;

  -- ── ±R0.02 total invariant ───────────────────────────────────────
  select
    coalesce(sum(round(
      coalesce(nullif(e.item ->> 'quantity', '')::numeric, 0)
      * coalesce(nullif(e.item ->> 'rate', '')::numeric, 0), 2)), 0),
    coalesce(sum(greatest(coalesce(nullif(e.item ->> 'discount', '')::numeric, 0), 0)), 0),
    coalesce(sum(round(
      greatest(
        round(coalesce(nullif(e.item ->> 'quantity', '')::numeric, 0)
              * coalesce(nullif(e.item ->> 'rate', '')::numeric, 0), 2)
        - greatest(coalesce(nullif(e.item ->> 'discount', '')::numeric, 0), 0), 0)
      * (greatest(coalesce(nullif(e.item ->> 'tax_percentage', '')::numeric, 0), 0) / 100.0), 2)), 0)
  into v_billable_subtotal, v_billable_discount, v_billable_tax
  from jsonb_array_elements(v_items) as e(item);

  v_computed_total := round(v_billable_subtotal - v_billable_discount + v_shipping + v_billable_tax, 2);

  if abs(v_computed_total - v_stated_total) > 0.02 then
    if not coalesce(p_allow_total_override, false) then
      raise exception using errcode = 'P0001',
        message = format('QUOTE_TOTAL_MISMATCH: items reconcile to %s but the stated total is %s',
                         v_computed_total, v_stated_total);
    end if;
    if v_override_reason is null then
      raise exception using errcode = 'P0001', message = 'QUOTE_TOTAL_OVERRIDE_REASON_REQUIRED';
    end if;
    v_did_override := true;
  end if;

  v_setup_fees := coalesce((
    select sum(round(coalesce(nullif(e.item ->> 'quantity', '')::numeric, 0)
                     * coalesce(nullif(e.item ->> 'rate', '')::numeric, 0), 2))
    from jsonb_array_elements(v_items) as e(item)
    where coalesce(e.item ->> 'role', 'product') = 'setup_fee'
  ), 0);

  -- ── create vs update ─────────────────────────────────────────────
  if v_is_create then
    v_quote_number := public._next_quote_number(p_tenant_id);

    insert into public.opps_quotes (
      tenant_id, quote_number, status,
      customer_id, customer_name, customer_email, customer_phone, customer_whatsapp,
      customer_billing_address, shipping_address,
      currency_code, valid_until, payment_terms, reference_number, notes, terms,
      subtotal, discount_total, shipping_charge, tax_total, total,
      total_override_reason, total_override_by, total_override_at,
      source_request_id, supersedes_quote_id,
      created_by, updated_by
    ) values (
      p_tenant_id, v_quote_number, 'draft',
      nullif(p_quote ->> 'customer_id', '')::uuid,
      coalesce(nullif(btrim(p_quote ->> 'customer_name'), ''), 'Customer'),
      nullif(p_quote ->> 'customer_email', ''),
      nullif(p_quote ->> 'customer_phone', ''),
      nullif(p_quote ->> 'customer_whatsapp', ''),
      nullif(p_quote ->> 'customer_billing_address', ''),
      nullif(p_quote ->> 'shipping_address', ''),
      coalesce(nullif(p_quote ->> 'currency_code', ''), 'ZAR'),
      nullif(p_quote ->> 'valid_until', '')::date,
      nullif(p_quote ->> 'payment_terms', ''),
      nullif(p_quote ->> 'reference_number', ''),
      nullif(p_quote ->> 'notes', ''),
      nullif(p_quote ->> 'terms', ''),
      round(v_billable_subtotal, 2),
      round(v_billable_discount, 2),
      round(v_shipping, 2),
      round(v_billable_tax, 2),
      round(v_stated_total, 2),
      case when v_did_override then v_override_reason else null end,
      case when v_did_override then v_user_id else null end,
      case when v_did_override then now() else null end,
      nullif(p_quote ->> 'source_request_id', '')::uuid,
      nullif(p_quote ->> 'supersedes_quote_id', '')::uuid,
      v_user_id, v_user_id
    )
    returning * into v_quote;

  else
    select * into v_existing
    from public.opps_quotes
    where id = p_quote_id and tenant_id = p_tenant_id
    for update;

    if not found then
      raise exception using errcode = 'P0001', message = 'QUOTE_ACCESS_DENIED';
    end if;

    -- accepted / converted / declined are locked to save_. (A future
    -- explicit workflow may re-open changes_requested etc.; not Q1.)
    if v_existing.status in ('accepted', 'converted', 'declined') then
      raise exception using errcode = 'P0001', message = 'QUOTE_NOT_EDITABLE';
    end if;

    if p_expected_updated_at is not null
       and v_existing.updated_at is distinct from p_expected_updated_at
    then
      raise exception using errcode = 'P0001', message = 'QUOTE_STALE_VERSION';
    end if;

    select count(*) into v_existing_count
    from public.opps_quote_items
    where quote_id = p_quote_id;

    if p_expected_item_count is null or p_expected_item_count <> v_existing_count then
      raise exception using errcode = 'P0001', message = 'QUOTE_ITEM_COUNT_CHANGED';
    end if;

    update public.opps_quotes set
      customer_id              = nullif(p_quote ->> 'customer_id', '')::uuid,
      customer_name            = coalesce(nullif(btrim(p_quote ->> 'customer_name'), ''), customer_name),
      customer_email           = nullif(p_quote ->> 'customer_email', ''),
      customer_phone           = nullif(p_quote ->> 'customer_phone', ''),
      customer_whatsapp        = nullif(p_quote ->> 'customer_whatsapp', ''),
      customer_billing_address = nullif(p_quote ->> 'customer_billing_address', ''),
      shipping_address         = nullif(p_quote ->> 'shipping_address', ''),
      currency_code            = coalesce(nullif(p_quote ->> 'currency_code', ''), 'ZAR'),
      valid_until              = nullif(p_quote ->> 'valid_until', '')::date,
      payment_terms            = nullif(p_quote ->> 'payment_terms', ''),
      reference_number         = nullif(p_quote ->> 'reference_number', ''),
      notes                    = nullif(p_quote ->> 'notes', ''),
      terms                    = nullif(p_quote ->> 'terms', ''),
      subtotal                 = round(v_billable_subtotal, 2),
      discount_total           = round(v_billable_discount, 2),
      shipping_charge          = round(v_shipping, 2),
      tax_total                = round(v_billable_tax, 2),
      total                    = round(v_stated_total, 2),
      total_override_reason    = case when v_did_override then v_override_reason else null end,
      total_override_by        = case when v_did_override then v_user_id else null end,
      total_override_at        = case when v_did_override then now() else null end,
      updated_by               = v_user_id
      -- status, accepted_revision_id, accepted_* : deliberately untouched
    where id = p_quote_id
    returning * into v_quote;
  end if;

  -- ── replace working items transactionally ─────────────────────────
  delete from public.opps_quote_items where quote_id = v_quote.id;

  insert into public.opps_quote_items (
    quote_id, tenant_id, line_number, role, item_name, item_description,
    quantity, unit, rate, discount, tax_name, tax_percentage, item_total,
    image_url, source_client_product_id, source_metadata
  )
  select
    v_quote.id,
    p_tenant_id,  -- trigger re-forces from parent anyway
    coalesce(nullif(e.item ->> 'line_number', '')::int, (e.ord)::int),
    coalesce(e.item ->> 'role', 'product'),
    btrim(e.item ->> 'item_name'),
    nullif(e.item ->> 'item_description', ''),
    (e.item ->> 'quantity')::numeric,
    nullif(e.item ->> 'unit', ''),
    (e.item ->> 'rate')::numeric,
    coalesce(nullif(e.item ->> 'discount', '')::numeric, 0),
    nullif(e.item ->> 'tax_name', ''),
    coalesce(nullif(e.item ->> 'tax_percentage', '')::numeric, 0),
    round(
      greatest(
        round(coalesce(nullif(e.item ->> 'quantity', '')::numeric, 0)
              * coalesce(nullif(e.item ->> 'rate', '')::numeric, 0), 2)
        - greatest(coalesce(nullif(e.item ->> 'discount', '')::numeric, 0), 0), 0)
      * (1 + greatest(coalesce(nullif(e.item ->> 'tax_percentage', '')::numeric, 0), 0) / 100.0),
      2),
    nullif(e.item ->> 'image_url', ''),
    nullif(e.item ->> 'source_client_product_id', '')::uuid,
    coalesce(e.item -> 'source_metadata', '{}'::jsonb)
  from jsonb_array_elements(v_items) with ordinality as e(item, ord);

  -- ── build the customer-safe snapshot (no internal keys) ──────────
  select jsonb_build_object(
    'quote_number',             v_quote.quote_number,
    'status',                   v_quote.status,
    'currency_code',            v_quote.currency_code,
    'valid_until',              v_quote.valid_until,
    'payment_terms',            v_quote.payment_terms,
    'reference_number',         v_quote.reference_number,
    'terms',                    v_quote.terms,
    'customer_name',            v_quote.customer_name,
    'customer_billing_address', v_quote.customer_billing_address,
    'shipping_address',         v_quote.shipping_address,
    'subtotal',                 round(v_billable_subtotal, 2),
    'discount_total',           round(v_billable_discount, 2),
    'shipping_charge',          round(v_shipping, 2),
    'tax_total',                round(v_billable_tax, 2),
    'total',                    round(v_stated_total, 2),
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'line_number',     qi.line_number,
          'role',            qi.role,
          'item_name',       qi.item_name,
          'item_description', qi.item_description,
          'quantity',        qi.quantity,
          'unit',            qi.unit,
          'rate',            qi.rate,
          'discount',        qi.discount,
          'tax_name',        qi.tax_name,
          'tax_percentage',  qi.tax_percentage,
          'item_total',      qi.item_total,
          'image_url',       qi.image_url,
          'price_breakdown', public._quote_item_price_breakdown(qi.source_metadata)
        )
        order by qi.line_number
      )
      from public.opps_quote_items qi
      where qi.quote_id = v_quote.id
    ), '[]'::jsonb)
  ) into v_snapshot;

  v_totals := jsonb_build_object(
    'subtotal',       round(v_billable_subtotal, 2),
    'discount_total', round(v_billable_discount, 2),
    'setup_fees',     round(v_setup_fees, 2),
    'shipping_charge', round(v_shipping, 2),
    'tax_total',      round(v_billable_tax, 2),
    'total',          round(v_stated_total, 2)
  );

  -- ── append the immutable revision, repoint current_revision_id ────
  select coalesce(max(revision_number), 0) + 1
    into v_next_revision
  from public.opps_quote_revisions
  where quote_id = v_quote.id;

  insert into public.opps_quote_revisions (quote_id, tenant_id, revision_number, snapshot, totals, created_by)
  values (v_quote.id, p_tenant_id, v_next_revision, v_snapshot, v_totals, v_user_id)
  returning id into v_new_revision_id;

  update public.opps_quotes
     set current_revision_id = v_new_revision_id,
         updated_by = v_user_id
   where id = v_quote.id
  returning * into v_quote;

  insert into public.opps_quote_events (quote_id, tenant_id, revision_id, event_type, actor_kind, actor_user_id)
  values (
    v_quote.id, p_tenant_id, v_new_revision_id,
    case when v_is_create then 'created' else 'revised' end,
    'staff', v_user_id
  );

  return jsonb_build_object(
    'ok',                  true,
    'quote_id',            v_quote.id,
    'quote_number',        v_quote.quote_number,
    'status',              v_quote.status,
    'current_revision_id', v_quote.current_revision_id,
    'revision_number',     v_next_revision,
    'total',               round(v_stated_total, 2),
    'total_overridden',    v_did_override,
    'updated_at',          v_quote.updated_at
  );
end;
$$;

revoke all on function public.save_opps_quote_with_items(uuid, uuid, jsonb, jsonb, timestamptz, integer, boolean) from public, anon;
grant execute on function public.save_opps_quote_with_items(uuid, uuid, jsonb, jsonb, timestamptz, integer, boolean) to authenticated;

commit;
