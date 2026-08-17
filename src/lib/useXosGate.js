import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

const EMPTY_GATE = {
  loading: true,
  allowed: false,
  reason: '',
  tenant_slug: '',
  tenant_name: '',
  hostname: '',
};

// Wraps resolve_xos_admin_gate exactly as before (same RPC, same
// parameters, same response shape) - this is unchanged from the version
// verified during the XOS 1 cutover, just extracted out of
// XOSAdminShell so the shell component can stay focused on layout/routing.
export function useXosGate(isLoadingAuth, isAuthenticated) {
  const [gate, setGate] = useState(EMPTY_GATE);

  useEffect(() => {
    let cancelled = false;

    const resolveGate = async () => {
      if (!supabase) {
        if (!cancelled) {
          setGate({
            ...EMPTY_GATE,
            loading: false,
            reason: 'site_not_configured',
            hostname: window.location.hostname,
          });
        }
        return;
      }

      const { data, error } = await supabase.rpc('resolve_xos_admin_gate', {
        p_hostname: window.location.hostname,
      });
      const resolved = Array.isArray(data) ? data[0] : data;

      if (!cancelled) {
        setGate({
          loading: false,
          allowed: Boolean(resolved?.allowed),
          reason: error ? 'site_not_configured' : resolved?.reason || 'site_not_configured',
          tenant_slug: resolved?.tenant_slug || '',
          tenant_name: resolved?.tenant_name || '',
          hostname: resolved?.hostname || window.location.hostname,
        });
      }
    };

    if (!isLoadingAuth) {
      resolveGate();
    }

    return () => {
      cancelled = true;
    };
  }, [isLoadingAuth, isAuthenticated]);

  return gate;
}
