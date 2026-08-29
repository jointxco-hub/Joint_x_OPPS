// OPPS tenant-identity display helper (XOS 2.7A).
//
// Display only. The authoritative tenant is always order.tenant_id ->
// tenants.id (enforced by RLS, unchanged by this file). This module never
// infers tenant identity from order_number, storefront_host, or source,
// and never performs or duplicates any authorization check - it only
// formats a tenant row (already fetched under the caller's own
// permissions) into something safe to render.

const VALID_PREFIX = /^[A-Z0-9]{2,8}$/;

// order_prefix is validated at write time (see
// supabase/migrations/20260829100000_xos_2_6_tenant_identity_polish.sql
// and the tenant provisioning template) to the same ^[A-Z0-9]{2,8}$
// shape - re-validated here too, defensively, so a malformed/legacy
// settings value can never render as-is.
function normalizePrefix(rawPrefix) {
  const prefix = typeof rawPrefix === "string" ? rawPrefix.trim().toUpperCase() : "";
  return VALID_PREFIX.test(prefix) ? prefix : null;
}

// A tenant with no configured order_prefix (provisioned before XOS 2.6,
// or mid-onboarding) still needs a short, non-UUID badge - derive one
// from the slug rather than ever falling back to the raw tenant_id.
function compactLabelFromSlug(slug) {
  const cleaned = String(slug || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return cleaned ? cleaned.slice(0, 4) : null;
}

/**
 * Builds a { tenantId -> tenant row } lookup once per fetched tenants
 * list. Callers fetch dataClient.entities.Tenant.list() a single time
 * (small, cacheable table) and pass the result through this before
 * rendering any order row/card/drawer.
 */
export function buildTenantsById(tenants) {
  const map = {};
  for (const tenant of tenants || []) {
    if (tenant?.id) map[tenant.id] = tenant;
  }
  return map;
}

/**
 * Resolves the display identity for one order, strictly via
 * order.tenant_id -> tenantsById. Never reads order.order_number,
 * order.storefront_host, or order.source for this purpose.
 *
 * Returns { label, name, slug, unknown }:
 *   - label: short badge text (validated order_prefix, or a
 *     slug-derived fallback, or "—" - never a raw UUID).
 *   - name: full tenant name for tooltip/drawer use.
 *   - slug: tenant slug, or null.
 *   - unknown: true when tenant_id doesn't resolve against the supplied
 *     lookup (missing tenant_id, tenant not yet loaded, or a genuinely
 *     unknown/inactive tenant) - callers can style this subtly rather
 *     than treating it as an error.
 */
export function getTenantDisplayMeta(order, tenantsById) {
  const tenantId = order?.tenant_id;
  const tenant = tenantId ? tenantsById?.[tenantId] : null;

  if (!tenant) {
    return { label: "—", name: "Unknown tenant", slug: null, unknown: true };
  }

  const label = normalizePrefix(tenant.settings?.order_prefix) ?? compactLabelFromSlug(tenant.slug) ?? "—";

  return {
    label,
    name: tenant.name || tenant.slug || "Unnamed tenant",
    slug: tenant.slug || null,
    unknown: false,
  };
}
