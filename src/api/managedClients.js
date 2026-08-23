import { supabase } from "@/lib/supabaseClient";

// Thin RPC wrappers - the RPCs themselves (see supabase/migrations/
// 20260823140000_managed_clients_control_plane.sql) do all staff
// authorization and the actual unified read/write work; this just calls
// them and normalizes the result/error shape for React callers, matching
// the pattern already used by src/api/commerceOnboarding.js.

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

export async function adminUpdateManagedClientWorkspace({ workspaceId, updates }) {
  if (!supabase) return { data: null, error: "Supabase not configured" };
  if (!workspaceId || !updates) return { data: null, error: "Missing workspace id or updates" };

  try {
    const { data, error } = await supabase.rpc("admin_update_managed_client_workspace", {
      p_workspace_id: workspaceId,
      p_updates: updates,
    });
    if (error) return { data: null, error: error.message };
    return { data, error: null };
  } catch (error) {
    return { data: null, error: error?.message || "Could not update managed client workspace." };
  }
}
