import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { resolveEmployeeIdentityMode } from '@/lib/employeeIdentity';

// Phase 2C: fetches the caller's full set of user_roles assignments
// (joined `roles`), canonical auth_user_id+tenant_id first, falling back
// to the legacy email filter only for identities not yet resolved to a
// tenant (see the Phase 2C identity migration). Returns the raw
// assignment list — callers derive primaryRole/roleKeys/supportsQbr from
// it via deriveMyRoleSummary() (src/lib/employeeIdentity.js), which is
// also where the "which identity to query" decision is pure/testable.
//
// Also fixes a pre-existing, unrelated bug: the previous version of this
// query selected `role_id` and `roles(id, name, color, icon,
// focus_areas)` — none of role_id/icon/focus_areas exist in the live
// schema (user_roles has role_key, not role_id; roles has emoji, not
// icon, and no focus_areas column at all), so this query has likely
// never returned real data. Fixed to select the columns that actually
// exist; MyRoleCard.jsx reads the corrected shape via
// deriveRoleCardView().
export function useMyRole(authUserId, tenantId, userEmailFallback) {
  const identity = resolveEmployeeIdentityMode({ authUserId, tenantId, userEmail: userEmailFallback });

  return useQuery({
    queryKey: ['my-role-assignments', identity],
    enabled: identity.mode !== 'none' && !!supabase,
    queryFn: async () => {
      let query = supabase
        .from('user_roles')
        .select('role_key, is_primary, roles(name, color, emoji, purpose, supports_qbr)');

      query = identity.mode === 'canonical'
        ? query.eq('auth_user_id', identity.authUserId).eq('tenant_id', identity.tenantId)
        : query.eq('user_email', identity.userEmail);

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 300_000,
  });
}
