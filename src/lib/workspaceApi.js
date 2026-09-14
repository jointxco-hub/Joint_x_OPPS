import { supabase } from '@/lib/supabaseClient';

function ensureClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

function unwrap(data) {
  return Array.isArray(data) ? data : [];
}

export async function listMyOppsWorkspaces() {
  const client = ensureClient();

  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError) throw authError;

  const user = authData?.user;
  if (!user) return [];

  const { data: memberships, error: membershipError } = await client
    .from('tenant_memberships')
    .select('id, tenant_id, tenant_role, status')
    .eq('auth_user_id', user.id)
    .eq('status', 'active');

  if (membershipError) throw membershipError;

  const tenantIds = [...new Set(
    unwrap(memberships)
      .map((row) => row.tenant_id)
      .filter(Boolean)
  )];

  if (!tenantIds.length) return [];

  const [
    tenantsResult,
    capabilitiesResult,
    rolesResult,
    permissionsResult,
  ] = await Promise.all([
    client
      .from('tenants')
      .select('id, slug, name, status, settings')
      .in('id', tenantIds)
      .eq('status', 'active'),

    client
      .from('tenant_capabilities')
      .select('tenant_id, capability_key, enabled, config')
      .in('tenant_id', tenantIds)
      .eq('capability_key', 'opps_workspace')
      .eq('enabled', true),

    client
      .from('tenant_access_roles')
      .select('tenant_id, role_key, name, rank, is_active')
      .in('tenant_id', tenantIds)
      .eq('is_active', true),

    client
      .from('tenant_access_role_permissions')
      .select('tenant_id, role_key, permission_key, allowed')
      .in('tenant_id', tenantIds)
      .eq('allowed', true),
  ]);

  if (tenantsResult.error) throw tenantsResult.error;
  if (capabilitiesResult.error) throw capabilitiesResult.error;
  if (rolesResult.error) throw rolesResult.error;
  if (permissionsResult.error) throw permissionsResult.error;

  const tenants = unwrap(tenantsResult.data);
  const capabilities = unwrap(capabilitiesResult.data);
  const roles = unwrap(rolesResult.data);
  const permissions = unwrap(permissionsResult.data);

  const capabilityByTenant = new Map(
    capabilities.map((row) => [row.tenant_id, row])
  );

  const tenantById = new Map(
    tenants.map((row) => [row.id, row])
  );

  return unwrap(memberships)
    .map((membership) => {
      const tenant = tenantById.get(membership.tenant_id);
      const capability = capabilityByTenant.get(membership.tenant_id);

      if (!tenant || !capability) return null;

      const role = roles.find(
        (row) =>
          row.tenant_id === membership.tenant_id &&
          row.role_key === membership.tenant_role
      );

      const rolePermissions = permissions
        .filter(
          (row) =>
            row.tenant_id === membership.tenant_id &&
            row.role_key === membership.tenant_role
        )
        .map((row) => row.permission_key);

      return {
        tenantId: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        roleKey: membership.tenant_role,
        roleName:
          role?.name ||
          membership.tenant_role
            .replaceAll('_', ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase()),
        settings: tenant.settings || {},
        workspaceConfig: capability.config || {},
        permissions: rolePermissions,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const priority = (slug) =>
        slug === 'joint-x' ? 0 :
        slug === 'quick-solution' ? 1 :
        10;

      return priority(a.slug) - priority(b.slug) ||
        a.name.localeCompare(b.name);
    });
}

export async function listWorkspaceRoles(tenantId) {
  const client = ensureClient();
  const { data, error } = await client.rpc('admin_list_workspace_roles', {
    p_tenant_id: tenantId,
  });
  if (error) throw error;
  return unwrap(data);
}

export async function listWorkspaceMembers(tenantId) {
  const client = ensureClient();
  const { data, error } = await client.rpc('admin_list_workspace_members', {
    p_tenant_id: tenantId,
  });
  if (error) throw error;
  return unwrap(data);
}

export async function setWorkspaceMemberRole(membershipId, roleKey) {
  const client = ensureClient();
  const { data, error } = await client.rpc('admin_set_workspace_member_role', {
    p_membership_id: membershipId,
    p_role_key: roleKey,
  });
  if (error) throw error;
  return data;
}
