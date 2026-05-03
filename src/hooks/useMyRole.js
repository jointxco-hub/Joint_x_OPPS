import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';

export function useMyRole(userEmail) {
  return useQuery({
    queryKey: ['my-role', userEmail],
    enabled: !!userEmail && !!supabase,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_roles')
        .select('role_id, roles(id, name, color, icon, focus_areas)')
        .eq('user_email', userEmail)
        .eq('is_primary', true)
        .maybeSingle();
      if (error) throw error;
      return data?.roles ?? null;
    },
    staleTime: 300_000,
  });
}
