-- Staff-facing "Approve & activate payment" action for X LAB quote requests.
-- Wraps public._activate_client_quote_request_order (defined in X LAB's own
-- migrations, same shared schema) with the identical tenant-scoping pattern
-- used by update_internal_client_request_status in
-- 202606200007_tenant_xlab_request_rpcs.sql. Does not touch orders.status,
-- PayFast, or sync-to-opps in any way.
--
-- Depends on X LAB migration 202608050001_quote_approval_and_resource_files.sql
-- having been applied to this same Supabase project first (defines
-- public._activate_client_quote_request_order).

create or replace function public.approve_client_quote_request(
  p_request_id uuid,
  p_items jsonb,
  p_total_amount numeric,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed boolean := false;
begin
  if not public.can_manage_internal_client_requests() then
    raise exception 'Not authorised to approve client requests.';
  end if;

  select exists(
    select 1
    from public.client_quote_requests r
    where r.id = p_request_id
      and r.tenant_id in (select public.current_user_tenant_ids())
  ) into allowed;

  if not allowed then
    raise exception 'Request was not found in your tenant.';
  end if;

  return public._activate_client_quote_request_order(p_request_id, p_items, p_total_amount, p_note, 'staff');
end;
$$;

grant execute on function public.approve_client_quote_request(uuid, jsonb, numeric, text) to authenticated;
revoke execute on function public.approve_client_quote_request(uuid, jsonb, numeric, text) from anon;
