import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';

export function useCompanyNorthStar() {
  return useQuery({
    queryKey: ['company-north-star'],
    queryFn: async () => {
      if (!supabase) return null;
      const { data, error } = await supabase
        .from('goals')
        .select('*')
        .eq('is_north_star', true)
        .eq('is_archived', false)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  });
}
