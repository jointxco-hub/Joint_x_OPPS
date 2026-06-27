-- Run after 202606270003_harden_xlab_bridge_mutations.sql in a disposable or linked QA database.
-- Uses only disposable tenants, users, clients, requests, messages, and file metadata.

do $$
declare
  tenant_a_id uuid;
  tenant_b_id uuid;
  tenant_a_user_id uuid := '00000000-0000-4000-8000-000000000061'::uuid;
  tenant_b_user_id uuid := '00000000-0000-4000-8000-000000000062'::uuid;
  client_a_id uuid;
  client_b_id uuid;
  quote_a_id uuid;
  quote_b_id uuid;
  parent_a_id uuid;
  parent_b_id uuid;
  folder_a public.client_file_folders;
  link_a public.client_file_links;
  link_b_id uuid;
  library jsonb;
  request_count int;
  denied boolean;
begin
  delete from public.client_file_links
  where client_email = 'xlab-bridge-recheck@example.test';
  delete from public.client_file_folders
  where client_email = 'xlab-bridge-recheck@example.test';
  delete from public.client_messages
  where client_email = 'xlab-bridge-recheck@example.test';
  delete from public.client_quote_requests
  where client_email = 'xlab-bridge-recheck@example.test';
  delete from public.orders
  where order_number in ('XLAB-BRIDGE-A', 'XLAB-BRIDGE-B');
  delete from public.projects
  where project_code in ('XLAB-BRIDGE-A', 'XLAB-BRIDGE-B');
  delete from public.clients
  where email = 'xlab-bridge-recheck@example.test';
  delete from public.users
  where auth_user_id in (tenant_a_user_id, tenant_b_user_id)
     or user_email in ('xlab-bridge-a@example.test', 'xlab-bridge-b@example.test');
  delete from public.tenants
  where slug in ('xlab-bridge-a', 'xlab-bridge-b');
  delete from auth.users
  where id in (tenant_a_user_id, tenant_b_user_id);

  insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (tenant_a_user_id, 'authenticated', 'authenticated', 'xlab-bridge-a@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (tenant_b_user_id, 'authenticated', 'authenticated', 'xlab-bridge-b@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

  insert into public.users (auth_user_id, user_email, full_name, role, department, is_active)
  values
    (tenant_a_user_id, 'xlab-bridge-a@example.test', 'X LAB Bridge A', 'ops', 'operations', true),
    (tenant_b_user_id, 'xlab-bridge-b@example.test', 'X LAB Bridge B', 'ops', 'operations', true);

  insert into public.tenants (slug, name, status)
  values
    ('xlab-bridge-a', 'X LAB Bridge Tenant A', 'active'),
    ('xlab-bridge-b', 'X LAB Bridge Tenant B', 'active');

  select id into tenant_a_id from public.tenants where slug = 'xlab-bridge-a';
  select id into tenant_b_id from public.tenants where slug = 'xlab-bridge-b';

  insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role, status)
  values
    (tenant_a_id, tenant_a_user_id, 'member', 'active'),
    (tenant_b_id, tenant_b_user_id, 'member', 'active');

  insert into public.clients (tenant_id, name, email, status, portal_enabled)
  values
    (tenant_a_id, 'X LAB Bridge Client A', 'xlab-bridge-recheck@example.test', 'active', true),
    (tenant_b_id, 'X LAB Bridge Client B', 'xlab-bridge-recheck@example.test', 'active', true);

  select id into client_a_id
  from public.clients
  where tenant_id = tenant_a_id
    and email = 'xlab-bridge-recheck@example.test';
  select id into client_b_id
  from public.clients
  where tenant_id = tenant_b_id
    and email = 'xlab-bridge-recheck@example.test';

  insert into public.client_quote_requests (tenant_id, client_id, client_email, client_name, project_name, details, source_app, status)
  values
    (tenant_a_id, client_a_id, 'xlab-bridge-recheck@example.test', 'X LAB Bridge Client A', 'Tenant A quote', 'A-only request', 'xlab', 'new'),
    (tenant_b_id, client_b_id, 'xlab-bridge-recheck@example.test', 'X LAB Bridge Client B', 'Tenant B quote', 'B-only request', 'xlab', 'new');

  select id into quote_a_id from public.client_quote_requests where tenant_id = tenant_a_id and project_name = 'Tenant A quote';
  select id into quote_b_id from public.client_quote_requests where tenant_id = tenant_b_id and project_name = 'Tenant B quote';

  insert into public.client_messages (tenant_id, client_id, client_email, subject, message, sender_type, is_internal, status, source_app)
  values
    (tenant_a_id, client_a_id, 'xlab-bridge-recheck@example.test', 'Tenant A parent', 'A parent', 'client', false, 'new', 'xlab'),
    (tenant_b_id, client_b_id, 'xlab-bridge-recheck@example.test', 'Tenant B parent', 'B parent', 'client', false, 'new', 'xlab');

  select id into parent_a_id from public.client_messages where tenant_id = tenant_a_id and subject = 'Tenant A parent';
  select id into parent_b_id from public.client_messages where tenant_id = tenant_b_id and subject = 'Tenant B parent';

  insert into public.client_file_folders (tenant_id, client_id, client_email, name, source_app)
  values (tenant_b_id, client_b_id, 'xlab-bridge-recheck@example.test', 'Tenant B folder', 'xlab');

  insert into public.client_file_links (tenant_id, client_id, client_email, file_url, file_name, source_app)
  values (
    tenant_b_id,
    client_b_id,
    'xlab-bridge-recheck@example.test',
    'private-upload://uploads/' || tenant_b_id::text || '/bridge/b-file.pdf',
    'Tenant B file',
    'xlab'
  )
  returning id into link_b_id;

  perform set_config('request.jwt.claim.sub', tenant_a_user_id::text, true);
  perform set_config('request.jwt.claim.email', 'xlab-bridge-a@example.test', true);

  select count(*) into request_count
  from public.get_internal_client_requests(null, null, null, 'Tenant A quote', 20);
  if request_count <> 1 then
    raise exception 'Tenant A did not see its own X LAB request exactly once.';
  end if;

  select count(*) into request_count
  from public.get_internal_client_requests(null, null, null, 'Tenant B quote', 20);
  if request_count <> 0 then
    raise exception 'Tenant A saw Tenant B X LAB request.';
  end if;

  perform public.update_internal_client_request_status('quote_request', quote_a_id, 'reviewing');
  if (select status from public.client_quote_requests where id = quote_a_id) <> 'reviewing' then
    raise exception 'Tenant A could not update its own X LAB request.';
  end if;

  denied := false;
  begin
    perform public.update_internal_client_request_status('quote_request', quote_b_id, 'reviewing');
  exception when others then
    denied := true;
  end;
  if denied is distinct from true then
    raise exception 'Tenant A updated Tenant B X LAB request.';
  end if;

  perform public.add_internal_client_message_reply(
    'xlab-bridge-recheck@example.test',
    'Re: Tenant A parent',
    'Tenant A reply',
    parent_a_id
  );
  if (select status from public.client_messages where id = parent_a_id) <> 'actioned' then
    raise exception 'Tenant A reply did not action its own parent message.';
  end if;

  perform public.add_internal_client_message_reply(
    'xlab-bridge-recheck@example.test',
    'Re: Tenant B parent spoof',
    'Tenant A reply must not action Tenant B',
    parent_b_id
  );
  if (select status from public.client_messages where id = parent_b_id) <> 'new' then
    raise exception 'Tenant A reply actioned Tenant B parent message.';
  end if;

  folder_a := public.upsert_internal_client_file_folder(
    'xlab-bridge-recheck@example.test',
    'Tenant A folder',
    null,
    'proof',
    null
  );
  if folder_a.tenant_id <> tenant_a_id then
    raise exception 'Tenant A folder was not stamped with Tenant A id.';
  end if;

  denied := false;
  begin
    perform public.upsert_internal_client_file_folder(
      'xlab-bridge-recheck@example.test',
      'Spoof Tenant B folder',
      (select id from public.client_file_folders where tenant_id = tenant_b_id and name = 'Tenant B folder'),
      'proof',
      null
    );
  exception when others then
    denied := true;
  end;
  if denied is distinct from true then
    raise exception 'Tenant A updated Tenant B file folder.';
  end if;

  denied := false;
  begin
    perform public.upsert_internal_client_file_link(
      'xlab-bridge-recheck@example.test',
      'private-upload://uploads/' || tenant_b_id::text || '/bridge/spoof.pdf',
      'Spoof B file',
      'application/pdf',
      10,
      folder_a.id,
      null,
      null,
      null,
      null
    );
  exception when others then
    denied := true;
  end;
  if denied is distinct from true then
    raise exception 'Tenant A stored a Tenant B private upload ref.';
  end if;

  denied := false;
  begin
    perform public.upsert_internal_client_file_link(
      'xlab-bridge-recheck@example.test',
      'https://project.supabase.co/storage/v1/object/sign/uploads/' || tenant_a_id::text || '/bridge/a-file.pdf?token=short',
      'Signed URL should not persist',
      'application/pdf',
      10,
      folder_a.id,
      null,
      null,
      null,
      null
    );
  exception when others then
    denied := true;
  end;
  if denied is distinct from true then
    raise exception 'X LAB bridge persisted a short-lived signed URL.';
  end if;

  link_a := public.upsert_internal_client_file_link(
    'xlab-bridge-recheck@example.test',
    'private-upload://uploads/' || tenant_a_id::text || '/bridge/a-file.pdf',
    'Tenant A file',
    'application/pdf',
    10,
    folder_a.id,
    null,
    null,
    null,
    null
  );
  if link_a.tenant_id <> tenant_a_id then
    raise exception 'Tenant A file link was not stamped with Tenant A id.';
  end if;

  denied := false;
  begin
    perform public.copy_internal_client_file_link(link_b_id, folder_a.id);
  exception when others then
    denied := true;
  end;
  if denied is distinct from true then
    raise exception 'Tenant A copied Tenant B file link.';
  end if;

  if public.delete_internal_client_file_link(link_b_id) is distinct from false then
    raise exception 'Tenant A deleted Tenant B file link.';
  end if;

  library := public.get_internal_client_file_library('xlab-bridge-recheck@example.test', 20);
  if jsonb_array_length(coalesce(library->'files', '[]'::jsonb)) <> 1
    or (library->'files'->0->>'tenant_id')::uuid <> tenant_a_id
    or library::text like '%' || tenant_b_id::text || '%'
  then
    raise exception 'Tenant A file library exposed Tenant B file metadata.';
  end if;

  perform set_config('request.jwt.claim.sub', tenant_b_user_id::text, true);
  perform set_config('request.jwt.claim.email', 'xlab-bridge-b@example.test', true);

  select count(*) into request_count
  from public.get_internal_client_requests(null, null, null, 'Tenant B quote', 20);
  if request_count <> 1 then
    raise exception 'Tenant B did not see its own X LAB request exactly once.';
  end if;

  select count(*) into request_count
  from public.get_internal_client_requests(null, null, null, 'Tenant A quote', 20);
  if request_count <> 0 then
    raise exception 'Tenant B saw Tenant A X LAB request.';
  end if;

  if public.xlab_bridge_file_ref_matches_tenant(
    'private-upload://uploads/' || tenant_a_id::text || '/bridge/a-file.pdf',
    tenant_b_id
  ) is distinct from false then
    raise exception 'Bridge private-file validator accepted another tenant path.';
  end if;

  if has_function_privilege('authenticated', 'public.get_internal_client_requests_unscoped(text,text,text,text,int)', 'execute') then
    raise exception 'Authenticated role can execute unscoped internal request list RPC.';
  end if;

  if has_function_privilege('authenticated', 'public.update_internal_client_request_status_unscoped(text,uuid,text)', 'execute') then
    raise exception 'Authenticated role can execute unscoped internal request status RPC.';
  end if;

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.email', '', true);

  delete from public.client_file_links
  where client_email = 'xlab-bridge-recheck@example.test';
  delete from public.client_file_folders
  where client_email = 'xlab-bridge-recheck@example.test';
  delete from public.client_messages
  where client_email = 'xlab-bridge-recheck@example.test';
  delete from public.client_quote_requests
  where client_email = 'xlab-bridge-recheck@example.test';
  delete from public.orders
  where order_number in ('XLAB-BRIDGE-A', 'XLAB-BRIDGE-B');
  delete from public.projects
  where project_code in ('XLAB-BRIDGE-A', 'XLAB-BRIDGE-B');
  delete from public.clients
  where email = 'xlab-bridge-recheck@example.test';
  delete from public.users
  where auth_user_id in (tenant_a_user_id, tenant_b_user_id)
     or user_email in ('xlab-bridge-a@example.test', 'xlab-bridge-b@example.test');
  delete from public.tenants
  where slug in ('xlab-bridge-a', 'xlab-bridge-b');
  delete from auth.users
  where id in (tenant_a_user_id, tenant_b_user_id);
end;
$$;
