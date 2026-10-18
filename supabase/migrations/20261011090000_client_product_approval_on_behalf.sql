-- feat/opps-quote-approve-on-behalf -- Client Product Approval, Phase B
--
-- Adds public.record_client_product_approval_on_behalf(...): lets a
-- high-trust operator explicitly record that a client approved a client
-- product's current concept/revision through an offline/delegated channel
-- (WhatsApp, email, in person, phone, or other documented channel),
-- WITHOUT ever recording it as though the client approved it themselves
-- through the customer portal.
--
-- Mirrors public.accept_quote_on_behalf (20260930090000_quote_approve_on_behalf.sql)
-- as closely as the two domains allow -- same authorization rationale, same
-- fail-closed revision guard, same "never touch the customer-only RPC"
-- discipline, same actor-identity separation.
--
-- public.client_approvals gains 6 additive, nullable/defaulted columns.
-- No existing column's type/nullability changes. No existing row's meaning
-- changes: actor_kind defaults 'client', which is correct for every row
-- that exists today (all of them came from approve_client_product_concept,
-- the only writer client_approvals has ever had).
--   - actor_kind: 'client' (the existing, only path today) vs 'staff' (this
--     migration's new path). Mirrors opps_quote_events.actor_kind exactly.
--   - recorded_by_user_id / recorded_by_label / recorded_by_email: the
--     ACTING STAFF MEMBER's own identity, resolved server-side from
--     public.users, same coalesce(preferred_name, full_name, user_email)
--     pattern accept_quote_on_behalf already uses. Deliberately separate
--     from approved_by_name / approved_by_email, which keep meaning exactly
--     what they already mean today -- the CLIENT's own identity. Reusing
--     approved_by_email for the staff actor would conflate the two people;
--     this is the smallest change that doesn't do that.
--   - approval_source / note: same vocabulary as
--     quotes.ON_BEHALF_APPROVABLE_QUOTE_STATUSES' sibling
--     APPROVAL_SOURCE_OPTIONS (whatsapp/email/in_person/phone/other), plus
--     'client_portal' reserved for the existing customer path (not stamped
--     by this migration -- approve_client_product_concept is untouched).
--
-- Authorization is INTENTIONALLY NOT public.has_tenant_permission(), for
-- the exact reason recorded in 20260930090000's header: the Joint X tenant
-- grants the '*' wildcard permission to owner, admin, member, AND staff
-- roles alike in tenant_access_role_permissions, so a permission check
-- would authorize everyone, not just high-trust operators. Authorization
-- here is the same explicit, narrow check as accept_quote_on_behalf:
--   public.is_app_admin()
--   OR an active tenant_memberships row for auth.uid() on the client
--      product's OWN tenant_id (public.client_products.tenant_id, never a
--      client-supplied parameter) with tenant_role IN ('owner', 'admin')
--
-- This migration never alters, calls, or weakens:
--   - public.approve_client_product_concept (customer-only path, untouched)
--   - public._client_product_has_current_approval (its 5-column check is
--     unaffected by these 6 new nullable columns)
--   - any client_product_artwork / order_line_component_snapshots table or
--     function -- clearing CUSTOMER_APPROVAL_MISSING here can never affect
--     artwork readiness, by construction (confirmed live: those blockers
--     are computed from a disjoint set of tables in
--     _compute_order_line_production_readiness).

alter table public.client_approvals
  add column if not exists actor_kind text not null default 'client',
  add column if not exists recorded_by_user_id uuid null,
  add column if not exists recorded_by_label text null,
  add column if not exists recorded_by_email text null,
  add column if not exists approval_source text null,
  add column if not exists note text null;

alter table public.client_approvals
  drop constraint if exists client_approvals_actor_kind_check;
alter table public.client_approvals
  add constraint client_approvals_actor_kind_check
  check (actor_kind in ('client', 'staff'));

