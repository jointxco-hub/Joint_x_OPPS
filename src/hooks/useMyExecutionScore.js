import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { calculateExecutionScore } from '@/lib/twelveWeekYear';

export function useMyExecutionScore(userEmail, cycleId) {
  return useQuery({
    queryKey: ['my-execution-score', userEmail, cycleId],
    enabled: !!userEmail && !!cycleId && !!supabase,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('weekly_tasks')
        .select('status')
        .eq('assigned_to', userEmail)
        .eq('cycle_id', cycleId);
      if (error) throw error;
      return calculateExecutionScore(data ?? []);
    },
    staleTime: 60_000,
  });
}
