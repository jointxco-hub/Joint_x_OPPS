import { supabase } from "@/lib/supabaseClient";

// Thin RPC wrapper - the RPC itself (see supabase/migrations/
// 20260823140000_managed_clients_control_plane.sql) does all staff
// authorization and the actual unified read work; this just calls it and
// normalizes the result/error shape for React callers, matching the
// pattern already used by src/api/commerceOnboarding.js.
//
// Read-only in this phase (post-review): a write RPC
// (admin_update_managed_client_workspace) was removed before final review
// - nothing in the Phase 0/1 UI calls a mutation yet, so it was cut
// rather than shipped unused. Legacy workspace editing is next-phase
// work.

export async function adminListManagedClients() {
  if (!supabase) return { data: null, error: "Supabase not configured" };

  try {
    const { data, error } = await supabase.rpc("admin_list_managed_clients");
    if (error) return { data: null, error: error.message };
    return { data: data || [], error: null };
  } catch (error) {
    return { data: null, error: error?.message || "Could not load managed clients." };
  }
}