alter table public.client_approvals
  drop constraint if exists client_approvals_approval_source_check;
alter table public.client_approvals
  add constraint client_approvals_approval_source_check
  check (approval_source is null or approval_source in
    ('client_portal', 'whatsapp', 'email', 'in_person', 'phone', 'other'));

create or replace function public.record_client_product_approval_on_behalf(
  p_client_product_id uuid,
  p_expected_revision  integer,
  p_approval_source    text,
  p_note               text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_product       public.client_products%rowtype;
  v_client        public.clients%rowtype;
  v_user_id       uuid := auth.uid();
  v_source        text := btrim(coalesce(p_approval_source, ''));
  v_note          text := nullif(btrim(coalesce(p_note, '')), '');
  v_staff_label   text;
  v_staff_email   text;
  v_event_id      uuid;
  v_approval_id   uuid;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'CLIENT_PRODUCT_APPROVAL_AUTH_REQUIRED';
  end if;

  select * into v_product from public.client_products where id = p_client_product_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'CLIENT_PRODUCT_NOT_FOUND';
  end if;

  -- Explicit high-trust check. Deliberately NOT has_tenant_permission() --
  -- see migration header (same rationale as accept_quote_on_behalf).
  -- Tenant isolation is derived from the product row itself
  -- (v_product.tenant_id), never from a client-supplied tenant id.
  if v_product.tenant_id is null then
    raise exception using errcode = 'P0001', message = 'CLIENT_PRODUCT_NOT_FOUND';
  end if;

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
    raise exception using errcode = '42501', message = 'CLIENT_PRODUCT_APPROVAL_ON_BEHALF_DENIED';
  end if;

  -- Same pre-state approve_client_product_concept itself requires -- this
  -- RPC is never a looser definition of "approvable" than the customer
  -- path. Also rejects 'archived' and every other status implicitly, since
  -- it is not in this whitelist.
  if v_product.status not in ('ready_for_client_review', 'client_changes_requested') then
    raise exception using errcode = 'P0001', message = 'CLIENT_PRODUCT_NOT_REVIEWABLE';
  end if;

  if v_source = '' or v_source not in ('whatsapp', 'email', 'in_person', 'phone', 'other') then
    raise exception using errcode = 'P0001', message = 'CLIENT_PRODUCT_APPROVAL_SOURCE_REQUIRED';
  end if;

  -- Fail-closed revision-race guard, same shape as accept_quote_on_behalf's
  -- published-revision check: refuse if the product moved under the caller
  -- between load and confirm.
  if p_expected_revision is distinct from v_product.revision then
    raise exception using errcode = 'P0001', message = 'CLIENT_PRODUCT_REVISION_CHANGED';
  end if;

  -- Duplicate-approval guard. approve_client_product_concept doesn't need
  -- this (a customer re-clicking approve on an already-approved product
  -- can't happen -- the status would no longer be reviewable), but a staff
  -- operator could otherwise double-record the same revision.
  if public._client_product_has_current_approval(v_product.id, v_product.revision) then
    raise exception using errcode = 'P0001', message = 'CLIENT_PRODUCT_ALREADY_APPROVED';
  end if;

  -- Client identity: server-derived from the client's own record, never
  -- from the browser. Keeps approved_by_name/approved_by_email meaning
  -- exactly what they already mean today.
  select * into v_client from public.clients where id = v_product.client_id;

  -- Staff identity: server-derived, kept in separate columns so a
  -- staff-recorded approval can never be mistaken for the client's own.
  select coalesce(nullif(u.preferred_name, ''), u.full_name, u.user_email), u.user_email
    into v_staff_label, v_staff_email
  from public.users u
  where u.auth_user_id = v_user_id
  limit 1;

  insert into public.client_approvals (
    client_id, approval_type, related_table, related_id, status,
    approved_by_name, approved_by_email, approved_at, revision,
    actor_kind, recorded_by_user_id, recorded_by_label, recorded_by_email,
    approval_source, note
  ) values (
    v_product.client_id, 'client_product_concept', 'client_products', v_product.id, 'approved',
    v_client.name, v_client.email, now(), v_product.revision,
    'staff', v_user_id, v_staff_label, v_staff_email,
    v_source, v_note
  )
  returning id into v_approval_id;

  update public.client_products
  set status = 'client_approved'
  where id = v_product.id
  returning * into v_product;

  insert into public.opps_activity_events (
    tenant_id, actor_email, actor_name, event_type, entity_type, entity_id, summary, metadata
  ) values (
    v_product.tenant_id,
    coalesce(v_staff_email, auth.jwt() ->> 'email', 'unknown'),
    v_staff_label,
    'client_product_approval_recorded',
    'client_products',
    v_product.id,
    format('%s recorded client approval on behalf for %s (revision %s)',
      coalesce(v_staff_label, 'Staff'), coalesce(v_product.client_facing_name, v_product.id::text), v_product.revision),
    jsonb_build_object(
      'approval_mode', 'on_behalf',
      'approval_source', v_source,
      'revision', v_product.revision,
      'client_approval_id', v_approval_id
    )
  )
  returning id into v_event_id;

  return jsonb_build_object(
    'ok', true,
    'client_product_id', v_product.id,
    'status', v_product.status,
    'revision', v_product.revision,
    'approval_id', v_approval_id,
    'activity_event_id', v_event_id
  );
end;
$function$;

-- ACL pattern mirrors accept_quote_on_behalf: revoke from public/anon
-- explicitly, grant only to authenticated. This is a staff action, gated
-- on a real auth.uid() and the explicit role check above -- never callable
-- by anon.
revoke all on function public.record_client_product_approval_on_behalf(uuid, integer, text, text) from public, anon;
grant execute on function public.record_client_product_approval_on_behalf(uuid, integer, text, text) to authenticated;

-- admin_get_client_product_approvals (X LAB migration 202608120004) is the
-- ONLY read path client_approvals rows ever leave through for this UI --
-- direct table SELECT is RLS-gated to is_admin() only, which OPPS staff
-- are not. Its RETURNS TABLE column list must widen additively so the
-- Status tab can tell a client-direct approval from a staff-recorded one;
-- every existing column keeps its exact name, type and ordering (the new
-- columns are appended at the end), so no existing caller (X LAB's own
-- admin UI included) can be affected by this. Postgres does not allow
-- CREATE OR REPLACE to change a function's OUT/RETURNS TABLE signature, so
-- this must drop and recreate; the same grants verified live above are
-- re-applied immediately after.
drop function if exists public.admin_get_client_product_approvals(uuid);

create function public.admin_get_client_product_approvals(p_client_product_id uuid)
returns table (
  id uuid, status text, approved_by_email text, approved_at timestamp with time zone,
  rejected_reason text, revision integer, created_at timestamp with time zone,
  actor_kind text, recorded_by_label text, recorded_by_email text,
  approval_source text, note text
)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  if p_client_product_id is null then
    return;
  end if;

  if not exists (
    select 1 from public.client_products cp
    where cp.id = p_client_product_id
      and cp.tenant_id is not null
      and public.can_access_tenant(cp.tenant_id)
  ) then
    return;
  end if;

  return query
  select ca.id, ca.status, ca.approved_by_email, ca.approved_at, ca.rejected_reason, ca.revision, ca.created_at,
         ca.actor_kind, ca.recorded_by_label, ca.recorded_by_email, ca.approval_source, ca.note
  from public.client_approvals ca
  where ca.related_table = 'client_products'
    and ca.related_id = p_client_product_id
  order by ca.created_at desc;
end;
$function$;

revoke all on function public.admin_get_client_product_approvals(uuid) from public, anon;
grant execute on function public.admin_get_client_product_approvals(uuid) to authenticated, service_role;
