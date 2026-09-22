import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { calculateExecutionScore } from '@/lib/twelveWeekYear';

// Phase 2B: prefers the canonical auth_user_id (array-containment match
// against weekly_tasks.assigned_auth_user_ids), falling back to legacy
// email only when no authUserId is available. Also fixes a pre-existing
// correctness bug: weekly_tasks.assigned_to is a text[] column, so the
// previous .eq('assigned_to', userEmail) compared a scalar email against
// an array and could never match - .contains() (Postgres `@>`) is the
// correct array-containment check, used for both the id and the email
// fallback path.
export function useMyExecutionScore(authUserId, userEmail, cycleId) {
  return useQuery({
    queryKey: ['my-execution-score', authUserId || userEmail, cycleId],
    enabled: !!(authUserId || userEmail) && !!cycleId && !!supabase,
    queryFn: async () => {
      let query = supabase.from('weekly_tasks').select('status').eq('cycle_id', cycleId);
      query = authUserId
        ? query.contains('assigned_auth_user_ids', [authUserId])
        : query.contains('assigned_to', [userEmail]);
      const { data, error } = await query;
      if (error) throw error;
      return calculateExecutionScore(data ?? []);
    },
    staleTime: 60_000,
  });
}
