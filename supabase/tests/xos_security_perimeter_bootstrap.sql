\set ON_ERROR_STOP on

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant anon, authenticated, service_role to postgres;

create schema auth;
create schema storage;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create table public.tenants (
  id uuid primary key, slug text unique not null, name text not null,
  status text not null default 'active', settings jsonb not null default '{}'
);
create table public.tenant_memberships (
  id uuid primary key, tenant_id uuid not null references public.tenants,
  auth_user_id uuid not null, tenant_role text not null,
  status text not null default 'active'
);
create table public.users (
  id uuid primary key, auth_user_id uuid, user_email text not null,
  full_name text not null, role text, is_active boolean default true
);

create function public.current_user_tenant_ids() returns setof uuid
language sql stable security definer set search_path=pg_catalog,public as $$
  select tenant_id from public.tenant_memberships
  where auth_user_id=auth.uid() and status='active'
$$;
create function public.can_access_tenant(p_tenant_id uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
  select exists(select 1 from public.current_user_tenant_ids() x where x=p_tenant_id)
$$;
create function public.current_user_app_role() returns text
language sql stable security definer set search_path=pg_catalog,public as $$
  select role from public.users where auth_user_id=auth.uid() limit 1
$$;
create function public.is_app_admin() returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
  select coalesce(public.current_user_app_role()='admin',false)
$$;

create table public.clients(id uuid primary key, tenant_id uuid not null references public.tenants, name text);
create table public.products(id uuid primary key, tenant_id uuid not null references public.tenants, name text);
create table public.orders(id uuid primary key, tenant_id uuid not null references public.tenants, order_number text, status text);
create table public.client_assets(id uuid primary key, tenant_id uuid not null references public.tenants);
create table public.tasks(id uuid primary key, tenant_id uuid not null references public.tenants, title text);
create table public.projects(id uuid primary key, tenant_id uuid not null references public.tenants, name text);
create table public.folders(id uuid primary key, tenant_id uuid not null references public.tenants, name text);

do $$ declare t text; begin
  foreach t in array array['clients','products','orders','client_assets','tasks','projects','folders'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy tenant_manage on public.%I for all to authenticated using (public.can_access_tenant(tenant_id)) with check (public.can_access_tenant(tenant_id))',t);
    execute format('grant select,insert,update,delete,truncate,references,trigger on public.%I to anon,authenticated',t);
  end loop;
end $$;

create table public.client_products(id uuid primary key, tenant_id uuid not null, client_id uuid, visible_in_account boolean, status text);
create table public.client_product_artwork(id uuid primary key, client_product_id uuid not null);
create table public.client_product_order_links(id uuid primary key, client_product_id uuid not null);
alter table public.client_products enable row level security;
alter table public.client_product_artwork enable row level security;
alter table public.client_product_order_links enable row level security;
create policy "Staff manage client products" on public.client_products for all to authenticated using (public.can_access_tenant(tenant_id)) with check(public.can_access_tenant(tenant_id));
create policy "Staff manage client product artwork" on public.client_product_artwork for all to authenticated using (true) with check(true);
create policy "Staff manage client product order links" on public.client_product_order_links for all to authenticated using (true) with check(true);
grant all on public.client_products,public.client_product_artwork,public.client_product_order_links to anon,authenticated;

create table public.client_quote_requests(id uuid primary key,tenant_id uuid,title text);
create table public.client_messages(id uuid primary key);
create table public.client_profile_requests(id uuid primary key);
create table public.client_file_folders(id uuid primary key);
create table public.client_file_links(id uuid primary key,tenant_id uuid,file_url text not null);
do $$ declare t text; begin
  foreach t in array array['client_quote_requests','client_messages','client_profile_requests','client_file_folders','client_file_links'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('grant all on public.%I to anon,authenticated',t);
  end loop;
end $$;

-- Representative Advisor tables; absent names are intentionally skipped by migration.
create table public.bug_reports(id uuid primary key,body text);
create table public.goals(id uuid primary key,title text);
grant all on public.bug_reports,public.goals to anon,authenticated;

create table storage.objects(id uuid primary key,bucket_id text not null,name text not null);
alter table storage.objects enable row level security;
grant all on storage.objects to anon,authenticated;
create function public.private_upload_path_tenant_id(p_path text) returns uuid
language plpgsql immutable as $$ begin return split_part(p_path,'/',1)::uuid; exception when others then return null; end $$;
create function public.client_artwork_path_owner(p_path text) returns uuid
language plpgsql immutable as $$ begin return split_part(p_path,'/',1)::uuid; exception when others then return null; end $$;
create function public.is_private_upload_path_accessible(p_path text) returns boolean language sql stable as $$select true$$;
create policy "Allow authenticated uploads 1va6avm_0" on storage.objects for insert to authenticated with check(bucket_id='uploads');
create policy private_uploads_insert_by_tenant on storage.objects for insert to authenticated with check(bucket_id='uploads' and public.can_access_tenant(public.private_upload_path_tenant_id(name)));
create policy private_uploads_update_by_tenant on storage.objects for update to authenticated using(bucket_id='uploads') with check(bucket_id='uploads');
create policy private_uploads_delete_by_tenant on storage.objects for delete to authenticated using(bucket_id='uploads');
create policy private_uploads_read_by_tenant on storage.objects for select to authenticated using(bucket_id='uploads' and public.is_private_upload_path_accessible(name));
create policy public_assets_read on storage.objects for select to anon,authenticated using(bucket_id='public-assets');
create policy public_assets_insert_authenticated on storage.objects for insert to authenticated with check(bucket_id='public-assets');
create policy public_assets_update_authenticated on storage.objects for update to authenticated using(bucket_id='public-assets') with check(bucket_id='public-assets');
create policy public_assets_delete_authenticated on storage.objects for delete to authenticated using(bucket_id='public-assets');
create policy "Staff manage client artwork files" on storage.objects for all to authenticated using(bucket_id='client-artwork') with check(bucket_id='client-artwork');
create policy "Staff manage client mockup files" on storage.objects for all to authenticated using(bucket_id='client-mockups') with check(bucket_id='client-mockups');

create view public.active_tasks as select * from public.tasks;
create view public.v_company_north_star as select * from public.goals;
create view public.v_projects as select * from public.projects;
create view public.active_orders as select * from public.orders;
create view public.v_orders as select * from public.orders;
grant all on public.active_tasks,public.v_company_north_star,public.v_projects,public.active_orders,public.v_orders to anon,authenticated;

create function public.upsert_opps_conversation(uuid,text,text,text,text) returns jsonb language sql security definer as $$select '{}'::jsonb$$;
create function public.xlab_bridge_file_ref_matches_tenant(text,uuid) returns boolean language sql security definer as $$select true$$;
create function public.can_manage_order_production_readiness() returns boolean language sql security definer as $$select true$$;
create function public.get_or_create_clients_root(uuid) returns uuid language sql security definer as $$select $1$$;
create function public.get_or_create_client_asset_folder(uuid,text,text) returns uuid language sql security definer as $$select $1$$;
create function public.get_or_create_order_asset_folder(uuid,text) returns uuid language sql security definer as $$select $1$$;
create function public.provision_order_asset_folders(uuid) returns uuid language sql security definer as $$select $1$$;
grant execute on function public.upsert_opps_conversation(uuid,text,text,text,text) to anon,authenticated,service_role;
grant execute on function public.xlab_bridge_file_ref_matches_tenant(text,uuid) to anon,authenticated,service_role;
grant execute on function public.get_or_create_order_asset_folder(uuid,text) to authenticated;
grant execute on function public.provision_order_asset_folders(uuid) to authenticated;

-- Simplified copies of the existing bounded XOS contracts for perimeter tests.
create table public.tenant_domains(id uuid primary key,tenant_id uuid references public.tenants,hostname text,surface text,status text);
create function public.resolve_xos_admin_gate(p_hostname text)
returns table(allowed boolean,reason text,tenant_id uuid) language sql stable security definer as $$
  select coalesce(t.status='active' and d.status='active' and m.status='active',false),
         case when d.id is null then 'unknown_host' when t.status<>'active' or d.status<>'active' then 'inactive' when m.id is null then 'not_member' else 'allowed' end,
         t.id
  from (select 1) seed
  left join public.tenant_domains d on lower(d.hostname)=lower(p_hostname) and d.surface='xos_admin'
  left join public.tenants t on t.id=d.tenant_id
  left join public.tenant_memberships m on m.tenant_id=t.id and m.auth_user_id=auth.uid();
$$;
create function public.get_xos_orders_for_host(p_hostname text) returns setof public.orders
language sql stable security definer as $$
  select o.* from public.orders o join public.resolve_xos_admin_gate(p_hostname) g on g.allowed and g.tenant_id=o.tenant_id
$$;
create function public.create_xos_request_for_host(p_hostname text,p_title text) returns uuid
language plpgsql security definer as $$ declare v_tenant uuid;v_id uuid:=gen_random_uuid();begin
  select tenant_id into v_tenant from public.resolve_xos_admin_gate(p_hostname) where allowed;
  if v_tenant is null then raise exception 'XOS_GATE_DENIED' using errcode='42501'; end if;
  insert into public.client_quote_requests values(v_id,v_tenant,p_title); return v_id;
end$$;
grant execute on function public.resolve_xos_admin_gate(text),public.get_xos_orders_for_host(text),public.create_xos_request_for_host(text,text) to authenticated;

insert into public.tenants values
('10000000-0000-0000-0000-000000000001','joint-x','Joint X','active','{}'),
('20000000-0000-0000-0000-000000000002','client-a','Client A','active','{}'),
('30000000-0000-0000-0000-000000000003','client-b','Client B','active','{}'),
('40000000-0000-0000-0000-000000000004','inactive','Inactive','inactive','{}');
insert into public.users values('50000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','staff@example.test','Staff','admin',true);
insert into public.tenant_memberships values
('70000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','admin','active'),
('70000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','60000000-0000-0000-0000-000000000001','admin','active'),
('70000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000002','60000000-0000-0000-0000-000000000002','member','active'),
('70000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000002','60000000-0000-0000-0000-000000000003','owner','active'),
('70000000-0000-0000-0000-000000000005','30000000-0000-0000-0000-000000000003','60000000-0000-0000-0000-000000000004','member','active'),
('70000000-0000-0000-0000-000000000006','40000000-0000-0000-0000-000000000004','60000000-0000-0000-0000-000000000002','member','active');
insert into public.tenant_domains values
('80000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','a.xos.test','xos_admin','active'),
('80000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000004','inactive.xos.test','xos_admin','active');
insert into public.clients values('90000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','A Client');
insert into public.products values('91000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','A Product');
insert into public.orders values
('92000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','A-001','production'),
('92000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000003','B-001','new');
insert into public.client_file_links values
('93000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','private-upload://uploads/20000000-0000-0000-0000-000000000002/orders/a.pdf');
