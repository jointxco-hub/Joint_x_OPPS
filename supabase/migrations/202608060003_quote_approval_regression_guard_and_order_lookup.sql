-- Manual browser acceptance test for recovery/xlab-quote-approval found a
-- linked, already-approved quote_request whose status had been moved back
-- to 'reviewing' via update_internal_client_request_status. That silently
-- reopens QuoteApprovalSection's editable approval form
-- (src/pages/ClientRequests.jsx) over a request that already has a real
-- xlab_orders row in pending_payment - a second approval attempt from there
-- fails loudly at the database layer (_activate_client_quote_request_order's
-- "already been activated" guard), but the UI never should have offered the
-- form again in the first place.
--
-- Two things fix this as defence in depth:
--   1. A database guard (this migration): once a quote_request/
--      reorder_request is linked to an xlab_orders row via
--      source_quote_request_id, its status can no longer move back to
--      new/reviewing through update_internal_client_request_status. It can
--      stay actioned or move to the other intentional terminal state,
--      closed. The error is a plain raise exception with a specific
--      message, so the frontend surfaces it as-is (see
--      updateMutation.onError in ClientRequests.jsx) rather than a raw
--      Postgres error.
--   2. A UI-side restriction (ClientRequests.jsx, same commit): the status
--      dropdown no longer offers new/reviewing once a quote/reorder request
--      is actioned, so staff cannot even select the blocked transition.
--
-- This also backfills the one inconsistent case already found locally:
-- a linked quote/reorder request whose status is not actioned/closed
-- becomes actioned.
--
-- Re-creates update_internal_client_request_status_unscoped (originally
-- update_internal_client_request_status in
-- 202605240002_internal_client_requests.sql, renamed to _unscoped by
-- 202606200007_tenant_xlab_request_rpcs.sql, which added the tenant-scoped
-- public.update_internal_client_request_status wrapper that calls this one)
-- with one added guard clause in the quote_request/reorder_request branch.
-- Every other branch and behaviour is unchanged from the original.
--
-- Also adds get_client_quote_request_order: a small, tenant-scoped,
-- staff-only lookup so the frontend can show the saved order number, line
-- items, unit prices, and grand total as a read-only result when an
-- already-approved request is reopened, instead of losing that price
-- information (the original client request payload never contained a
-- price - only the approval did).

begin;

create or replace function public.update_internal_client_request_status_unscoped(
  p_type text,
  p_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_type text := lower(trim(coalesce(p_type, '')));
  clean_status text := lower(trim(coalesce(p_status, '')));
  has_linked_order boolean := false;
begin
  if not public.can_manage_internal_client_requests() then
    raise exception 'Not authorised to update client requests.';
  end if;

  if clean_type in ('quote_request', 'reorder_request') then
    if clean_status not in ('new', 'reviewing', 'actioned', 'closed') then
      raise exception 'Invalid quote request status.';
    end if;

    select exists(
      select 1 from public.xlab_orders where source_quote_request_id = p_id
    ) into has_linked_order;

    if has_linked_order and clean_status in ('new', 'reviewing') then
      raise exception 'This request already has a payable order and cannot be moved back to %. Leave it actioned, or close it.', clean_status;
    end if;

    update public.client_quote_requests set status = clean_status where id = p_id;

  elsif clean_type = 'message' then
    if clean_status not in ('new', 'reviewing', 'actioned', 'closed') then
      raise exception 'Invalid message status.';
    end if;
    update public.client_messages set status = clean_status where id = p_id and coalesce(is_internal, false) = false;

  elsif clean_type = 'profile_update' then
    if clean_status not in ('new', 'reviewing', 'actioned', 'closed', 'pending_review') then
      raise exception 'Invalid profile request status.';
    end if;
    update public.client_profile_requests set status = clean_status where id = p_id;

  elsif clean_type = 'special_instruction' then
    if clean_status not in ('new', 'reviewing', 'actioned', 'closed', 'active', 'archived') then
      raise exception 'Invalid instruction status.';
    end if;
    update public.client_special_instructions set status = clean_status where id = p_id;

  elsif clean_type = 'tech_pack' then
    if clean_status not in ('needs_client_approval', 'approved', 'updated_needs_reapproval', 'archived') then
      raise exception 'Invalid tech pack status.';
    end if;
    update public.client_tech_packs set status = clean_status where id = p_id;

  else
    raise exception 'Status updates are not supported for this request type.';
  end if;

  return jsonb_build_object('ok', true, 'id', p_id, 'request_type', clean_type, 'status', clean_status);
end;
$$;

-- Backfill: correct any quote_request/reorder_request already linked to an
-- xlab_orders row whose status is not actioned/closed - a pre-existing
-- inconsistency from before this guard existed. Restores the read-only
-- "already actioned" state in the UI instead of re-offering the approval
-- form.
update public.client_quote_requests r
set status = 'actioned'
where status not in ('actioned', 'closed')
  and exists (
    select 1 from public.xlab_orders xo where xo.source_quote_request_id = r.id
  );

create or replace function public.get_client_quote_request_order(
  p_request_id uuid
)
returns table (
  id uuid,
  order_number text,
  items jsonb,
  subtotal numeric,
  total_amount numeric,
  status text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_manage_internal_client_requests() then
    raise exception 'Not authorised to view client orders.';
  end if;

  return query
  select xo.id, xo.order_number, xo.items, xo.subtotal, xo.total_amount, xo.status, xo.created_at
  from public.xlab_orders xo
  where xo.source_quote_request_id = p_request_id
    and xo.tenant_id in (select public.current_user_tenant_ids())
  order by xo.created_at desc
  limit 1;
end;
$$;

grant execute on function public.get_client_quote_request_order(uuid) to authenticated;
revoke execute on function public.get_client_quote_request_order(uuid) from anon;

commit;
