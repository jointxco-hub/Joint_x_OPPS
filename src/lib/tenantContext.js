import { supabase } from "@/lib/supabaseClient";

const TENANT_CACHE_KEY = "jx_current_tenant";
let tenantPromise = null;

export function resetTenantContext() {
  tenantPromise = null;
}

// tenantPromise previously had exactly one caller of resetTenantContext()
// in the whole app: none. Once resolved for one identity, it stayed
// memoized for the page's entire lifetime - a sign-out followed by a
// different account signing in in the same tab would keep serving the
// first account's tenant_id to every tenant-scoped query.
//
// Self-contained here (registered once at module load, using the
// `supabase` client this file already imports) rather than wired through
// AuthContext, so there's no import cycle to manage: nothing needs to
// import back into this module.
//
// Deliberately reacts only to SIGNED_OUT/SIGNED_IN/INITIAL_SESSION -
// identity-changing events - and not TOKEN_REFRESHED/USER_UPDATED/etc.,
// so a same-user token refresh never wipes an already-valid selected
// tenant (requirement: refresh must not disrupt a normal browsing
// session). getCurrentTenantId()'s own saved-tenant validation against
// the fresh membership list (below) already handles "stored tenant is no
// longer valid for this identity" correctly once given the chance to
// re-run - this listener's only job is making sure it gets that chance.
if (supabase) {
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT" || event === "SIGNED_IN" || event === "INITIAL_SESSION") {
      resetTenantContext();
    }
  });
}

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
