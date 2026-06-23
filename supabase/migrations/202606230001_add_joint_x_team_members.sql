-- Give the specified internal team accounts access to the existing Joint X workspace.
-- This grants data access only; it does not create tenants or administrator privileges.
insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role, status)
select
  tenant.id,
  auth_user.id,
  'member',
  'active'
from public.tenants tenant
join auth.users auth_user
  on lower(auth_user.email) in (
    'manqubekosithole@gmail.com',
    'nkosithandilesithole@gmail.com'
  )
where tenant.slug = 'joint-x'
on conflict (tenant_id, auth_user_id) do update
set
  tenant_role = 'member',
  status = 'active',
  updated_at = now();