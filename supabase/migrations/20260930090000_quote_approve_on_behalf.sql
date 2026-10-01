-- feat/opps-quote-approve-on-behalf -- Slice 02B-1
--
-- Adds public.accept_quote_on_behalf(...): lets a high-trust operator
-- explicitly record that a client approved a quote through an offline/
-- delegated channel (WhatsApp, phone, in person, email, or an assisted/
-- non-technical client), WITHOUT ever recording it as though the client
-- clicked "accept" themselves.
--
-- This is additive only -- no table is altered. Every field this function
-- writes into already exists on public.opps_quotes / public.opps_quote_events,
-- confirmed live in production before this migration was written:
--   - opps_quotes.accepted_actor_kind CHECK already allows 'staff' (alongside
--     'customer', 'public_link', 'system') -- this migration is the first
--     thing that actually writes 'staff' into it; nothing did before.
--   - opps_quote_events.actor_kind CHECK likewise already allows 'staff'.
--   - opps_quotes.customer_id already identifies which client a quote is
--     for -- no separate on_behalf_of_client_id column is added.
--   - opps_quote_events.note / .metadata already exist and are already
--     read by the frontend (src/api/quotes.js:listQuoteEvents) -- the
--     approval source/reason lives in metadata, the optional reference in
--     note. No new columns needed anywhere for this slice.
--
-- Authorization is INTENTIONALLY NOT public.has_tenant_permission(). Live
-- verification (this session, against production) showed the Joint X
-- tenant currently grants the '*' wildcard permission to owner, admin,
-- member, AND staff roles alike in tenant_access_role_permissions -- so
-- has_tenant_permission(tenant_id, 'clients.approval.on_behalf') would
-- pass for every one of those roles, not just high-trust operators. Using
-- it here would silently fail to enforce the one constraint this whole
-- capability exists for. Until that wildcard grant is separately
-- reconciled (tracked as a follow-up, not touched by this migration),
-- authorization is an explicit, narrow check instead:
--   public.is_app_admin()
--   OR an active tenant_memberships row for auth.uid() on the quote's own
--      tenant_id with tenant_role in ('owner', 'admin')
-- No manager/member/staff/finance/production role gets implicit access
-- through this path, regardless of what the wildcard grant says elsewhere.
--
-- The capability name clients.approval.on_behalf is deliberately NOT
-- seeded into tenant_access_role_permissions by this migration -- it is
-- not depended on for v1 authorization at all.
--
-- Every guard below mirrors public.accept_public_quote (live hash
-- 0b1034164d6406b6bc760e14c5986f49, verified immediately before this
-- migration was written) except the identity source: accept_public_quote
-- authorizes via a public token and records actor_kind='public_link' with
-- a self-reported ack name/email; this function authorizes via the
-- explicit role check above and records actor_kind='staff' with the real
-- auth.uid() of the acting operator, and NEVER writes anything into
-- accepted_ack_name/accepted_ack_email -- those fields stay null, so a
-- staff-recorded approval can never be mistaken for the client's own
-- acknowledgment.

create or replace function public.accept_quote_on_behalf(
  p_quote_id uuid,
  p_expected_revision_number integer,
  p_approval_source text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_quote       public.opps_quotes%rowtype;
  v_user_id     uuid := auth.uid();
  v_source      text := btrim(coalesce(p_approval_source, ''));
  v_note        text := nullif(btrim(coalesce(p_note, '')), '');
  v_actor_label text;
  v_actor_email text;
  v_rev_no      integer;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'QUOTE_APPROVAL_AUTH_REQUIRED';
  end if;

  select * into v_quote from public.opps_quotes where id = p_quote_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'QUOTE_NOT_FOUND';
  end if;

  -- Explicit high-trust check. Deliberately NOT has_tenant_permission() --
  -- see migration header. Tenant isolation is derived from the quote row
  -- itself (v_quote.tenant_id), never from a client-supplied tenant id.
  if not (
    public.is_app_admin()
    or exists (
      select 1
      from public.tenant_memberships tm
      where tm.auth_user_id = v_user_id
        and tm.tenant_id = v_quote.tenant_id
        and tm.status = 'active'
        and tm.tenant_role in ('owner', 'admin')
    )
  ) then
    raise exception using errcode = '42501', message = 'QUOTE_APPROVAL_ON_BEHALF_DENIED';
  end if;

  if v_quote.status not in ('sent', 'viewed', 'changes_requested') then
    raise exception using errcode = 'P0001', message = 'QUOTE_NOT_ACCEPTABLE';
  end if;

  if v_source = '' or v_source not in ('whatsapp', 'phone', 'in_person', 'email', 'assisted', 'other') then
    raise exception using errcode = 'P0001', message = 'QUOTE_APPROVAL_SOURCE_REQUIRED';
  end if;

  -- Same fail-closed revision-race guard as accept_public_quote: refuse if
  -- the published offer moved under the caller between load and confirm.
  if p_expected_revision_number is distinct from public._published_revision_number(v_quote) then
    raise exception using errcode = 'P0001', message = 'QUOTE_PUBLISHED_REVISION_CHANGED';
  end if;

  select coalesce(nullif(u.preferred_name, ''), u.full_name, u.user_email), u.user_email
    into v_actor_label, v_actor_email
  from public.users u
  where u.auth_user_id = v_user_id
  limit 1;

  -- Same field set as accept_public_quote's own update, except
  -- accepted_actor_kind/accepted_actor_user_id reflect the real staff
  -- operator, and accepted_ack_name/accepted_ack_email are explicitly
  -- cleared -- never populated with anything that could be mistaken for
  -- the client's own acknowledgment. NEVER current_revision_id, same as
  -- accept_public_quote.
  update public.opps_quotes
     set accepted_revision_id   = published_revision_id,
         status                 = 'accepted',
         accepted_at            = now(),
         accepted_actor_kind    = 'staff',
         accepted_actor_user_id = v_user_id,
         accepted_ack_name      = null,
         accepted_ack_email     = null
   where id = v_quote.id
   returning * into v_quote;

  select revision_number into v_rev_no
  from public.opps_quote_revisions where id = v_quote.accepted_revision_id;

  insert into public.opps_quote_events (
    quote_id, tenant_id, revision_id, event_type, actor_kind,
    actor_user_id, actor_label, actor_email, note, metadata
  ) values (
    v_quote.id, v_quote.tenant_id, v_quote.accepted_revision_id, 'accepted', 'staff',
    v_user_id, v_actor_label, v_actor_email, v_note,
    jsonb_build_object(
      'approval_mode', 'on_behalf',
      'approval_source', v_source,
      'accepted_revision_number', v_rev_no
    )
  );

  return jsonb_build_object(
    'ok', true,
    'status', 'accepted',
    'quote_number', v_quote.quote_number,
    'accepted_revision_number', v_rev_no,
    'accepted_at', v_quote.accepted_at
  );
end;
$function$;

-- ACL pattern mirrors other authenticated-staff-only RPCs in this codebase
-- (e.g. public.get_my_client_identity, 202608300001): revoke from public
-- and anon explicitly, grant only to authenticated. Unlike
-- accept_public_quote (which is intentionally also granted to anon, since
-- it is reached via an unauthenticated public share link), this function
-- must never be callable by anon -- it is a staff action, gated on a real
-- auth.uid() and an explicit role check above.
revoke all on function public.accept_quote_on_behalf(uuid, integer, text, text) from public, anon;
grant execute on function public.accept_quote_on_behalf(uuid, integer, text, text) to authenticated;
