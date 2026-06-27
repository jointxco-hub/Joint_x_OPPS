-- Phase 2C.1: private uploads and tenant-aware signed URL foundation.
-- New sensitive uploads use tenant-prefixed paths in the private `uploads` bucket.
-- Explicitly public product/profile assets use `public-assets` and remain public.

insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', false)
on conflict (id) do update set public = false;

insert into storage.buckets (id, name, public)
values ('public-assets', 'public-assets', true)
on conflict (id) do update set public = true;

create or replace function public.private_upload_path_tenant_id(p_path text)
returns uuid
language plpgsql
stable
set search_path = public
as $$
declare
  clean_path text;
  first_segment text;
begin
  clean_path := btrim(coalesce(p_path, ''));

  if clean_path = ''
    or clean_path like '/%'
    or clean_path ~ '\\'
    or clean_path !~ '^[^/]+/.+'
    or clean_path ~ '(^|/)\.\.?(/|$)'
  then
    return null;
  end if;

  first_segment := split_part(clean_path, '/', 1);

  if first_segment ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return first_segment::uuid;
  end if;

  return null;
end;
$$;
create or replace function public.is_private_upload_path_accessible(p_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.private_upload_path_tenant_id(p_path) is null then public.is_app_admin()
    else public.can_access_tenant(public.private_upload_path_tenant_id(p_path))
  end;
$$;

revoke execute on function public.private_upload_path_tenant_id(text) from public, anon;
revoke execute on function public.is_private_upload_path_accessible(text) from public, anon;
grant execute on function public.private_upload_path_tenant_id(text) to authenticated;
grant execute on function public.is_private_upload_path_accessible(text) to authenticated;

drop policy if exists private_uploads_read_by_tenant on storage.objects;
drop policy if exists private_uploads_insert_by_tenant on storage.objects;
drop policy if exists private_uploads_update_by_tenant on storage.objects;
drop policy if exists private_uploads_delete_by_tenant on storage.objects;
drop policy if exists public_assets_read on storage.objects;
drop policy if exists public_assets_insert_authenticated on storage.objects;
drop policy if exists public_assets_update_authenticated on storage.objects;
drop policy if exists public_assets_delete_authenticated on storage.objects;

create policy private_uploads_read_by_tenant
  on storage.objects for select to authenticated
  using (
    bucket_id = 'uploads'
    and public.is_private_upload_path_accessible(name)
  );

create policy private_uploads_insert_by_tenant
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'uploads'
    and public.private_upload_path_tenant_id(name) is not null
    and public.can_access_tenant(public.private_upload_path_tenant_id(name))
  );

create policy private_uploads_update_by_tenant
  on storage.objects for update to authenticated
  using (
    bucket_id = 'uploads'
    and public.private_upload_path_tenant_id(name) is not null
    and public.can_access_tenant(public.private_upload_path_tenant_id(name))
  )
  with check (
    bucket_id = 'uploads'
    and public.private_upload_path_tenant_id(name) is not null
    and public.can_access_tenant(public.private_upload_path_tenant_id(name))
  );

create policy private_uploads_delete_by_tenant
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'uploads'
    and public.private_upload_path_tenant_id(name) is not null
    and public.can_access_tenant(public.private_upload_path_tenant_id(name))
  );

create policy public_assets_read
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'public-assets');

create policy public_assets_insert_authenticated
  on storage.objects for insert to authenticated
  with check (bucket_id = 'public-assets');

create policy public_assets_update_authenticated
  on storage.objects for update to authenticated
  using (bucket_id = 'public-assets')
  with check (bucket_id = 'public-assets');

create policy public_assets_delete_authenticated
  on storage.objects for delete to authenticated
  using (bucket_id = 'public-assets');

create or replace function public.get_public_order_tracking_for_host(
  p_lookup text,
  p_hostname text
)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  with input as (
    select upper(trim(coalesce(p_lookup, ''))) as raw_lookup
  ),
  resolved_tenant as (
    select domain_row.tenant_id
    from public.tenant_domains domain_row
    join public.tenants tenant on tenant.id = domain_row.tenant_id
    where domain_row.hostname = public.normalize_tenant_hostname(p_hostname)
      and domain_row.surface = 'public_tracking'
      and domain_row.status = 'active'
      and tenant.status = 'active'
    limit 1
  )
  select jsonb_build_object(
    'id', o.id,
    'client_name', o.client_name,
    'order_number', o.order_number,
    'status', o.status,
    'pipeline_stage', o.pipeline_stage,
    'production_method', o.production_method,
    'production_detail_stage', o.production_detail_stage,
    'production_client_update', o.production_client_update,
    'due_date', o.due_date,
    'courier', o.courier,
    'tracking_number', o.tracking_number,
    'pep_code', o.pep_code,
    'portal_message', o.portal_message,
    'portal_attention_items', o.portal_attention_items,
    'portal_show_files', false,
    'portal_show_balance', o.portal_show_balance,
    'portal_visible_file_urls', jsonb_build_array(),
    'invoice_files', jsonb_build_array(),
    'total_amount', o.total_amount,
    'deposit_paid', o.deposit_paid
  )
  from resolved_tenant
  join public.orders o on o.tenant_id = resolved_tenant.tenant_id
  cross join input
  where input.raw_lookup <> ''
    and (
      upper(coalesce(o.order_number, '')) = input.raw_lookup
      or upper(coalesce(o.tracking_number, '')) = input.raw_lookup
      or upper(o.id::text) = input.raw_lookup
      or exists (
        select 1
        from jsonb_array_elements_text(coalesce(o.invoice_numbers, '[]'::jsonb)) number
        where upper(number) = input.raw_lookup
      )
    )
  order by o.updated_at desc
  limit 1;
$$;

grant execute on function public.get_public_order_tracking_for_host(text, text) to anon, authenticated;

create or replace function public.get_public_order_tracking(
  p_lookup text,
  p_tenant_slug text default 'joint-x'
)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select public.get_public_order_tracking_for_host(p_lookup, 'ops.jointx.co.za');
$$;

grant execute on function public.get_public_order_tracking(text, text) to anon, authenticated;
