import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';

export function useMyTags(userEmail) {
  return useQuery({
    queryKey: ['my-tags', userEmail],
    enabled: !!userEmail && !!supabase,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_tags')
        .select('*, orders(id, customer_name, pipeline_stage)')
        .eq('user_email', userEmail)
        .is('resolved_at', null)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 30_000,
  });
}
