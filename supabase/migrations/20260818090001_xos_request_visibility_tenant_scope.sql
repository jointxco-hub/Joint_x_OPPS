-- XOS 2.5 - Decision 1: request visibility fix.
--
-- Root cause (see docs/XOS_2_5_REQUEST_VISIBILITY_FIX.md for full detail):
-- create_xos_request_for_host() tolerates no client match and inserts with
-- client_id = NULL. get_internal_client_requests() authorized purely via
-- `join public.clients client on client.id = request.client_id`, an INNER
-- JOIN - any request with a NULL client_id was silently excluded from OPPS
-- forever, regardless of tenant. Confirmed live and historical (a request
-- from 2026-06-27 has had this exact problem the whole time).
--
-- Fix: give get_internal_client_requests_unscoped() a tenant_id column,
-- populated from each source table's own tenant_id where it exists
-- (client_quote_requests, client_messages, client_profile_requests,
-- client_products), falling back to the joined client's tenant_id where a
-- table has no tenant_id column of its own (client_tech_packs,
-- client_special_instructions, client_approvals,
-- client_contract_acceptances) or where the native tenant_id is itself
-- null on a legacy row. get_internal_client_requests() then authorizes on
-- `request.tenant_id in (current_user_tenant_ids())` instead of the client
-- join. Client association remains optional, display-only metadata - it no
-- longer gates visibility.
--
-- Previous definitions of both functions are captured verbatim in
-- docs/XOS_2_5_REQUEST_VISIBILITY_FIX.md before this migration, for
-- rollback reference.
--
-- get_internal_client_requests_unscoped's output columns are changing (a
-- new tenant_id column), and Postgres refuses to CREATE OR REPLACE a
-- table-returning function across an OUT-parameter change ("cannot change
-- return type of existing function ... Row type defined by OUT parameters
-- is different") - it must be dropped first. get_internal_client_requests
-- keeps its exact original return shape (only its body changes), so it
-- does not need a drop.

drop function if exists public.get_internal_client_requests_unscoped(text, text, text, text, integer);

create or replace function public.get_internal_client_requests_unscoped(
  p_type text default null::text,
  p_status text default null::text,
  p_source_app text default null::text,
  p_search text default null::text,
  p_limit integer default 50
)
returns table(
  id uuid,
  request_type text,
  status text,
  client_id uuid,
  client_email text,
  client_name text,
  source_app text,
  created_at timestamp with time zone,
  preview text,
  payload jsonb,
  tenant_id uuid
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  clean_type text := nullif(lower(trim(coalesce(p_type, ''))), '');
  clean_status text := nullif(lower(trim(coalesce(p_status, ''))), '');
  clean_source text := nullif(lower(trim(coalesce(p_source_app, ''))), '');
  clean_search text := nullif(lower(trim(coalesce(p_search, ''))), '');
  safe_limit int := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  if not public.can_manage_internal_client_requests() then
    raise exception 'Not authorised to view client requests.';
  end if;

  return query
  with normalized as (
    select
      q.id,
      case
        when lower(coalesce(q.project_name, '')) like 'reorder %'
          or lower(coalesce(q.details, '')) like 'reorder request%'
          then 'reorder_request'
        else 'quote_request'
      end::text as request_type,
      coalesce(q.status, 'new')::text as status,
      q.client_id,
      q.client_email,
      coalesce(q.client_name, c.name)::text as client_name,
      coalesce(q.source_app, 'xlab')::text as source_app,
      q.created_at,
      left(coalesce(q.project_name, q.details, 'Quote request'), 240)::text as preview,
      jsonb_build_object(
        'project_name', q.project_name,
        'quantity', q.quantity,
        'deadline', q.deadline,
        'details', q.details,
        'updated_at', q.updated_at
      ) as payload,
      coalesce(q.tenant_id, c.tenant_id) as tenant_id
    from public.client_quote_requests q
    left join public.clients c on c.id = q.client_id
    where coalesce(q.status, 'new') <> 'draft'

    union all

    select
      m.id,
      'message'::text,
      coalesce(m.status, 'new')::text,
      m.client_id,
      m.client_email,
      c.name::text,
      coalesce(m.source_app, 'xlab')::text,
      m.created_at,
      left(coalesce(m.subject, m.message, 'Client message'), 240)::text,
      jsonb_build_object(
        'subject', m.subject,
        'message', m.message,
        'sender_type', m.sender_type,
        'is_internal', m.is_internal,
        'order_id', m.order_id,
        'xlab_order_id', m.xlab_order_id
      ),
      coalesce(m.tenant_id, c.tenant_id)
    from public.client_messages m
    left join public.clients c on c.id = m.client_id
    where coalesce(m.is_internal, false) = false

    union all

    select
      p.id,
      'profile_update'::text,
      coalesce(p.status, 'pending_review')::text,
      p.client_id,
      p.client_email,
      coalesce(p.name, c.name)::text,
      coalesce(p.source_app, 'xlab')::text,
      p.created_at,
      left(concat_ws(' ', p.name, p.company_name, p.brand_name, p.phone), 240)::text,
      jsonb_build_object(
        'name', p.name,
        'phone', p.phone,
        'company_name', p.company_name,
        'brand_name', p.brand_name,
        'delivery_address', p.delivery_address
      ),
      coalesce(p.tenant_id, c.tenant_id)
    from public.client_profile_requests p
    left join public.clients c on c.id = p.client_id

    union all

    select
      tp.id,
      'tech_pack'::text,
      coalesce(tp.status, 'draft')::text,
      tp.client_id,
      c.email::text,
      c.name::text,
      coalesce(tp.source_app, 'xlab')::text,
      tp.created_at,
      left(coalesce(tp.title, 'Brand Setup'), 240)::text,
      jsonb_build_object(
        'title', tp.title,
        'tech_pack_type', tp.tech_pack_type,
        'template_name', t.name,
        'specs', tp.specs,
        'approved_version_id', tp.approved_version_id,
        'updated_at', tp.updated_at
      ),
      c.tenant_id
    from public.client_tech_packs tp
    left join public.clients c on c.id = tp.client_id
    left join public.client_tech_pack_templates t on t.id = tp.template_id

    union all

    select
      si.id,
      'special_instruction'::text,
      coalesce(si.status, 'active')::text,
      si.client_id,
      c.email::text,
      c.name::text,
      'xlab'::text,
      si.created_at,
      left(coalesce(si.title, si.instruction, 'Special instruction'), 240)::text,
      jsonb_build_object(
        'title', si.title,
        'instruction', si.instruction,
        'instruction_type', si.instruction_type,
        'visibility', si.visibility,
        'requires_approval', si.requires_approval,
        'approved_by_client', si.approved_by_client,
        'approved_at', si.approved_at,
        'updated_at', si.updated_at
      ),
      c.tenant_id
    from public.client_special_instructions si
    left join public.clients c on c.id = si.client_id

    union all

    select
      a.id,
      case
        when a.related_table = 'client_products' and a.status = 'approved' then 'client_product_approved'
        when a.related_table = 'client_products' and a.status = 'rejected' then 'client_product_changes_requested'
        else 'approval'
      end::text,
      coalesce(a.status, 'pending')::text,
      a.client_id,
      c.email::text,
      c.name::text,
      'xlab'::text,
      a.created_at,
      case
        when a.related_table = 'client_products' then left(
          coalesce(cp.client_facing_name, 'Client product') ||
          case when a.status = 'rejected' then ' — changes requested' else ' — concept approved' end,
          240
        )
        else left(coalesce(a.approval_type, 'Approval'), 240)
      end::text,
      case
        when a.related_table = 'client_products' then jsonb_build_object(
          'approval_type', a.approval_type,
          'related_table', a.related_table,
          'related_id', a.related_id,
          'client_product_id', cp.id,
          'client_product_name', cp.client_facing_name,
          'revision', a.revision,
          'approved_by_name', a.approved_by_name,
          'approved_by_email', a.approved_by_email,
          'approved_at', a.approved_at,
          'rejected_reason', a.rejected_reason
        )
        else jsonb_build_object(
          'approval_type', a.approval_type,
          'related_table', a.related_table,
          'related_id', a.related_id,
          'approved_by_name', a.approved_by_name,
          'approved_by_email', a.approved_by_email,
          'approved_at', a.approved_at,
          'rejected_reason', a.rejected_reason
        )
      end,
      c.tenant_id
    from public.client_approvals a
    left join public.clients c on c.id = a.client_id
    left join public.client_products cp on cp.id = a.related_id and a.related_table = 'client_products'

    union all

    select
      ca.id,
      'contract_acceptance'::text,
      'accepted'::text,
      ca.client_id,
      ca.accepted_by_email,
      coalesce(ca.accepted_by_name, c.name)::text,
      'xlab'::text,
      ca.accepted_at,
      left(coalesce(ct.name, 'Contract accepted'), 240)::text,
      jsonb_build_object(
        'contract_name', ct.name,
        'contract_type', ct.contract_type,
        'version', ct.version,
        'accepted_by_name', ca.accepted_by_name,
        'accepted_by_email', ca.accepted_by_email,
        'accepted_at', ca.accepted_at,
        'acceptance_method', ca.acceptance_method,
        'metadata', ca.metadata
      ),
      c.tenant_id
    from public.client_contract_acceptances ca
    left join public.client_contract_templates ct on ct.id = ca.contract_template_id
    left join public.clients c on c.id = ca.client_id

    union all

    select
      cp.id,
      case
        when cp.status = 'ready_for_client_review' then 'client_product_awaiting_client'
        when cp.status = 'client_approved' and cp.client_price is null then 'client_product_pricing_required'
        when cp.status = 'ready_to_order' then 'client_product_ready_to_order'
      end::text,
      case
        when cp.status = 'ready_to_order' then 'ready'
        else 'new'
      end::text,
      cp.client_id,
      c.email::text,
      c.name::text,
      'xlab'::text,
      cp.updated_at,
      left(
        coalesce(cp.client_facing_name, 'Client product') || ' — ' ||
        case
          when cp.status = 'ready_for_client_review' then 'awaiting client review'
          when cp.status = 'client_approved' then 'pricing required'
          when cp.status = 'ready_to_order' then 'ready to order'
        end,
        240
      )::text,
      jsonb_build_object(
        'client_product_id', cp.id,
        'client_product_name', cp.client_facing_name,
        'client_product_status', cp.status,
        'revision', cp.revision,
        'client_price', cp.client_price,
        'visible_in_account', cp.visible_in_account,
        'updated_at', cp.updated_at
      ),
      coalesce(cp.tenant_id, c.tenant_id)
    from public.client_products cp
    left join public.clients c on c.id = cp.client_id
    where cp.status = 'ready_for_client_review'
       or cp.status = 'ready_to_order'
       or (cp.status = 'client_approved' and cp.client_price is null)
  )
  select n.*
  from normalized n
  where (clean_type is null or n.request_type = clean_type)
    and (clean_status is null or lower(n.status) = clean_status)
    and (clean_source is null or lower(n.source_app) = clean_source)
    and (
      clean_search is null
      or lower(coalesce(n.client_email, '')) like '%' || clean_search || '%'
      or lower(coalesce(n.client_name, '')) like '%' || clean_search || '%'
      or lower(coalesce(n.preview, '')) like '%' || clean_search || '%'
      or lower(n.payload::text) like '%' || clean_search || '%'
    )
  order by n.created_at desc
  limit safe_limit;
end;
$function$;

-- Authorization basis changes from "does this request's client belong to
-- one of my tenants" (INNER JOIN, breaks on NULL client_id) to "does this
-- request's own tenant_id belong to one of my tenants" - client_id/name/
-- email remain in the output as optional display metadata only. The public
-- return shape is unchanged from before this migration (no tenant_id
-- leaked to callers of this wrapper).
create or replace function public.get_internal_client_requests(
  p_type text default null::text,
  p_status text default null::text,
  p_source_app text default null::text,
  p_search text default null::text,
  p_limit integer default 50
)
returns table(
  id uuid,
  request_type text,
  status text,
  client_id uuid,
  client_email text,
  client_name text,
  source_app text,
  created_at timestamp with time zone,
  preview text,
  payload jsonb
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.can_manage_internal_client_requests() then
    raise exception 'Not authorised to view client requests.';
  end if;

  return query
  select
    request.id,
    request.request_type,
    request.status,
    request.client_id,
    request.client_email,
    request.client_name,
    request.source_app,
    request.created_at,
    request.preview,
    request.payload
  from public.get_internal_client_requests_unscoped(p_type, p_status, p_source_app, p_search, p_limit) request
  where request.tenant_id in (select public.current_user_tenant_ids());
end;
$function$;

-- Grants: get_internal_client_requests keeps its exact prior signature,
-- so CREATE OR REPLACE preserves its existing grants unchanged (EXECUTE to
-- authenticated, postgres, service_role - no statement needed).
--
-- get_internal_client_requests_unscoped was dropped and recreated above
-- (required for the OUT-parameter change), which does NOT preserve prior
-- grants. Confirmed live during cutover: a fresh CREATE FUNCTION on this
-- project auto-grants EXECUTE to PUBLIC (which anon and authenticated
-- both inherit) - naming individual roles in a REVOKE does not remove
-- that PUBLIC grant, it has to be revoked from PUBLIC explicitly, or this
-- internal-only function becomes directly callable by any signed-in (or
-- even anonymous) caller via PostgREST RPC, bypassing the intended
-- "only reachable through the tenant-scoped wrapper" design - restoring
-- its exact pre-migration grants (postgres, service_role only):
revoke execute on function public.get_internal_client_requests_unscoped(text, text, text, text, integer) from public;
grant execute on function public.get_internal_client_requests_unscoped(text, text, text, text, integer) to postgres;
grant execute on function public.get_internal_client_requests_unscoped(text, text, text, text, integer) to service_role;

-- Re-run the grants query in docs/XOS_2_5_REQUEST_VISIBILITY_FIX.md after
-- applying this migration to confirm both functions end up exactly as
-- documented.
