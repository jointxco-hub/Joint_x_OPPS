-- Phase 4A: smallest safe XOS demo modules for Requests and Files.
-- Host-scoped, membership-gated, and intentionally client-facing only.

create or replace function public.get_xos_requests_for_host(
  p_hostname text,
  p_limit int default 20
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  resolved_tenant_id uuid;
  safe_limit int := least(greatest(coalesce(p_limit, 20), 1), 50);
  result jsonb;
begin
  select tenant_id
  into resolved_tenant_id
  from public.resolve_authenticated_tenant_host(p_hostname, 'xos_admin')
  limit 1;

  if resolved_tenant_id is null then
    raise exception 'XOS access denied.';
  end if;

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
      left(coalesce(q.project_name, 'Quote request'), 160)::text as title,
      left(coalesce(q.details, 'Client request'), 280)::text as preview,
      coalesce(q.client_name, c.name, 'Client')::text as client_name,
      coalesce(q.source_app, 'xlab')::text as source_app,
      q.created_at
    from public.client_quote_requests q
    left join public.clients c on c.id = q.client_id and c.tenant_id = q.tenant_id
    where q.tenant_id = resolved_tenant_id

    union all

    select
      m.id,
      'message'::text,
      coalesce(m.status, 'new')::text,
      left(coalesce(m.subject, 'Client message'), 160)::text,
      left(coalesce(m.message, 'Client message'), 280)::text,
      coalesce(c.name, 'Client')::text,
      coalesce(m.source_app, 'xlab')::text,
      m.created_at
    from public.client_messages m
    left join public.clients c on c.id = m.client_id and c.tenant_id = m.tenant_id
    where m.tenant_id = resolved_tenant_id
      and coalesce(m.is_internal, false) = false

    union all

    select
      p.id,
      'profile_update'::text,
      coalesce(p.status, 'pending_review')::text,
      'Profile update'::text,
      left(concat_ws(' ', p.name, p.company_name, p.brand_name, p.phone), 280)::text,
      coalesce(p.name, c.name, 'Client')::text,
      coalesce(p.source_app, 'xlab')::text,
      p.created_at
    from public.client_profile_requests p
    left join public.clients c on c.id = p.client_id and c.tenant_id = p.tenant_id
    where p.tenant_id = resolved_tenant_id
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'request_type', request_type,
      'status', status,
      'title', title,
      'preview', preview,
      'client_name', client_name,
      'source_app', source_app,
      'created_at', created_at
    )
    order by created_at desc
  ), '[]'::jsonb)
  into result
  from (
    select *
    from normalized
    order by created_at desc
    limit safe_limit
  ) limited;

  return result;
end;
$$;

create or replace function public.get_xos_files_for_host(
  p_hostname text,
  p_limit int default 20
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  resolved_tenant_id uuid;
  safe_limit int := least(greatest(coalesce(p_limit, 20), 1), 50);
  result jsonb;
begin
  select tenant_id
  into resolved_tenant_id
  from public.resolve_authenticated_tenant_host(p_hostname, 'xos_admin')
  limit 1;

  if resolved_tenant_id is null then
    raise exception 'XOS access denied.';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', file_row.id,
      'file_name', file_row.file_name,
      'file_type', file_row.file_type,
      'file_size', file_row.file_size,
      'folder_name', file_row.folder_name,
      'source_app', file_row.source_app,
      'created_at', file_row.created_at,
      'file_ref', file_row.file_url
    )
    order by file_row.created_at desc
  ), '[]'::jsonb)
  into result
  from (
    select
      l.id,
      l.file_name,
      l.file_type,
      l.file_size,
      f.name as folder_name,
      coalesce(l.source_app, 'xlab') as source_app,
      l.created_at,
      l.file_url
    from public.client_file_links l
    left join public.client_file_folders f
      on f.id = l.folder_id
      and f.tenant_id = l.tenant_id
    where l.tenant_id = resolved_tenant_id
      and l.file_url like 'private-upload://uploads/%'
      and public.xlab_bridge_file_ref_matches_tenant(l.file_url, resolved_tenant_id)
    order by l.created_at desc
    limit safe_limit
  ) file_row;

  return result;
end;
$$;

revoke execute on function public.get_xos_requests_for_host(text, int) from public, anon;
revoke execute on function public.get_xos_files_for_host(text, int) from public, anon;
grant execute on function public.get_xos_requests_for_host(text, int) to authenticated;
grant execute on function public.get_xos_files_for_host(text, int) to authenticated;

do $$
declare
  demo_tenant_id uuid;
  demo_client_id uuid;
  demo_folder_id uuid;
  demo_file_path_a text;
  demo_file_path_b text;
