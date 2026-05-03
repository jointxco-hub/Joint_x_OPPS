import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';

export function useActiveCompanyCycle() {
  return useQuery({
    queryKey: ['active-company-cycle'],
    queryFn: async () => {
      if (!supabase) return null;
      const { data, error } = await supabase
        .from('twelve_week_cycles')
        .select('*')
        .eq('is_active', true)
        .order('start_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  });
}
