-- ════════════════════════════════════════════════════════════════════
--  QUOTES Q2.5 — PUBLISHED REVISION GATE
-- ════════════════════════════════════════════════════════════════════
--
-- Separates three revision pointers on public.opps_quotes:
--   current_revision_id    = latest staff working revision
--                            (moved by save_opps_quote_with_items on every save)
--   published_revision_id  = the exact revision formally presented to the
--                            customer right now (the live commercial offer)
--                            — NEW in this migration, moved ONLY by
--                            mark_quote_sent()
--   accepted_revision_id   = the exact revision the customer accepted
--                            (Q4; set by accept_public_quote())
--
-- Without published_revision_id, a staff edit to a sent/viewed quote
-- silently replaces the offer the customer was formally sent, because the
-- projection follows current_revision_id. This migration closes that.
--
-- Additive only. It does NOT change save_opps_quote_with_items (that
-- function's UPDATE list never references published_revision_id, so a save
-- already cannot move it). No public route, no accept/decline, no
-- conversion. opps_invoices / invoice status / PayFast untouched.
--
-- Depends on: 20260906090000_quotes_q1_canonical_schema.sql
--
-- STAGING-FIRST. NOT APPLIED. NO PRODUCTION. NO DEPLOY. NO PUSH.
-- ════════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ===================================================================
-- 1. published_revision_id pointer  (opps_quote_revisions already
--    exists — no circular-FK ordering problem, unlike Q1)
-- ===================================================================
alter table public.opps_quotes
  add column if not exists published_revision_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'opps_quotes_published_revision_fk'
  ) then
    alter table public.opps_quotes
      add constraint opps_quotes_published_revision_fk
      foreign key (published_revision_id) references public.opps_quote_revisions(id) on delete set null;
  end if;
end $$;

create index if not exists idx_opps_quotes_published_revision
  on public.opps_quotes (published_revision_id)
  where published_revision_id is not null;

comment on column public.opps_quotes.published_revision_id is
  'The exact opps_quote_revisions row currently presented to the customer as the live formal offer. Set ONLY by public.mark_quote_sent(); NEVER changed by save_opps_quote_with_items(). NULL until the quote is first sent. Q4 get_public_quote()/accept_public_quote() read this, never current_revision_id.';

-- ===================================================================
-- 2. Safe backfill — pre-migration there was no distinction between
--    "working head" and "sent offer", so whatever the customer could
--    have seen was current_revision_id. Only rows already presented to a
--    customer; draft quotes are left untouched.
-- ===================================================================
update public.opps_quotes
   set published_revision_id = current_revision_id
 where status in ('sent', 'viewed', 'changes_requested')
   and published_revision_id is null
   and current_revision_id is not null;

-- ===================================================================
-- 3. mark_quote_sent — the ONLY writer of published_revision_id.
--    Publishes the current working revision as the live customer offer.
-- ===================================================================
create or replace function public.mark_quote_sent(p_quote_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_quote   public.opps_quotes%rowtype;
  v_rev_no  integer;
  v_resend  boolean;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'QUOTE_AUTH_REQUIRED';
  end if;

  select * into v_quote from public.opps_quotes where id = p_quote_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'QUOTE_NOT_FOUND';
  end if;

  if not public.can_access_tenant(v_quote.tenant_id)
     or not (public.is_app_admin() or public.user_finance_level() in (1, 2))
  then
    raise exception using errcode = 'P0001', message = 'QUOTE_ACCESS_DENIED';
  end if;

  if v_quote.current_revision_id is null then
    raise exception using errcode = 'P0001', message = 'QUOTE_NO_REVISION_TO_SEND';
  end if;

  if v_quote.status not in ('draft', 'changes_requested', 'sent', 'viewed') then
    raise exception using errcode = 'P0001', message = 'QUOTE_NOT_SENDABLE';
  end if;

  -- C. idempotent — this exact revision is already the live offer and the
  --    quote is already 'sent': no state change, no duplicate event.
  if v_quote.published_revision_id is not distinct from v_quote.current_revision_id
     and v_quote.status = 'sent'
  then
    select revision_number into v_rev_no
    from public.opps_quote_revisions where id = v_quote.current_revision_id;
    return jsonb_build_object(
      'ok', true, 'no_change', true, 'resend', false,
      'quote_id', v_quote.id, 'status', v_quote.status,
      'published_revision_id', v_quote.published_revision_id,
      'revision_number', v_rev_no
    );
  end if;

  -- B. resend when a different revision was previously published;
  -- A. first send otherwise.
  v_resend := v_quote.published_revision_id is not null;

  update public.opps_quotes
     set published_revision_id = current_revision_id,
         status = 'sent',                 -- a resend from 'viewed' resets the view state
         updated_by = v_user_id
   where id = p_quote_id
   returning * into v_quote;

  select revision_number into v_rev_no
  from public.opps_quote_revisions where id = v_quote.published_revision_id;

  insert into public.opps_quote_events (
    quote_id, tenant_id, revision_id, event_type, actor_kind, actor_user_id, metadata
  )
  values (
    v_quote.id, v_quote.tenant_id, v_quote.published_revision_id,
    'sent', 'staff', v_user_id,
    jsonb_build_object('resend', v_resend)
  );

  return jsonb_build_object(
    'ok', true, 'no_change', false, 'resend', v_resend,
    'quote_id', v_quote.id, 'status', v_quote.status,
    'published_revision_id', v_quote.published_revision_id,
    'revision_number', v_rev_no
  );
end;
$$;

revoke all on function public.mark_quote_sent(uuid) from public, anon;
grant execute on function public.mark_quote_sent(uuid) to authenticated;

commit;
