-- XOS 1: remove OR-bypass upload policies and separate staff writes from
-- explicitly linked external-client reads.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create or replace function public.is_private_upload_path_accessible(p_path text)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  clean_path text := btrim(coalesce(p_path, ''));
  first_segment text;
  path_tenant_id uuid;
begin
  if clean_path = '' or clean_path like '/%'
     or position(chr(92) in clean_path) > 0
     or clean_path like '%..%' or clean_path like '%//%'
     or clean_path like '%/./%' or clean_path in ('.', '..') then
    return false;
  end if;

  if position('/' in clean_path) > 0 then
    first_segment := split_part(clean_path, '/', 1);
    if first_segment !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return false;
    end if;
    path_tenant_id := first_segment::uuid;

    if public.is_opps_staff() then
      return public.can_access_tenant(path_tenant_id);
    end if;

    return exists (
      select 1
      from public.tenant_memberships membership
      join public.tenants tenant on tenant.id = membership.tenant_id
      join public.client_file_links file_link on file_link.tenant_id = membership.tenant_id
      where membership.auth_user_id = auth.uid()
        and membership.status = 'active'
        and tenant.status = 'active'
        and membership.tenant_id = path_tenant_id
        and file_link.file_url = 'private-upload://uploads/' || clean_path
    );
  end if;

  -- Legacy unprefixed files are never exposed to external tenant identities.
  if clean_path !~ '^[A-Za-z0-9][A-Za-z0-9._ -]{0,255}$' then
    return false;
  end if;
  return public.is_opps_staff();
end;
$$;

revoke all on function public.is_private_upload_path_accessible(text) from public, anon, authenticated, service_role;
grant execute on function public.is_private_upload_path_accessible(text) to authenticated, service_role;

-- This broad INSERT policy OR-bypassed every later tenant-path restriction.
drop policy if exists "Allow authenticated uploads 1va6avm_0" on storage.objects;

drop policy if exists private_uploads_insert_by_tenant on storage.objects;
create policy private_uploads_insert_by_tenant on storage.objects
for insert to authenticated
with check (
  bucket_id = 'uploads' and public.is_opps_staff()
  and public.private_upload_path_tenant_id(name) is not null
  and public.can_access_tenant(public.private_upload_path_tenant_id(name))
);

drop policy if exists private_uploads_update_by_tenant on storage.objects;
create policy private_uploads_update_by_tenant on storage.objects
for update to authenticated
using (
  bucket_id = 'uploads' and public.is_opps_staff()
  and public.private_upload_path_tenant_id(name) is not null
  and public.can_access_tenant(public.private_upload_path_tenant_id(name))
)
with check (
  bucket_id = 'uploads' and public.is_opps_staff()
  and public.private_upload_path_tenant_id(name) is not null
  and public.can_access_tenant(public.private_upload_path_tenant_id(name))
);

drop policy if exists private_uploads_delete_by_tenant on storage.objects;
create policy private_uploads_delete_by_tenant on storage.objects
for delete to authenticated
using (
  bucket_id = 'uploads' and public.is_opps_staff()
  and public.private_upload_path_tenant_id(name) is not null
  and public.can_access_tenant(public.private_upload_path_tenant_id(name))
);

drop policy if exists public_assets_insert_authenticated on storage.objects;
create policy public_assets_insert_authenticated on storage.objects
for insert to authenticated with check (bucket_id = 'public-assets' and public.is_opps_staff());
drop policy if exists public_assets_update_authenticated on storage.objects;
create policy public_assets_update_authenticated on storage.objects
for update to authenticated
using (bucket_id = 'public-assets' and public.is_opps_staff())
with check (bucket_id = 'public-assets' and public.is_opps_staff());
drop policy if exists public_assets_delete_authenticated on storage.objects;
create policy public_assets_delete_authenticated on storage.objects
for delete to authenticated using (bucket_id = 'public-assets' and public.is_opps_staff());

-- Keep customer-own artwork/mockup access; correct only the staff arm.
drop policy if exists "Staff manage client artwork files" on storage.objects;
create policy "Staff manage client artwork files" on storage.objects
for all to authenticated
using (
  bucket_id = 'client-artwork' and public.is_opps_staff() and exists (
    select 1 from public.clients c
    where c.id = public.client_artwork_path_owner(storage.objects.name)
      and c.tenant_id is not null and public.can_access_tenant(c.tenant_id)
  )
)
with check (
  bucket_id = 'client-artwork' and public.is_opps_staff() and exists (
    select 1 from public.clients c
    where c.id = public.client_artwork_path_owner(storage.objects.name)
      and c.tenant_id is not null and public.can_access_tenant(c.tenant_id)
  )
);

drop policy if exists "Staff manage client mockup files" on storage.objects;
create policy "Staff manage client mockup files" on storage.objects
for all to authenticated
using (
  bucket_id = 'client-mockups' and public.is_opps_staff() and exists (
    select 1 from public.clients c
    where c.id = public.client_artwork_path_owner(storage.objects.name)
      and c.tenant_id is not null and public.can_access_tenant(c.tenant_id)
  )
)
with check (
  bucket_id = 'client-mockups' and public.is_opps_staff() and exists (
    select 1 from public.clients c
    where c.id = public.client_artwork_path_owner(storage.objects.name)
      and c.tenant_id is not null and public.can_access_tenant(c.tenant_id)
  )
);

-- Intentional compatibility exception: xlab-assets public storefront/customer
-- policies are unchanged in XOS 1 and are recorded as deferred in the report.

commit;
