-- Internal OPPS visibility for X LAB client account submissions.
-- Depends on the X LAB client account foundation migration.

create or replace function public.current_internal_user_role()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role
  from public.users
  where auth_user_id = auth.uid()
     or lower(user_email) = lower(auth.jwt() ->> 'email')
  order by case when auth_user_id = auth.uid() then 0 else 1 end
  limit 1;
$$;

create or replace function public.can_manage_internal_client_requests()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    public.current_internal_user_role() in (
      'admin',
      'owner',
      'ops',
      'operations',
      'ops_manager',
      'manager',
      'production',
      'support',
      'sales'
    )
    or lower(auth.jwt() ->> 'email') = 'jointx.co@gmail.com',
    false
  );
$$;

grant execute on function public.current_internal_user_role() to authenticated;
grant execute on function public.can_manage_internal_client_requests() to authenticated;
revoke execute on function public.current_internal_user_role() from anon;
revoke execute on function public.can_manage_internal_client_requests() from anon;

create or replace function public.get_internal_client_requests(
  p_type text default null,
  p_status text default null,
  p_source_app text default null,
  p_search text default null,
  p_limit int default 50
)
returns table (
  id uuid,
  request_type text,
  status text,
  client_id uuid,
  client_email text,
  client_name text,
  source_app text,
  created_at timestamptz,
  preview text,
  payload jsonb
)
language plpgsql
security definer
set search_path = public
as $$
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
      ) as payload
    from public.client_quote_requests q
    left join public.clients c on c.id = q.client_id

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
      )
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
      )
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
      )
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
      )
    from public.client_special_instructions si
    left join public.clients c on c.id = si.client_id

    union all

    select
      a.id,
      'approval'::text,
      coalesce(a.status, 'pending')::text,
      a.client_id,
      c.email::text,
      c.name::text,
      'xlab'::text,
      a.created_at,
      left(coalesce(a.approval_type, 'Approval'), 240)::text,
      jsonb_build_object(
        'approval_type', a.approval_type,
        'related_table', a.related_table,
        'related_id', a.related_id,
        'approved_by_name', a.approved_by_name,
        'approved_by_email', a.approved_by_email,
        'approved_at', a.approved_at,
        'rejected_reason', a.rejected_reason
      )
    from public.client_approvals a
    left join public.clients c on c.id = a.client_id

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
      )
    from public.client_contract_acceptances ca
    left join public.client_contract_templates ct on ct.id = ca.contract_template_id
    left join public.clients c on c.id = ca.client_id
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
$$;

grant execute on function public.get_internal_client_requests(text, text, text, text, int) to authenticated;
revoke execute on function public.get_internal_client_requests(text, text, text, text, int) from anon;

create or replace function public.update_internal_client_request_status(
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
begin
  if not public.can_manage_internal_client_requests() then
    raise exception 'Not authorised to update client requests.';
  end if;

  if clean_type in ('quote_request', 'reorder_request') then
    if clean_status not in ('new', 'reviewing', 'actioned', 'closed') then
      raise exception 'Invalid quote request status.';
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

grant execute on function public.update_internal_client_request_status(text, uuid, text) to authenticated;
revoke execute on function public.update_internal_client_request_status(text, uuid, text) from anon;
