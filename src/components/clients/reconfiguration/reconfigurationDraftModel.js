// CLIENT PRODUCT RECONFIGURATION — DRAFT V1 — pure data/model helpers.
//
// Everything here is plain data shaping (grouping, copying, presence
// checks). Nothing here sums, multiplies, or otherwise recomputes a
// price — that line is deliberate. See ReconfigurationDraftWorkflow.jsx's
// Step 5 for why: any local price total would re-derive the exact
// quantity public.resolve_client_product_price() already computes,
// which is the "second pricing engine" this slice was explicitly told
// not to build.

export const CLASSIFICATION_OPTIONS = [
  { value: "XLAB_COMMERCIAL", label: "X LAB Commercial", hint: "Sold through the live X LAB storefront. Storefront price stays locked." },
  { value: "CLIENT_RECURRING", label: "Client Recurring", hint: "Reordered regularly for this client. Worth a clean rebuild." },
  { value: "CLIENT_ONCE_OFF", label: "Client Once-off", hint: "A single run for this client. Minimal setup is enough." },
  { value: "HISTORICAL_ONLY", label: "Historical Only", hint: "Already sold, not expected to be reordered. Usually no rebuild needed." },
  { value: "TEST_STALE", label: "Test / Stale", hint: "Looks like test or leftover data, not a real sold product." },
  { value: "NEEDS_REVIEW", label: "Needs Review", hint: "Not sure yet — keep looking, don't treat this draft as final." },
];

export const EARLY_STOP_CLASSIFICATIONS = new Set(["HISTORICAL_ONLY", "TEST_STALE"]);

export const COMPONENT_ROLE_OPTIONS = [
  { value: "COMMERCIAL_PER_UNIT", label: "A. Commercial per-unit", group: "commercial" },
  { value: "COMMERCIAL_ONCE", label: "B. Commercial once-per-order", group: "commercial" },
  { value: "PRODUCTION_BOM", label: "C. Production / BOM", group: "production" },
  { value: "INFORMATIONAL", label: "D. Informational / non-pricing", group: "production" },
];

// Best-guess starting role for each existing component_type - staff can
// always override it in the draft. This mirrors the same split Review
// v1 already uses (COMMERCIAL_TYPES in ProductConfigurationReview.jsx),
// just split one level further into per-unit vs once-per-order using
// the component's own billing_mode.
export function inferRoleForComponentType(componentType, billingMode) {
  if (componentType === "setup_fee") return "COMMERCIAL_ONCE";
  if (componentType === "blank_garment" || componentType === "print_service") return "COMMERCIAL_PER_UNIT";
  if (componentType === "addon") return billingMode === "once_per_order" ? "COMMERCIAL_ONCE" : "COMMERCIAL_PER_UNIT";
  if (componentType === "material" || componentType === "packaging" || componentType === "labour") return "PRODUCTION_BOM";
  return "INFORMATIONAL"; // 'other' and anything unrecognized
}

export const DIVERGENCE_REASONS = [
  "Negotiated client rate",
  "Legacy agreed rate",
  "Commercial strategy",
  "Bundle consideration",
  "Manual correction",
  "Other",
];

let tempIdCounter = 0;
function nextTempId() {
  tempIdCounter += 1;
  return `draft-new-${tempIdCounter}`;
}

// Snapshots the real, currently-saved family-scope components into local
// draft rows. Deliberately plain fields only - no derived totals.
export function buildDraftComponents(components) {
  return (Array.isArray(components) ? components : [])
    .filter((c) => !c.garment_variant_id && !c.treatment_id && c.is_active !== false)
    .map((c) => {
      const role = inferRoleForComponentType(c.component_type, c.billing_mode);
      return {
        draftId: c.id,
        sourceId: c.id,
        isNew: false,
        removed: false,
        label: c.label || "",
        storedType: c.component_type,
        role,
        initialRole: role,
        billingMode: c.billing_mode || "per_unit",
        defaultSellPrice: c.default_sell_price ?? null,
        quantityPerUnit: c.quantity_per_unit ?? null,
      };
    });
}

export function addDraftComponent(draftComponents) {
  return [
    ...draftComponents,
    {
      draftId: nextTempId(),
      sourceId: null,
      isNew: true,
      removed: false,
      label: "",
      storedType: null,
      role: "COMMERCIAL_PER_UNIT",
      initialRole: "COMMERCIAL_PER_UNIT",
      billingMode: "per_unit",
      defaultSellPrice: null,
      quantityPerUnit: null,
    },
  ];
}

export function visibleDraftComponents(draftComponents) {
  return (draftComponents || []).filter((c) => !c.removed);
}

export function groupByRole(draftComponents) {
  const visible = visibleDraftComponents(draftComponents);
  const byRole = {};
  for (const opt of COMPONENT_ROLE_OPTIONS) byRole[opt.value] = [];
  for (const c of visible) {
    (byRole[c.role] || (byRole[c.role] = [])).push(c);
  }
  return byRole;
}

// Plain counts and presence checks only - never a price total.
export function describeComponentDelta(liveComponents, draftComponents) {
  const liveFamily = (Array.isArray(liveComponents) ? liveComponents : []).filter(
    (c) => !c.garment_variant_id && !c.treatment_id && c.is_active !== false
  );
  const liveCommercialCount = liveFamily.filter((c) =>
    ["blank_garment", "print_service", "setup_fee", "addon"].includes(c.component_type)
  ).length;
  const liveBomCount = liveFamily.length - liveCommercialCount;
  const liveUnresolvedCount = liveFamily.filter(
    (c) => ["blank_garment", "print_service", "setup_fee", "addon"].includes(c.component_type) && c.default_sell_price == null
  ).length;

  const visibleDraft = visibleDraftComponents(draftComponents);
  const draftCommercialCount = visibleDraft.filter((c) => c.role === "COMMERCIAL_PER_UNIT" || c.role === "COMMERCIAL_ONCE").length;
  const draftBomCount = visibleDraft.filter((c) => c.role === "PRODUCTION_BOM" || c.role === "INFORMATIONAL").length;
  const draftUnresolvedCount = visibleDraft.filter(
    (c) => (c.role === "COMMERCIAL_PER_UNIT" || c.role === "COMMERCIAL_ONCE") && (c.defaultSellPrice == null || c.defaultSellPrice === "")
  ).length;

  return {
    live: { commercialCount: liveCommercialCount, bomCount: liveBomCount, unresolvedCount: liveUnresolvedCount },
    draft: { commercialCount: draftCommercialCount, bomCount: draftBomCount, unresolvedCount: draftUnresolvedCount },
  };
}

// Purely structural counts - added/removed/reclassified rows - never a
// price total. Used only for the before/after summary's "Draft component
// changes" line.
export function describeComponentChanges(draftComponents) {
  const rows = Array.isArray(draftComponents) ? draftComponents : [];
  const added = rows.filter((c) => c.isNew && !c.removed).length;
  const removed = rows.filter((c) => !c.isNew && c.removed).length;
  const reclassified = rows.filter((c) => !c.isNew && !c.removed && c.role !== c.initialRole).length;
  return { added, removed, reclassified };
}

export function buildInitialProduction(product) {
  return {
    printMethod: product.print_method || "__none",
    placement: product.placement || "",
    artworkRequired: null, // unset - staff decides locally, nothing to infer safely
  };
}