begin
  insert into public.tenants (slug, name, status)
  values ('demo-xos', 'Demo XOS', 'active')
  on conflict (slug) do update
  set name = excluded.name,
      status = excluded.status;

  select id into demo_tenant_id
  from public.tenants
  where slug = 'demo-xos';

  insert into public.tenant_domains (tenant_id, hostname, surface, status, is_primary, verified_at)
  values (demo_tenant_id, 'demo.xos.jointx.co.za', 'xos_admin', 'active', true, now())
  on conflict (hostname, surface) do update
  set tenant_id = excluded.tenant_id,
      status = excluded.status,
      is_primary = excluded.is_primary,
      verified_at = coalesce(public.tenant_domains.verified_at, excluded.verified_at);

  delete from public.client_file_links
  where tenant_id = demo_tenant_id
    and client_email = 'demo-xos-client@example.test';
  delete from public.client_file_folders
  where tenant_id = demo_tenant_id
    and client_email = 'demo-xos-client@example.test';
  delete from public.client_messages
  where tenant_id = demo_tenant_id
    and client_email = 'demo-xos-client@example.test'
    and subject like 'DEMO-XOS%';
  delete from public.client_quote_requests
  where tenant_id = demo_tenant_id
    and client_email = 'demo-xos-client@example.test'
    and project_name like 'DEMO-XOS%';
  delete from public.clients
  where tenant_id = demo_tenant_id
    and email = 'demo-xos-client@example.test';

  insert into public.clients (tenant_id, name, email, status, portal_enabled)
  values (demo_tenant_id, 'DEMO-XOS Client', 'demo-xos-client@example.test', 'active', true)
  returning id into demo_client_id;

  insert into public.client_quote_requests (
    tenant_id,
    client_id,
    client_email,
    client_name,
    project_name,
    quantity,
    details,
    source_app,
    status
  )
  values
    (
      demo_tenant_id,
      demo_client_id,
      'demo-xos-client@example.test',
      'DEMO-XOS Client',
      'DEMO-XOS sample request',
      '24 units',
      'Client-facing demo request for XOS Phase 4A.',
      'xos-demo',
      'new'
    ),
    (
      demo_tenant_id,
      demo_client_id,
      'demo-xos-client@example.test',
      'DEMO-XOS Client',
      'DEMO-XOS reorder request',
      '12 units',
      'Reorder request demo visible only inside the demo-xos tenant.',
      'xos-demo',
      'reviewing'
    );

  insert into public.client_messages (
    tenant_id,
    client_id,
    client_email,
    subject,
    message,
    sender_type,
    is_internal,
    status,
    source_app
  )
  values (
    demo_tenant_id,
    demo_client_id,
    'demo-xos-client@example.test',
    'DEMO-XOS onboarding question',
    'Client-facing demo message for the Requests module.',
    'client',
    false,
    'new',
    'xos-demo'
  );

  insert into public.client_file_folders (
    tenant_id,
    client_id,
    client_email,
    name,
    folder_type,
    source_app
  )
  values (
    demo_tenant_id,
    demo_client_id,
    'demo-xos-client@example.test',
    'DEMO-XOS Files',
    'demo',
    'xos-demo'
  )
  returning id into demo_folder_id;

  demo_file_path_a := demo_tenant_id::text || '/xos-demo/welcome-note.txt';
  demo_file_path_b := demo_tenant_id::text || '/xos-demo/brand-brief.pdf';

  insert into public.client_file_links (
    tenant_id,
    client_id,
    client_email,
    file_url,
    file_name,
    file_type,
    file_size,
    folder_id,
    uploaded_by_type,
    source_app
  )
  values
    (
      demo_tenant_id,
      demo_client_id,
      'demo-xos-client@example.test',
      'private-upload://uploads/' || demo_file_path_a,
      'DEMO-XOS welcome note.txt',
      'text/plain',
      128,
      demo_folder_id,
      'internal',
      'xos-demo'
    ),
    (
      demo_tenant_id,
      demo_client_id,
      'demo-xos-client@example.test',
      'private-upload://uploads/' || demo_file_path_b,
      'DEMO-XOS brand brief.pdf',
      'application/pdf',
      2048,
      demo_folder_id,
      'internal',
      'xos-demo'
    );

  insert into storage.objects (bucket_id, name, metadata, owner_id)
  values
    ('uploads', demo_file_path_a, jsonb_build_object('mimetype', 'text/plain', 'size', 128), null),
    ('uploads', demo_file_path_b, jsonb_build_object('mimetype', 'application/pdf', 'size', 2048), null)
  on conflict (bucket_id, name) do update
  set metadata = excluded.metadata,
      updated_at = now();
end;
$$;
