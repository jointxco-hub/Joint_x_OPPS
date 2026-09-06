-- ════════════════════════════════════════════════════════════════════
--  QUOTES Q3 — PUBLIC CUSTOMER QUOTE  (/q/:token)
-- ════════════════════════════════════════════════════════════════════
--
-- The no-account customer view of a quote, analogous to the public
-- invoice route (20260904130000_invoice_p3_public_share.sql) but with
-- QUOTE lifecycle semantics — NO payment / balance / "issued" invoice
-- concepts.
--
-- Source of commercial truth (Q2.5): the customer sees ONLY
--   coalesce(accepted_revision_id, published_revision_id)
-- — the frozen offer. Never current_revision_id / a draft / any mutable
-- opps_quotes commercial field / internal notes / cost / margin /
-- supplier / procurement / tenant or internal ids / staff-only fields.
--
-- Q1 already added the four share columns to opps_quotes
-- (share_token, share_expires_at, public_visible, share_revoked_at) +
-- unique(share_token). This migration adds the RPCs only.
--
-- Adds:
--   public._generate_quote_share_token()          internal — 256-bit token
--   public.issue_quote(uuid, timestamptz)         staff — publish a share link
--   public.revoke_quote_share(uuid)               staff — kill the link
--   public.rotate_quote_share_token(uuid)         staff — new token, same visibility
--   public._public_quote_projection(uuid)         internal — the ONE customer-safe frozen-offer shape
--   public.get_public_quote(text)                 anon — read by token
--   public.get_public_quote_by_email(text, text)  anon — recovery lookup (already-issued only)
--   public.mark_public_quote_viewed(text)         anon — sent -> viewed, once
--   public.accept_public_quote(text, integer, text, text, text)   anon — accept the EXACT published revision
--   public.request_quote_changes(text, integer, text, text, text) anon — ask for changes, no price/revision change
--   public.decline_public_quote(text, integer, text, text, text)  anon — decline, history preserved
--
-- Depends on: 20260906090000_quotes_q1_canonical_schema.sql,
--             20260906100000_quotes_q2_5_published_revision.sql
--
-- STAGING-FIRST. NOT APPLIED. NO PRODUCTION. NO DEPLOY. NO PUSH.
-- ════════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ===================================================================
-- 1. token generation — internal only
-- ===================================================================
create or replace function public._generate_quote_share_token()
returns text
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_candidate text;
  v_attempt int := 0;
begin
  loop
    v_attempt := v_attempt + 1;
    -- 32 random bytes -> 64 hex chars: 256 bits, URL-safe, unrelated to
    -- quote_number / any id.
    v_candidate := encode(extensions.gen_random_bytes(32), 'hex');
    exit when not exists (select 1 from public.opps_quotes where share_token = v_candidate);
    if v_attempt > 5 then
      raise exception using errcode = 'P0001', message = 'QUOTE_SHARE_TOKEN_COLLISION';
    end if;
  end loop;
  return v_candidate;
end;
$$;
revoke all on function public._generate_quote_share_token() from public, anon, authenticated;

-- ===================================================================
-- 2. STAFF share controls
-- ===================================================================
create or replace function public._quote_staff_guard(p_quote_id uuid, p_for_update boolean default true)
returns public.opps_quotes
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_quote public.opps_quotes%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = 'P0001', message = 'QUOTE_AUTH_REQUIRED';
  end if;
  if p_for_update then
    select * into v_quote from public.opps_quotes where id = p_quote_id for update;
  else
    select * into v_quote from public.opps_quotes where id = p_quote_id;
  end if;
  if not found then
    raise exception using errcode = 'P0001', message = 'QUOTE_NOT_FOUND';
  end if;
  if not public.can_access_tenant(v_quote.tenant_id)
     or not (public.is_app_admin() or public.user_finance_level() in (1, 2))
  then
    raise exception using errcode = 'P0001', message = 'QUOTE_ACCESS_DENIED';
  end if;
  return v_quote;
