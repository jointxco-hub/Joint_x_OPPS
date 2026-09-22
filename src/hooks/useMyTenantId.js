import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';

// Phase 2C: resolves the caller's active tenant_id in the joint-x (OPPS)
// tenant specifically — not "whichever tenant_memberships row comes
// back first" (see WorkReports.jsx for that looser pattern, unchanged
// here as it's out of this phase's scope). Explicit scoping matters
// because a founder/admin identity can plausibly hold active membership
// in more than one tenant (e.g. also Quick Solution Café), and My Hub
// must never resolve to the wrong one.
export function useMyTenantId(authUserId) {
  return useQuery({
    queryKey: ['my-tenant-id', 'joint-x', authUserId],
    enabled: !!authUserId && !!supabase,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tenant_memberships')
        .select('tenant_id, tenants!inner(slug)')
        .eq('auth_user_id', authUserId)
        .eq('status', 'active')
        .eq('tenants.slug', 'joint-x')
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data?.tenant_id ?? null;
    },
    staleTime: 300_000,
  });
}
