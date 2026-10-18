-- feat/opps-quote-approve-on-behalf -- Artwork Approval, Phase B
--
-- Adds public.confirm_client_product_artwork_production_file(...): lets a
-- high-trust operator explicitly confirm (or request changes to) the
-- CURRENT revision of an artwork placement as production-ready.
--
-- Phase A audit (live, verified against production before this migration
-- was written) found:
--   - client_product_artwork.status has NO function that ever sets it to
--     'approved' or 'rejected' - only a permissive RLS policy
--     ("Staff manage client product artwork", ALL commands, gated only on
--     is_opps_staff() + tenant access, no role tier, no audit requirement)
--     allows any staff member to flip it via a raw direct UPDATE.
--   - No actor/timestamp evidence column exists at all - status='approved'
--     was the ONLY evidence.
--   - This is a SEPARATE concept from client_approvals/
--     approval_type='client_product_concept' (the customer's concept/
--     design approval, Client Product Approval Phase B-E). That concept
--     is customer-facing; this one is Joint X confirming the exact FILE
--     is fit for production - the live UI wording
--     ("production file confirmation pending") already said so. This
--     migration does not change that separation - it only gives the
--     ALREADY-SEPARATE "production file" concept its own proper,
--     audited, authorized action, instead of a permissive RLS hole.
--   - _compute_order_line_production_readiness (order-line readiness,
--     already fully green for this order) checks only that a frozen
--     artwork_revision_id EXISTS and resolves unambiguously to a
--     placement - never status, never is_current. Confirming/rejecting a
--     production file here cannot affect order-line readiness, by
--     construction, confirmed live before this migration was written.
--   - The ready_to_order DB trigger
--     (_enforce_client_product_ready_to_order_artwork_guard) checks only
--     whether required_artwork_placements has been confirmed - never
--     artwork status. This migration does not change that trigger.
--   - _compute_artwork_readiness picks the best row per placement via
--     ORDER BY is_current DESC, revision DESC LIMIT 1 - a non-current
--     row (e.g. JV1 Sky Blue revision 1, now superseded by Pitch Black
--     revision 2) is never surfaced by it once superseded, and its
--     'ready' boolean additionally requires is_current=true - so
--     confirming/rejecting the CURRENT revision can never retroactively
--     make a historical revision count as "ready", and never touches the
--     historical row at all (this RPC refuses non-current rows outright,
--     see guard below).
--
-- Columns added to client_product_artwork (additive, nullable - no
-- existing row's id/revision/is_current/file_path/placement/status/
-- snapshot link changes meaning or value):
--   confirmed_by_user_id / confirmed_by_label: the ACTING STAFF MEMBER's
--     own identity, resolved server-side from public.users, same
--     coalesce(preferred_name, full_name, user_email) pattern
--     accept_quote_on_behalf / record_client_product_approval_on_behalf
--     already use.
--   confirmed_at: when the decision (approve OR reject) was recorded.
--   review_note: optional staff note on the decision. The existing
--     `notes` column is confirmed live-unused (0 of 22 rows populated) but
--     is kept for whatever it was originally intended for - this is a
--     distinct, dedicated field for the review decision specifically.
--
-- Authorization mirrors record_client_product_approval_on_behalf
-- (20261011090000) and accept_quote_on_behalf (20260930090000) exactly,
-- for the same reason recorded in both of their headers:
-- has_tenant_permission() is not safe for this tier of action in this
-- tenant. Tenant is derived server-side from
-- artwork -> client_products.tenant_id - never a browser parameter.
--   public.is_app_admin()
--   OR an active tenant_memberships row for auth.uid() on the ARTWORK's
--      OWN PRODUCT's tenant_id with tenant_role IN ('owner', 'admin')
--
-- This migration never alters, calls, or weakens:
--   - public.approve_client_product_concept / client_approvals (the
--     separate customer-concept-approval path)
--   - public.record_client_product_approval_on_behalf
--   - public._client_product_has_current_approval
--   - public._compute_order_line_production_readiness
--   - public._compute_artwork_readiness
--   - the ready_to_order DB trigger
--   - order_line_component_snapshots in any way

alter table public.client_product_artwork
  add column if not exists confirmed_by_user_id uuid null,
  add column if not exists confirmed_by_label text null,
  add column if not exists confirmed_at timestamptz null,
  add column if not exists review_note text null;

