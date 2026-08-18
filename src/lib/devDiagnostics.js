import { supabase } from "@/lib/supabaseClient";
import { getCurrentTenantId } from "@/lib/tenantContext";
import { dataClient } from "@/api/dataClient";

const TENANT_CACHE_KEY = "jx_current_tenant";

// Temporary, staff-facing diagnostic snapshot for comparing why normal
// browser / installed PWA / mobile show different order (and possibly
// invoice) counts. Not wired into any permanent UI flow - see
// DiagnosticsPanel.jsx, itself only mounted behind a manual trigger.
// Never deployed/reported until explicitly approved; safe to remove
// entirely once the discrepancy is confirmed fixed.
//
// Deliberately reports only identifiers (user id/email, tenant id,
// order ids/count) - never an access/refresh token, never a signed URL.
export async function collectDiagnosticSnapshot() {
  const snapshot = {
    collectedAt: new Date().toISOString(),
    location: {
      href: typeof window !== "undefined" ? window.location.href : null,
      standalone: typeof window !== "undefined" && window.matchMedia
        ? window.matchMedia("(display-mode: standalone)").matches
        : null,
    },
    build: {
      mode: import.meta.env.MODE,
      // Only populated if the deploy pipeline sets this; absence is
      // itself diagnostic (means bundle age can't be compared directly).
      commitSha: import.meta.env.VITE_COMMIT_SHA || import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA || null,
    },
    auth: { userId: null, email: null, error: null },
    tenant: {
      resolvedTenantId: null,
      localStorageTenantId: typeof window !== "undefined" ? window.localStorage.getItem(TENANT_CACHE_KEY) : null,
      error: null,
    },
    orders: { fetchedCount: null, activeCount: null, firstFiveActiveIds: [], error: null },
    serviceWorker: {
      supported: typeof navigator !== "undefined" && "serviceWorker" in navigator,
      controllerScriptURL: null,
      registrations: [],
    },
  };

  try {
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    snapshot.auth.userId = authData?.user?.id || null;
    snapshot.auth.email = authData?.user?.email || null;
  } catch (error) {
    snapshot.auth.error = error?.message || String(error);
  }

  try {
    snapshot.tenant.resolvedTenantId = await getCurrentTenantId();
  } catch (error) {
    snapshot.tenant.error = error?.message || String(error);
  }

  try {
    // Mirrors Dashboard.jsx's exact query/filter (ents.Order.filter +
    // the delivered/cancelled exclusion) so the numbers are directly
    // comparable to what each surface's Dashboard actually renders.
    const ents = dataClient.entities;
    const orders = await ents.Order.filter({ is_archived: false }, "-created_date", 100);
    const activeOrders = (orders || []).filter((o) => !["delivered", "cancelled"].includes(o.status));
    snapshot.orders.fetchedCount = orders?.length ?? 0;
    snapshot.orders.activeCount = activeOrders.length;
    snapshot.orders.firstFiveActiveIds = activeOrders.slice(0, 5).map((o) => ({
      id: o.id,
      order_number: o.order_number,
      status: o.status,
      tenant_id: o.tenant_id,
    }));
  } catch (error) {
    snapshot.orders.error = error?.message || String(error);
  }

  if (snapshot.serviceWorker.supported) {
    try {
      snapshot.serviceWorker.controllerScriptURL = navigator.serviceWorker.controller?.scriptURL || null;
      const registrations = await navigator.serviceWorker.getRegistrations();
      snapshot.serviceWorker.registrations = registrations.map((reg) => ({
        scope: reg.scope,
        active: reg.active?.scriptURL || null,
        waiting: reg.waiting?.scriptURL || null,
        installing: reg.installing?.scriptURL || null,
      }));
    } catch (error) {
      snapshot.serviceWorker.error = error?.message || String(error);
    }
  }

  return snapshot;
}
