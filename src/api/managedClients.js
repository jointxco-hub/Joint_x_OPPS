import { supabase } from "@/lib/supabaseClient";

// Thin RPC wrappers - every RPC (see supabase/migrations/
// 20260823140000_managed_clients_control_plane.sql for the read model and
// 20260824090000_managed_clients_phase2_operations.sql for every
// mutation/provisioning/preflight RPC below) does all staff/app-admin
// authorization and the actual work server-side; this file just calls
// them and normalizes the result/error shape for React callers, matching
// the pattern already used by src/api/commerceOnboarding.js.
//
// Phase 2: admin_list_managed_clients() stays the only is_opps_staff()-
// gated (read) call. Every function below it requires is_app_admin() on
// the RPC side - these are high-impact operations (editing production
// workspace state, provisioning a tenant/client/domain/membership,
// activating a live XOS hostname), not ordinary staff-read visibility.

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
    return { data: null, error: error?.message || "Could not update workspace." };
  }
}

export async function adminInitializeManagedClientWorkspace({ tenantId, workspace }) {
  if (!supabase) return { data: null, error: "Supabase not configured" };
  if (!tenantId) return { data: null, error: "Missing tenant id" };

  try {
    const { data, error } = await supabase.rpc("admin_initialize_managed_client_workspace", {
      p_tenant_id: tenantId,
      p_workspace: workspace || {},
    });
    if (error) return { data: null, error: error.message };
    return { data, error: null };
  } catch (error) {
    return { data: null, error: error?.message || "Could not initialize workspace." };
  }
}

export async function adminPreviewManagedBrandProvisioning({ input }) {
  if (!supabase) return { data: null, error: "Supabase not configured" };
  if (!input) return { data: null, error: "Missing preflight input" };

  try {
    const { data, error } = await supabase.rpc("admin_preview_managed_brand_provisioning", {
      p_input: input,
    });
    if (error) return { data: null, error: error.message };
    return { data, error: null };
  } catch (error) {
    return { data: null, error: error?.message || "Could not run provisioning preflight." };
  }
}

export async function adminProvisionManagedBrand({ input, idempotencyKey }) {
  if (!supabase) return { data: null, error: "Supabase not configured" };
  if (!input || !idempotencyKey) return { data: null, error: "Missing provisioning input or idempotency key" };

  try {
    const { data, error } = await supabase.rpc("admin_provision_managed_brand", {
      p_input: input,
      p_idempotency_key: idempotencyKey,
    });
    if (error) return { data: null, error: error.message };
    return { data, error: null };
  } catch (error) {
    return { data: null, error: error?.message || "Could not provision managed brand." };
  }
}

export async function adminActivateManagedXosDomain({ tenantId }) {
  if (!supabase) return { data: null, error: "Supabase not configured" };
  if (!tenantId) return { data: null, error: "Missing tenant id" };

  try {
    const { data, error } = await supabase.rpc("admin_activate_managed_xos_domain", {
      p_tenant_id: tenantId,
    });
    if (error) return { data: null, error: error.message };
    return { data, error: null };
  } catch (error) {
    return { data: null, error: error?.message || "Could not activate XOS domain." };
  }
}

export async function adminSetManagedTenantProductsCapability({ tenantId, enabled }) {
  if (!supabase) return { data: null, error: "Supabase not configured" };
  if (!tenantId || typeof enabled !== "boolean") return { data: null, error: "Missing tenant id or enabled flag" };

  try {
    const { data, error } = await supabase.rpc("admin_set_managed_tenant_products_capability", {
      p_tenant_id: tenantId,
      p_enabled: enabled,
    });
    if (error) return { data: null, error: error.message };
    return { data, error: null };
  } catch (error) {
    return { data: null, error: error?.message || "Could not change products capability." };
  }
}
