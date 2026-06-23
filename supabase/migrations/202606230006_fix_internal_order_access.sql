-- Internal team access is separate from tenants/customers.
create or replace function public.is_app_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select public.current_user_app_role() = 'admin'
    or lower(coalesce(auth.jwt() ->> 'email', '')) in (
      'jointx.co@gmail.com', 'jointsexclusive@gmail.com',
      'jasperjaimataruse@gmail.com', 'jaicreativerealm@gmail.com'
    );
$$;

drop policy if exists tenant_manage_orders on public.orders;
create policy tenant_manage_orders on public.orders
  for all to authenticated
  using (public.is_app_admin() or public.can_access_tenant(tenant_id))
  with check (public.is_app_admin() or public.can_access_tenant(tenant_id));

drop policy if exists tenant_manage_clients on public.clients;
create policy tenant_manage_clients on public.clients
  for all to authenticated
  using (public.is_app_admin() or public.can_access_tenant(tenant_id))
  with check (public.is_app_admin() or public.can_access_tenant(tenant_id));

create or replace function public.add_internal_user_to_joint_x_team()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.auth_user_id is not null and coalesce(new.is_active, true) then
    insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role, status)
    select id, new.auth_user_id, case when new.role = 'admin' then 'admin' else 'member' end, 'active'
    from public.tenants where slug = 'joint-x'
    on conflict (tenant_id, auth_user_id) do update set status = 'active';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_internal_user_joint_x_membership on public.users;
create trigger trg_internal_user_joint_x_membership
  after insert or update of auth_user_id, is_active, role on public.users
  for each row execute function public.add_internal_user_to_joint_x_team();

insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role, status)
select tenant.id, internal_user.auth_user_id,
  case when internal_user.role = 'admin' then 'admin' else 'member' end, 'active'
from public.tenants tenant
join public.users internal_user on internal_user.auth_user_id is not null and coalesce(internal_user.is_active, true)
where tenant.slug = 'joint-x'
on conflict (tenant_id, auth_user_id) do update set status = 'active';