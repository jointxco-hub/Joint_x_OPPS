// Phase 1F-B - pure helpers for the OPPS Client Product Production tab.
// No React / Supabase imports so this stays node --test-able (same
// convention as src/lib/clientProductReadiness.js). These only summarize
// and describe the EXISTING production model - they never compute pricing
// or readiness, and never decide authorization.

export const PRODUCTION_READONLY_MESSAGE =
  "Production configuration is read-only for your current role. Ask an owner/admin to make structural production changes.";

export const PRICING_PREVIEW_BOUNDARY =
  "Production pricing preview. This does not automatically change the customer's order price, order totals, invoices or setup fees.";

// components: product_components rows (all scopes). variants / treatments:
// client_product_garment_variants / client_product_treatments rows.
// mappings: client_product_variant_treatments rows.
export function summarizeProduction({ components = [], variants = [], treatments = [], mappings = [] } = {}) {
  const list = Array.isArray(components) ? components : [];
  const familyComponents = list.filter((c) => !c.garment_variant_id && !c.treatment_id && c.is_active !== false);
  const activeVariants = (Array.isArray(variants) ? variants : []).filter((v) => v.is_active !== false);
  const activeTreatments = (Array.isArray(treatments) ? treatments : []).filter((t) => t.is_active !== false);
  const activeMappings = (Array.isArray(mappings) ? mappings : []).filter((m) => m.is_active);
  return {
    familyComponentCount: familyComponents.length,
    totalComponentCount: list.filter((c) => c.is_active !== false).length,
    variantCount: activeVariants.length,
    treatmentCount: activeTreatments.length,
    mappingCount: activeMappings.length,
  };
}

// Human, non-blocking "production setup incompleteness" hints for the
// Production overview (Section L). Never a hard gate - the DB
// ready_to_order trigger and admin_get_client_product_artwork_readiness
// remain the authorities.
export function deriveProductionGaps({ components = [], variants = [], treatments = [], mappings = [] } = {}) {
  const s = summarizeProduction({ components, variants, treatments, mappings });
  const gaps = [];
  if (s.familyComponentCount === 0 && s.variantCount === 0) {
    gaps.push("No production composition yet - add family components or garment variants.");
  }
  if (s.variantCount > 0 && s.treatmentCount > 0 && s.mappingCount === 0) {
    gaps.push("Garment variants and treatments exist but no variant is mapped to any treatment yet.");
  }
  if (s.treatmentCount > 0 && s.variantCount === 0) {
    gaps.push("Treatments exist but there are no garment variants to allow them on.");
  }
  return gaps;
}

// Read-only variant x treatment matrix for "Allowed combinations".
// Editing still happens inside each garment variant's own mapping editor -
// this is a family-level view only.
export function buildAllowedCombinationMatrix({ variants = [], treatments = [], mappings = [] } = {}) {
  const activeVariants = (Array.isArray(variants) ? variants : []).filter((v) => v.is_active !== false);
  const activeTreatments = (Array.isArray(treatments) ? treatments : []).filter((t) => t.is_active !== false);
  const activeMap = new Set(
    (Array.isArray(mappings) ? mappings : [])
      .filter((m) => m.is_active)
      .map((m) => `${m.garment_variant_id}:${m.treatment_id}`),
  );
  return activeVariants.map((v) => ({
    variant: v,
    allowed: activeTreatments.map((t) => ({ treatment: t, allowed: activeMap.has(`${v.id}:${t.id}`) })),
  }));
}
