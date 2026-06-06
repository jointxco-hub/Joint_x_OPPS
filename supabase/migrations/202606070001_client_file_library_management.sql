-- Internal management RPCs for the client file library.
-- Files remain a single source URL; folders and copies are logical links only.

create or replace function public.upsert_internal_client_file_folder(
  p_client_email text,
  p_name text,
  p_folder_id uuid default null,
  p_folder_type text default null,
  p_parent_folder_id uuid default null
)
returns public.client_file_folders
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_email text := lower(trim(coalesce(p_client_email, '')));
  clean_name text := trim(coalesce(p_name, ''));
  result public.client_file_folders;
  client_row public.clients;
begin
  if not public.can_manage_internal_client_requests() then
    raise exception 'Not authorised to manage client file folders.';
  end if;

  if clean_email = '' or clean_name = '' then
    raise exception 'Client email and folder name are required.';
  end if;

  select *
  into client_row
  from public.clients c
  where lower(trim(coalesce(c.email, ''))) = clean_email
  order by c.updated_at desc nulls last, c.created_at desc nulls last
  limit 1;

  if p_folder_id is not null then
    update public.client_file_folders
    set
      name = left(clean_name, 180),
      folder_type = nullif(left(trim(coalesce(p_folder_type, '')), 80), ''),
      parent_folder_id = p_parent_folder_id,
      client_id = coalesce(client_file_folders.client_id, client_row.id),
      updated_at = now()
    where id = p_folder_id
      and lower(trim(client_email)) = clean_email
    returning * into result;
  end if;

  if result.id is null then
    insert into public.client_file_folders (
      client_id,
      client_email,
      name,
      folder_type,
      parent_folder_id,
      created_by,
      source_app
    )
    values (
      client_row.id,
      clean_email,
      left(clean_name, 180),
      nullif(left(trim(coalesce(p_folder_type, '')), 80), ''),
      p_parent_folder_id,
      auth.jwt() ->> 'email',
      'opps'
    )
    returning * into result;
  end if;

  return result;
end;
$$;

create or replace function public.upsert_internal_client_file_link(
  p_client_email text,
  p_file_url text,
  p_file_name text default null,
  p_file_type text default null,
  p_file_size bigint default null,
  p_folder_id uuid default null,
  p_linked_order_id uuid default null,
  p_linked_project_id uuid default null,
  p_linked_tech_pack_id uuid default null,
  p_file_link_id uuid default null
)
returns public.client_file_links
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_email text := lower(trim(coalesce(p_client_email, '')));
  clean_url text := trim(coalesce(p_file_url, ''));
  clean_name text := nullif(trim(coalesce(p_file_name, '')), '');
  result public.client_file_links;
  client_row public.clients;
begin
  if not public.can_manage_internal_client_requests() then
    raise exception 'Not authorised to manage client files.';
  end if;

  if clean_email = '' or clean_url = '' then
    raise exception 'Client email and file URL are required.';
  end if;

  select *
  into client_row
  from public.clients c
  where lower(trim(coalesce(c.email, ''))) = clean_email
  order by c.updated_at desc nulls last, c.created_at desc nulls last
  limit 1;

  if p_folder_id is not null and not exists (
    select 1
    from public.client_file_folders f
    where f.id = p_folder_id
      and lower(trim(f.client_email)) = clean_email
  ) then
    raise exception 'Folder does not belong to this client.';
  end if;

  if p_file_link_id is not null then
    update public.client_file_links
    set
      file_url = clean_url,
      file_name = left(coalesce(clean_name, client_file_links.file_name, 'Client file'), 240),
      file_type = nullif(left(trim(coalesce(p_file_type, client_file_links.file_type, '')), 120), ''),
      file_size = coalesce(p_file_size, client_file_links.file_size),
      folder_id = p_folder_id,
      linked_order_id = p_linked_order_id,
      linked_project_id = p_linked_project_id,
      linked_tech_pack_id = p_linked_tech_pack_id,
      client_id = coalesce(client_file_links.client_id, client_row.id),
      updated_at = now()
    where id = p_file_link_id
      and lower(trim(client_email)) = clean_email
    returning * into result;
  end if;

  if result.id is null then
    insert into public.client_file_links (
      client_id,
      client_email,
      file_url,
      file_name,
      file_type,
      file_size,
      folder_id,
      linked_order_id,
      linked_project_id,
      linked_tech_pack_id,
      uploaded_by_type,
      uploaded_by_user_id,
      source_app
    )
    values (
      client_row.id,
      clean_email,
      clean_url,
      left(coalesce(clean_name, 'Client file'), 240),
      nullif(left(trim(coalesce(p_file_type, '')), 120), ''),
      p_file_size,
      p_folder_id,
      p_linked_order_id,
      p_linked_project_id,
      p_linked_tech_pack_id,
      'internal',
      auth.uid(),
      'opps'
    )
    returning * into result;
  end if;

  return result;
end;
$$;

create or replace function public.copy_internal_client_file_link(
  p_file_link_id uuid,
  p_target_folder_id uuid
)
returns public.client_file_links
language plpgsql
security definer
set search_path = public
as $$
declare
  source_link public.client_file_links;
  result public.client_file_links;
begin
  if not public.can_manage_internal_client_requests() then
    raise exception 'Not authorised to copy client files.';
  end if;

  select *
  into source_link
  from public.client_file_links
  where id = p_file_link_id;

  if source_link.id is null then
    raise exception 'Client file link not found.';
  end if;

  if p_target_folder_id is not null and not exists (
    select 1
    from public.client_file_folders f
    where f.id = p_target_folder_id
      and lower(trim(f.client_email)) = lower(trim(source_link.client_email))
  ) then
    raise exception 'Target folder does not belong to this client.';
  end if;

  insert into public.client_file_links (
    client_id,
    client_email,
    file_url,
    file_name,
    file_type,
    file_size,
    folder_id,
    linked_order_id,
    linked_project_id,
    linked_tech_pack_id,
    uploaded_by_type,
    uploaded_by_user_id,
    source_app
  )
  values (
    source_link.client_id,
    source_link.client_email,
    source_link.file_url,
    source_link.file_name,
    source_link.file_type,
    source_link.file_size,
    p_target_folder_id,
    source_link.linked_order_id,
    source_link.linked_project_id,
    source_link.linked_tech_pack_id,
    'internal',
    auth.uid(),
    'opps'
  )
  returning * into result;

  return result;
end;
$$;

create or replace function public.delete_internal_client_file_link(
  p_file_link_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_manage_internal_client_requests() then
    raise exception 'Not authorised to delete client file links.';
  end if;

  delete from public.client_file_links
  where id = p_file_link_id;

  return found;
end;
$$;

grant execute on function public.upsert_internal_client_file_folder(text, text, uuid, text, uuid) to authenticated;
grant execute on function public.upsert_internal_client_file_link(text, text, text, text, bigint, uuid, uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.copy_internal_client_file_link(uuid, uuid) to authenticated;
grant execute on function public.delete_internal_client_file_link(uuid) to authenticated;

revoke execute on function public.upsert_internal_client_file_folder(text, text, uuid, text, uuid) from anon;
revoke execute on function public.upsert_internal_client_file_link(text, text, text, text, bigint, uuid, uuid, uuid, uuid, uuid) from anon;
revoke execute on function public.copy_internal_client_file_link(uuid, uuid) from anon;
revoke execute on function public.delete_internal_client_file_link(uuid) from anon;