create or replace function public.confirm_client_product_artwork_production_file(
  p_artwork_id        uuid,
  p_expected_revision integer,
  p_decision          text,
  p_note              text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_artwork     public.client_product_artwork%rowtype;
  v_product     public.client_products%rowtype;
  v_user_id     uuid := auth.uid();
  v_decision    text := btrim(coalesce(p_decision, ''));
  v_note        text := nullif(btrim(coalesce(p_note, '')), '');
  v_staff_label text;
  v_staff_email text;
  v_event_id    uuid;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'ARTWORK_REVIEW_AUTH_REQUIRED';
  end if;

  -- Decision must be exactly one of the two real review outcomes - never
  -- 'pending' (the default, not a decision) or 'superseded' (a dead value
  -- nothing in this system has ever written) through this action.
  if v_decision not in ('approved', 'rejected') then
    raise exception using errcode = 'P0001', message = 'ARTWORK_REVIEW_DECISION_INVALID';
  end if;

  select * into v_artwork from public.client_product_artwork where id = p_artwork_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ARTWORK_REVIEW_NOT_FOUND';
  end if;

  select * into v_product from public.client_products where id = v_artwork.client_product_id;
  if not found or v_product.tenant_id is null then
    raise exception using errcode = 'P0001', message = 'ARTWORK_REVIEW_NOT_FOUND';
  end if;

  -- Explicit high-trust check. Deliberately NOT has_tenant_permission() --
  -- see migration header. Tenant isolation is derived from the artwork's
  -- own product row (v_product.tenant_id), never from a client-supplied
  -- tenant id.
  if not (
    public.is_app_admin()
    or exists (
      select 1
      from public.tenant_memberships tm
      where tm.auth_user_id = v_user_id
        and tm.tenant_id = v_product.tenant_id
        and tm.status = 'active'
        and tm.tenant_role in ('owner', 'admin')
    )
  ) then
    raise exception using errcode = '42501', message = 'ARTWORK_REVIEW_DENIED';
  end if;

  if p_expected_revision is distinct from v_artwork.revision then
    raise exception using errcode = 'P0001', message = 'ARTWORK_REVIEW_REVISION_CHANGED';
  end if;

  -- A non-current (historical/superseded-by-is_current) revision is never
  -- reviewable through this current-file workflow - confirming or
  -- rejecting the live revision must never touch, or be confused with,
  -- an older frozen one (e.g. JV1 Sky Blue revision 1).
  if not v_artwork.is_current then
    raise exception using errcode = 'P0001', message = 'ARTWORK_REVIEW_NOT_CURRENT';
  end if;

  if v_artwork.status not in ('pending', 'approved', 'rejected') then
    raise exception using errcode = 'P0001', message = 'ARTWORK_REVIEW_NOT_REVIEWABLE';
  end if;

  -- No-op guard: a decision identical to the row's current status writes
  -- nothing and is rejected, rather than spending a no-op update/event -
  -- same discipline as revise_order_line_component_snapshot_artwork's own
  -- no-op guard.
  if v_artwork.status = v_decision then
    raise exception using errcode = 'P0001', message = 'ARTWORK_REVIEW_NO_CHANGE';
  end if;

  select coalesce(nullif(u.preferred_name, ''), u.full_name, u.user_email), u.user_email
    into v_staff_label, v_staff_email
  from public.users u
  where u.auth_user_id = v_user_id
  limit 1;

  update public.client_product_artwork
  set status = v_decision,
      confirmed_by_user_id = v_user_id,
      confirmed_by_label = v_staff_label,
      confirmed_at = now(),
      review_note = v_note
  where id = v_artwork.id
  returning * into v_artwork;

  insert into public.opps_activity_events (
    tenant_id, actor_email, actor_name, event_type, entity_type, entity_id, summary, metadata
  ) values (
    v_product.tenant_id,
    coalesce(v_staff_email, 'unknown'),
    v_staff_label,
    case when v_decision = 'approved'
      then 'client_product_artwork_production_confirmed'
      else 'client_product_artwork_changes_requested'
    end,
    'client_product_artwork',
    v_artwork.id,
    format('%s %s the production file for %s (%s, revision %s)',
      coalesce(v_staff_label, 'Staff'),
      case when v_decision = 'approved' then 'confirmed' else 'requested changes to' end,
      coalesce(v_product.client_facing_name, v_product.id::text),
      v_artwork.placement, v_artwork.revision),
    jsonb_build_object(
      'decision', v_decision,
      'placement', v_artwork.placement,
      'revision', v_artwork.revision,
      'note', v_note
    )
  )
  returning id into v_event_id;

  return jsonb_build_object(
    'ok', true,
    'artwork_id', v_artwork.id,
    'client_product_id', v_artwork.client_product_id,
    'status', v_artwork.status,
    'placement', v_artwork.placement,
    'revision', v_artwork.revision,
    'activity_event_id', v_event_id
  );
end;
$function$;

revoke all on function public.confirm_client_product_artwork_production_file(uuid, integer, text, text) from public, anon;
grant execute on function public.confirm_client_product_artwork_production_file(uuid, integer, text, text) to authenticated;
