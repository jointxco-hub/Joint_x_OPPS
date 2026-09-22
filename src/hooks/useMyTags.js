import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { resolveMyTagRoleKeys, shouldQueryOrderTags } from '@/lib/employeeIdentity';

// Phase 2C: order_tags is role_key-based, not person-based - confirmed
// against live production data: 0 of 282 rows have user_email populated.
// The previous version of this hook filtered `.eq('user_email',
// userEmail)`, which could never match anything; "Needs Your Attention"
// has been effectively dead/always-empty for every user. Fixed to filter
// by the caller's own operational role_keys (from user_roles, resolved
// via useMyRole + deriveMyRoleSummary) instead of an identity column
// order_tags never actually carries.
//
// Tenant scoping (added in this correction): order_tags.tenant_id exists
// live (confirmed against staging - not present in this repo's tracked
// migration history, same as tenant_access_roles/has_tenant_permission,
// so it must have been added directly against the database). Its RLS is
// `can_access_tenant(tenant_id) AND is_opps_staff()` (one permissive +
// one restrictive policy - see the Phase 2C review notes for the full
// audit of whether that pairing needs its own migration). Regardless of
// what that RLS ultimately allows, this hook must not rely on RLS alone
// to keep My Hub's own query scoped to one tenant - a role_key match
// with no tenant filter could, in principle, surface another tenant's
// same-named role_key's tags. Disabled until tenantId is known, same
// reasoning as roleKeys.
export function useMyTags(roleKeys, tenantId) {
  const myRoleKeys = resolveMyTagRoleKeys(roleKeys);

  return useQuery({
    queryKey: ['my-tags', myRoleKeys, tenantId],
    enabled: shouldQueryOrderTags({ roleKeys: myRoleKeys, tenantId }) && !!supabase,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_tags')
        .select('*, orders(id, order_number, client_name, pipeline_stage, status, priority, source, due_date)')
        .eq('tenant_id', tenantId)
        .in('role_key', myRoleKeys)
        .is('resolved_at', null)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}