end;
$$;
revoke all on function public._quote_staff_guard(uuid, boolean) from public, anon, authenticated;

-- issue_quote — mint/reuse a token and make the quote publicly visible.
-- Quote semantics: a quote can only be shared once it has a FORMAL OFFER
-- (published_revision_id). It does NOT advance the quote's status (unlike
-- issue_invoice which promotes draft->approved). Logs a share_issued event.
create or replace function public.issue_quote(p_quote_id uuid, p_expires_at timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_quote public.opps_quotes%rowtype;
  v_token text;
begin
  v_quote := public._quote_staff_guard(p_quote_id, true);

  if v_quote.published_revision_id is null then
    raise exception using errcode = 'P0001', message = 'QUOTE_NOT_PUBLISHED';
  end if;
  if v_quote.status = 'draft' then
    raise exception using errcode = 'P0001', message = 'QUOTE_NOT_SHAREABLE';
  end if;

  if v_quote.share_token is null or v_quote.share_revoked_at is not null then
    v_token := public._generate_quote_share_token();
  else
    v_token := v_quote.share_token;
  end if;

  update public.opps_quotes
     set share_token = v_token,
         share_revoked_at = null,
         public_visible = true,
         share_expires_at = p_expires_at,
         updated_by = auth.uid()
   where id = p_quote_id
   returning * into v_quote;

  insert into public.opps_quote_events (quote_id, tenant_id, revision_id, event_type, actor_kind, actor_user_id, metadata)
  values (v_quote.id, v_quote.tenant_id, v_quote.published_revision_id, 'share_issued', 'staff', auth.uid(),
          jsonb_build_object('expires_at', p_expires_at));

  return jsonb_build_object(
    'ok', true,
    'quote_number', v_quote.quote_number,
    'share_token', v_quote.share_token,
    'share_path', '/q/' || v_quote.share_token,
    'public_visible', v_quote.public_visible,
    'share_expires_at', v_quote.share_expires_at
  );
end;
$$;
revoke all on function public.issue_quote(uuid, timestamptz) from public, anon;
grant execute on function public.issue_quote(uuid, timestamptz) to authenticated;

create or replace function public.revoke_quote_share(p_quote_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_quote public.opps_quotes%rowtype;
begin
  v_quote := public._quote_staff_guard(p_quote_id, true);
  update public.opps_quotes
     set public_visible = false,
         share_revoked_at = now(),
         updated_by = auth.uid()
   where id = p_quote_id
   returning * into v_quote;
  insert into public.opps_quote_events (quote_id, tenant_id, revision_id, event_type, actor_kind, actor_user_id)
  values (v_quote.id, v_quote.tenant_id, v_quote.published_revision_id, 'share_revoked', 'staff', auth.uid());
  return jsonb_build_object('ok', true, 'public_visible', false, 'share_revoked_at', v_quote.share_revoked_at);
end;
$$;
revoke all on function public.revoke_quote_share(uuid) from public, anon;
grant execute on function public.revoke_quote_share(uuid) to authenticated;

create or replace function public.rotate_quote_share_token(p_quote_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_quote public.opps_quotes%rowtype; v_token text;
begin
  v_quote := public._quote_staff_guard(p_quote_id, true);
  if v_quote.share_token is null or v_quote.share_revoked_at is not null then
    raise exception using errcode = 'P0001', message = 'QUOTE_SHARE_NOT_ACTIVE';
  end if;
  v_token := public._generate_quote_share_token();
  update public.opps_quotes set share_token = v_token, updated_by = auth.uid() where id = p_quote_id
    returning * into v_quote;
  insert into public.opps_quote_events (quote_id, tenant_id, revision_id, event_type, actor_kind, actor_user_id)
  values (v_quote.id, v_quote.tenant_id, v_quote.published_revision_id, 'share_rotated', 'staff', auth.uid());
  return jsonb_build_object('ok', true, 'share_token', v_quote.share_token, 'share_path', '/q/' || v_quote.share_token);
end;
$$;
revoke all on function public.rotate_quote_share_token(uuid) from public, anon;
grant execute on function public.rotate_quote_share_token(uuid) to authenticated;

-- ===================================================================
-- 3. _public_quote_projection — the ONE customer-safe frozen-offer shape.
--    Reads coalesce(accepted_revision_id, published_revision_id) and
--    takes EVERY commercial / customer field from that revision's
--    immutable SNAPSHOT. Never current_revision_id, never a mutable
--    opps_quotes commercial column, never opps_quote_items. Returns NULL
--    if the quote has no formal offer yet.
--
--    DELIBERATELY EXCLUDES: id, tenant_id, customer_id, customer_email,
--    customer_phone, customer_whatsapp, notes, source_request_id,
--    supersedes_quote_id, converted_order_id, converted_invoice_id,
--    share_token, total_override_reason/by/at, created_by/updated_by,
--    accepted_actor_user_id, and every opps_quote_items internal column
--    (source_metadata raw, source_client_product_id). Items surface only
--    through the snapshot shape save_opps_quote_with_items froze, whose
--    price_breakdown already went through _quote_item_price_breakdown().
-- ===================================================================
create or replace function public._public_quote_projection(p_quote_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_quote    public.opps_quotes%rowtype;
  v_rev      public.opps_quote_revisions%rowtype;
  v_snap     jsonb;
  v_rev_id   uuid;
begin
  select * into v_quote from public.opps_quotes where id = p_quote_id;
  if not found then
    return null;
  end if;

  v_rev_id := coalesce(v_quote.accepted_revision_id, v_quote.published_revision_id);
  if v_rev_id is null then
    return null;   -- no formal offer to show
  end if;

  select * into v_rev from public.opps_quote_revisions where id = v_rev_id;
  if not found then
    return null;
  end if;
  v_snap := v_rev.snapshot;

  return jsonb_build_object(
    'kind',                     'quote',
    'quote_number',             v_snap ->> 'quote_number',
    'revision_number',          v_rev.revision_number,
    -- created_date is genuinely quote-level (a revision has no "quote
    -- created" date). Everything else below is snapshot-frozen.
    'created_date',             v_quote.created_at::date,
    'valid_until',              nullif(v_snap ->> 'valid_until', ''),
    'currency_code',            coalesce(nullif(v_snap ->> 'currency_code', ''), 'ZAR'),
    'customer_name',            v_snap ->> 'customer_name',
    'customer_billing_address', v_snap ->> 'customer_billing_address',
    'shipping_address',         v_snap ->> 'shipping_address',
    'payment_terms',            v_snap ->> 'payment_terms',
    'reference_number',         v_snap ->> 'reference_number',
    'terms',                    v_snap ->> 'terms',
    'subtotal',                 coalesce(nullif(v_snap ->> 'subtotal', '')::numeric, 0),
    'discount_total',           coalesce(nullif(v_snap ->> 'discount_total', '')::numeric, 0),
    'shipping_charge',          coalesce(nullif(v_snap ->> 'shipping_charge', '')::numeric, 0),
    'tax_total',                coalesce(nullif(v_snap ->> 'tax_total', '')::numeric, 0),
    'total',                    coalesce(nullif(v_snap ->> 'total', '')::numeric, 0),
    -- lifecycle state the customer needs (offer-neutral, from the quote row)
    'status',                   v_quote.status,
    'is_accepted',              (v_quote.accepted_revision_id is not null),
    'is_published_revision',    (v_quote.published_revision_id is not null and v_quote.published_revision_id = v_rev_id),
    'accepted_at',              v_quote.accepted_at,
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
revoke all on function public._public_quote_projection(uuid) from public, anon, authenticated;

-- ===================================================================
-- 4. get_public_quote — the public route's ONLY read path. anon.
--    Resolves solely by share_token. A wrong token, a revoked/expired
--    share, a never-sent quote, or a draft all return NULL identically —
--    no enumeration signal.
-- ===================================================================
create or replace function public.get_public_quote(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare v_quote public.opps_quotes%rowtype;
begin
  if p_token is null or btrim(p_token) = '' then
    return null;
  end if;
  select * into v_quote from public.opps_quotes where share_token = p_token;
  if not found then return null; end if;
  if v_quote.public_visible is not true then return null; end if;
  if v_quote.share_revoked_at is not null then return null; end if;
  if v_quote.share_expires_at is not null and v_quote.share_expires_at < now() then return null; end if;
  if v_quote.published_revision_id is null then return null; end if;   -- never formally sent
  if v_quote.status = 'draft' then return null; end if;
  return public._public_quote_projection(v_quote.id);
end;
$$;
revoke all on function public.get_public_quote(text) from public;
grant execute on function public.get_public_quote(text) to anon, authenticated;

create or replace function public.get_public_quote_by_email(p_quote_number text, p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_quote public.opps_quotes%rowtype;
  v_num text := btrim(coalesce(p_quote_number, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if v_num = '' or v_email = '' then return null; end if;
  select * into v_quote
  from public.opps_quotes
  where quote_number = v_num
    and lower(btrim(coalesce(customer_email, ''))) = v_email
    and public_visible = true
    and share_revoked_at is null
    and (share_expires_at is null or share_expires_at >= now())
    and published_revision_id is not null
    and status <> 'draft';
  if not found then return null; end if;
  return public._public_quote_projection(v_quote.id);
end;
$$;
revoke all on function public.get_public_quote_by_email(text, text) from public;
grant execute on function public.get_public_quote_by_email(text, text) to anon, authenticated;

-- ===================================================================
-- 5. PUBLIC ACTIONS — narrow, token-scoped, anon. No quote_id, no
--    tenant param -> no enumeration, no tenant discovery. Each resolves
--    the quote by token under the SAME validity checks as
--    get_public_quote, locks the row, and fails closed on a stale
--    revision (staff republished between the customer's load and action).
-- ===================================================================

-- resolve + lock a publicly-actionable quote by token, or raise.
create or replace function public._public_quote_by_token_for_update(p_token text)
returns public.opps_quotes
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_quote public.opps_quotes%rowtype;
begin
  if p_token is null or btrim(p_token) = '' then
    raise exception using errcode = 'P0001', message = 'QUOTE_LINK_INVALID';
  end if;
  select * into v_quote from public.opps_quotes where share_token = p_token for update;
  if not found
     or v_quote.public_visible is not true
     or v_quote.share_revoked_at is not null
     or (v_quote.share_expires_at is not null and v_quote.share_expires_at < now())
     or v_quote.published_revision_id is null
     or v_quote.status = 'draft'
  then
    raise exception using errcode = 'P0001', message = 'QUOTE_LINK_INVALID';
  end if;
  return v_quote;
end;
$$;
revoke all on function public._public_quote_by_token_for_update(text) from public, anon, authenticated;

-- resolve the revision_number of a quote's currently published offer.
create or replace function public._published_revision_number(p_quote public.opps_quotes)
returns integer
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select revision_number from public.opps_quote_revisions where id = p_quote.published_revision_id;
$$;
revoke all on function public._published_revision_number(public.opps_quotes) from public, anon, authenticated;

-- accept — act ONLY on the exact currently published revision. The
-- customer echoes back the revision_number they were shown (the public
-- projection exposes only the number, never the internal revision uuid);
-- a mismatch means staff republished under them -> fail closed.
create or replace function public.accept_public_quote(
  p_token                  text,
  p_expected_revision_number integer,
  p_ack_name               text,
  p_ack_email              text default null,
  p_user_agent             text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_quote  public.opps_quotes%rowtype;
  v_rev_no integer;
  v_name   text := btrim(coalesce(p_ack_name, ''));
begin
  v_quote := public._public_quote_by_token_for_update(p_token);

  if v_quote.status not in ('sent', 'viewed', 'changes_requested') then
    raise exception using errcode = 'P0001', message = 'QUOTE_NOT_ACCEPTABLE';
  end if;
  if v_name = '' then
    raise exception using errcode = 'P0001', message = 'QUOTE_ACK_NAME_REQUIRED';
  end if;
  -- fail closed if the offer moved under the customer
  if p_expected_revision_number is distinct from public._published_revision_number(v_quote) then
    raise exception using errcode = 'P0001', message = 'QUOTE_PUBLISHED_REVISION_CHANGED';
  end if;

  update public.opps_quotes
     set accepted_revision_id  = published_revision_id,   -- NEVER current_revision_id
         status                = 'accepted',
         accepted_at           = now(),
         accepted_actor_kind   = 'public_link',
         accepted_actor_user_id = null,
         accepted_ack_name     = left(v_name, 200),
         accepted_ack_email    = nullif(lower(btrim(coalesce(p_ack_email, ''))), '')
   where id = v_quote.id
   returning * into v_quote;

  select revision_number into v_rev_no
  from public.opps_quote_revisions where id = v_quote.accepted_revision_id;

  insert into public.opps_quote_events (
    quote_id, tenant_id, revision_id, event_type, actor_kind,
    actor_label, actor_email, share_token_used, ip_hash, user_agent, metadata
  )
  values (
    v_quote.id, v_quote.tenant_id, v_quote.accepted_revision_id, 'accepted', 'public_link',
    left(v_name, 200), nullif(lower(btrim(coalesce(p_ack_email, ''))), ''),
    p_token, public._request_ip_hash(), left(coalesce(p_user_agent, ''), 400),
    jsonb_build_object('accepted_revision_number', v_rev_no)
  );

  return jsonb_build_object(
    'ok', true, 'status', 'accepted',
    'quote_number', v_quote.quote_number,
    'accepted_revision_number', v_rev_no,
    'accepted_at', v_quote.accepted_at
  );
end;
$$;
revoke all on function public.accept_public_quote(text, integer, text, text, text) from public;
grant execute on function public.accept_public_quote(text, integer, text, text, text) to anon, authenticated;

-- request changes — no price / total / revision change; status -> changes_requested.
create or replace function public.request_quote_changes(
  p_token               text,
  p_expected_revision_number integer,
  p_message             text default null,
  p_ack_name            text default null,
  p_user_agent          text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_quote public.opps_quotes%rowtype;
begin
  v_quote := public._public_quote_by_token_for_update(p_token);
  if v_quote.status not in ('sent', 'viewed') then
    raise exception using errcode = 'P0001', message = 'QUOTE_NOT_ACTIONABLE';
  end if;
  if p_expected_revision_number is distinct from public._published_revision_number(v_quote) then
    raise exception using errcode = 'P0001', message = 'QUOTE_PUBLISHED_REVISION_CHANGED';
  end if;

  -- published_revision_id, current_revision_id, all totals: UNCHANGED.
  update public.opps_quotes
     set status = 'changes_requested'
   where id = v_quote.id;

  insert into public.opps_quote_events (
    quote_id, tenant_id, revision_id, event_type, actor_kind,
    actor_label, note, share_token_used, ip_hash, user_agent
  )
  values (
    v_quote.id, v_quote.tenant_id, v_quote.published_revision_id, 'changes_requested', 'public_link',
    nullif(left(btrim(coalesce(p_ack_name, '')), 200), ''),
    nullif(left(btrim(coalesce(p_message, '')), 4000), ''),
    p_token, public._request_ip_hash(), left(coalesce(p_user_agent, ''), 400)
  );

  return jsonb_build_object('ok', true, 'status', 'changes_requested', 'quote_number', v_quote.quote_number);
end;
$$;
revoke all on function public.request_quote_changes(text, integer, text, text, text) from public;
grant execute on function public.request_quote_changes(text, integer, text, text, text) to anon, authenticated;

-- decline — history + published revision + share all preserved.
create or replace function public.decline_public_quote(
  p_token               text,
  p_expected_revision_number integer,
  p_reason              text default null,
  p_ack_name            text default null,
  p_user_agent          text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_quote public.opps_quotes%rowtype;
begin
  v_quote := public._public_quote_by_token_for_update(p_token);
  if v_quote.status not in ('sent', 'viewed', 'changes_requested') then
    raise exception using errcode = 'P0001', message = 'QUOTE_NOT_ACTIONABLE';
  end if;
  if p_expected_revision_number is distinct from public._published_revision_number(v_quote) then
    raise exception using errcode = 'P0001', message = 'QUOTE_PUBLISHED_REVISION_CHANGED';
  end if;

  update public.opps_quotes set status = 'declined' where id = v_quote.id;   -- share_token / revisions untouched

  insert into public.opps_quote_events (
    quote_id, tenant_id, revision_id, event_type, actor_kind,
    actor_label, note, share_token_used, ip_hash, user_agent
  )
  values (
    v_quote.id, v_quote.tenant_id, v_quote.published_revision_id, 'declined', 'public_link',
    nullif(left(btrim(coalesce(p_ack_name, '')), 200), ''),
    nullif(left(btrim(coalesce(p_reason, '')), 4000), ''),
    p_token, public._request_ip_hash(), left(coalesce(p_user_agent, ''), 400)
  );

  return jsonb_build_object('ok', true, 'status', 'declined', 'quote_number', v_quote.quote_number);
end;
$$;
revoke all on function public.decline_public_quote(text, integer, text, text, text) from public;
grant execute on function public.decline_public_quote(text, integer, text, text, text) to anon, authenticated;

-- mark_public_quote_viewed — first customer open of a 'sent' quote moves
-- it to 'viewed' and logs ONE 'viewed' event. Repeat opens are a no-op
-- (so it cannot be used to flood the events table).
create or replace function public.mark_public_quote_viewed(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_quote public.opps_quotes%rowtype;
begin
  begin
    v_quote := public._public_quote_by_token_for_update(p_token);
  exception when others then
    return jsonb_build_object('ok', false);   -- invalid link: silent, no signal
  end;

  if v_quote.status = 'sent' then
    update public.opps_quotes set status = 'viewed' where id = v_quote.id;
    insert into public.opps_quote_events (quote_id, tenant_id, revision_id, event_type, actor_kind, share_token_used, ip_hash)
    values (v_quote.id, v_quote.tenant_id, v_quote.published_revision_id, 'viewed', 'public_link', p_token, public._request_ip_hash());
    return jsonb_build_object('ok', true, 'status', 'viewed');
  end if;
  return jsonb_build_object('ok', true, 'status', v_quote.status);
end;
$$;
revoke all on function public.mark_public_quote_viewed(text) from public;
grant execute on function public.mark_public_quote_viewed(text) to anon, authenticated;

-- privacy-safe request fingerprint: sha256(client ip + date-rotating
-- salt). Reads Supabase's request.headers GUC when present; returns NULL
-- otherwise. Never stores a raw IP.
create or replace function public._request_ip_hash()
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare v_ip text;
begin
  begin
    v_ip := split_part(
      coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1);
  exception when others then
    v_ip := '';
  end;
  v_ip := btrim(v_ip);
  if v_ip = '' then return null; end if;
  return encode(extensions.digest(v_ip || ':' || to_char(now(), 'YYYY-MM-DD'), 'sha256'), 'hex');
end;
$$;
revoke all on function public._request_ip_hash() from public, anon, authenticated;

commit;
