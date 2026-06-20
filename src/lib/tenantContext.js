import { supabase } from "@/lib/supabaseClient";

const TENANT_CACHE_KEY = "jx_current_tenant";
let tenantPromise = null;

export async function getCurrentTenantId() {
  if (!supabase) return null;
  if (!tenantPromise) {
    tenantPromise = (async () => {
      const { data: authData } = await supabase.auth.getUser();
      const authUserId = authData?.user?.id;
      if (!authUserId) return null;

      const { data, error } = await supabase
        .from("tenant_memberships")
        .select("tenant_id, tenants!inner(id, slug, status)")
        .eq("auth_user_id", authUserId)
        .eq("status", "active");

      if (error) throw new Error(error.message);
      const memberships = data || [];
      const savedTenantId = window.localStorage.getItem(TENANT_CACHE_KEY);
      const selected = memberships.find((membership) => membership.tenant_id === savedTenantId)
        || memberships.find((membership) => membership.tenants?.status === "active");
      if (!selected) throw new Error("Your account is not assigned to an active tenant.");
      window.localStorage.setItem(TENANT_CACHE_KEY, selected.tenant_id);
      return selected.tenant_id;
    })();
  }
  return tenantPromise;
}

export function resetTenantContext() {
  tenantPromise = null;
}
