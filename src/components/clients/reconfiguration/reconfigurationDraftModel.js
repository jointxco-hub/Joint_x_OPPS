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

// SAVE V1.1 SLICE 2 — the only component_type values a brand-new row may
// be created as (matches the server's own insert-only guard in
// save_client_product_reconfiguration). Reclassifying an EXISTING
// component can still move it to/from material/packaging/labour/other
// via the role selector below - this list only bounds what a staff
// member can pick when adding a component that never existed before.
export const NEW_COMPONENT_TYPE_OPTIONS = [
  { value: "blank_garment", label: "Blank garment", defaultBillingMode: "per_unit" },
  { value: "print_service", label: "Print / branding service", defaultBillingMode: "per_unit" },
  { value: "setup_fee", label: "Setup fee", defaultBillingMode: "once_per_order" },
  { value: "addon", label: "Add-on", defaultBillingMode: "per_unit" },
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

// SAVE V1.1 SLICE 2 — componentType/billingMode/label/defaultSellPrice are
// collected up front (the Add Component form) because a brand-new row has
// no prior server type to default from, unlike an existing row. Once
// added, `storedType` is set to that explicit choice, so the row behaves
// exactly like any other draft row from then on (same role selector, same
// price field, same remove button) - mapDraftComponentToBackendFields's
// existing "preserve the stored type when role is unchanged" branch
// applies to it identically. quantity_per_unit is fixed at 1 - these four
// commercial types are never BOM-consumption rows, so there is no
// legitimate reason to expose that field for a new row.
export function addDraftComponent(draftComponents, { componentType, billingMode, label, defaultSellPrice }) {
  const role = inferRoleForComponentType(componentType, billingMode);
  return [
    ...draftComponents,
    {
      draftId: nextTempId(),
      sourceId: null,
      isNew: true,
      removed: false,
      label: label || "",
      storedType: componentType,
      role,
      initialRole: role,
      billingMode: billingMode || "per_unit",
      defaultSellPrice: defaultSellPrice == null || defaultSellPrice === "" ? null : defaultSellPrice,
      quantityPerUnit: 1,
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

// Step 6 gating needs to know whether the draft is actively touching the
// commercial component total the live resolver already judged against -
// deliberately a presence check ("could this draft move the computed
// total away from what the live resolver saw?"), never a price
// calculation. It never sums a total or claims a new reconciliation
// status - only the server's resolver does that at Save. A component
// counts as pricing-affecting here if, relative to its live baseline,
// it was removed while live-commercial, moved into or out of the
// commercial bucket, or kept its commercial bucket but its price value
// differs (explicit 0 is a real value, never treated as blank).
export function hasPricingAffectingComponentChanges(liveComponents, draftComponents) {
  const liveFamily = (Array.isArray(liveComponents) ? liveComponents : []).filter(
    (c) => !c.garment_variant_id && !c.treatment_id && c.is_active !== false
  );
  const liveById = new Map(liveFamily.map((c) => [c.id, c]));
  const isCommercialRole = (role) => role === "COMMERCIAL_PER_UNIT" || role === "COMMERCIAL_ONCE";

  for (const row of Array.isArray(draftComponents) ? draftComponents : []) {
    if (row.isNew) continue; // never sent to the server - can never affect the server's total

    const live = row.sourceId ? liveById.get(row.sourceId) : null;
    const liveIsCommercial = live ? isCommercialRole(inferRoleForComponentType(live.component_type, live.billing_mode)) : false;

    if (row.removed) {
      if (liveIsCommercial) return true; // removing a priced commercial component changes the total
      continue;
    }

    const draftIsCommercial = isCommercialRole(row.role);
    if (draftIsCommercial !== liveIsCommercial) return true; // moved into or out of the commercial bucket

    if (draftIsCommercial) {
      const livePrice = live ? Number(live.default_sell_price ?? 0) : 0;
      const draftPrice = row.defaultSellPrice == null || row.defaultSellPrice === "" ? 0 : Number(row.defaultSellPrice);
      if (draftPrice !== livePrice) return true;
    }
  }
  return false;
}

// SAVE V1 — maps a draft component's UI-only `role` back onto the real
// backend fields (component_type, billing_mode). `role` is deliberately
// a Draft/UI simplification (4 buckets) that does not uniquely determine
// one of the 8 real component_type values - it must never become an
// unauthorized DB field itself. When the component's own stored type
// already belongs to the current role's bucket, that exact original
// type is preserved unchanged. Only a genuine cross-bucket reclassification
// (or a brand-new component, which never had a stored type) falls back
// to one deliberately generic, documented type per bucket.
export function mapDraftComponentToBackendFields(component) {
  const { role, storedType, billingMode } = component;
  if (storedType) {
    const naturalRole = inferRoleForComponentType(storedType, billingMode);
    if (naturalRole === role) {
      return { component_type: storedType, billing_mode: billingMode || "per_unit" };
    }
  }
  switch (role) {
    case "COMMERCIAL_PER_UNIT":
      return { component_type: "addon", billing_mode: "per_unit" };
    case "COMMERCIAL_ONCE":
      return { component_type: "addon", billing_mode: "once_per_order" };
    case "PRODUCTION_BOM":
      return { component_type: "material", billing_mode: "per_unit" };
    case "INFORMATIONAL":
    default:
      return { component_type: "other", billing_mode: "per_unit" };
  }
}

// SAVE V1.2 SLICE 1 — one shared diff, used by both the Save payload and
// the before/after review (buildComponentChangeSummary below), so there
// is exactly one place that decides "did this row actually change" -
// never two parallel algorithms that could quietly disagree. Compares
// only the five fields the Save RPC can actually write (component_type,
// billing_mode, default_sell_price, quantity_per_unit, label) against
// the row's live, currently-stored values. An existing row identical to
// its live counterpart is left out of the payload entirely (never sent
// as a no-op 'update') and is absent from `changed`; new/removed rows
// are unaffected - insert/remove always fire exactly as before. If a
// row's live counterpart can't be found at all (should not happen in
// practice), it is treated as changed rather than silently dropped -
// the safe default when a diff can't be proven.
function diffDraftComponents(liveComponents, draftComponents) {
  const liveFamily = (Array.isArray(liveComponents) ? liveComponents : []).filter(
    (c) => !c.garment_variant_id && !c.treatment_id && c.is_active !== false
  );
  const liveById = new Map(liveFamily.map((c) => [c.id, c]));
  const rows = Array.isArray(draftComponents) ? draftComponents : [];

  const payload = [];
  const added = [];
  const changed = [];
  const removed = [];

  for (const c of rows) {
    if (c.isNew && c.removed) continue; // added then removed before save - never sent, never shown

    if (!c.isNew && c.removed) {
      const live = liveById.get(c.sourceId);
      payload.push({ action: "remove", source_id: c.sourceId });
      removed.push({
        label: live?.label || c.label || "(no label)",
        componentType: live?.component_type || c.storedType || "unknown",
        price: live?.default_sell_price ?? null,
      });
      continue;
    }

    const mapped = mapDraftComponentToBackendFields(c);
    const qty = c.isNew
      ? 1
      : (c.quantityPerUnit == null || c.quantityPerUnit === "" ? 1 : Number(c.quantityPerUnit));
    const price = c.defaultSellPrice == null || c.defaultSellPrice === "" ? null : Number(c.defaultSellPrice);
    const label = c.label || null;

    if (c.isNew) {
      payload.push({
        action: "insert",
        source_id: null,
        component_type: mapped.component_type,
        billing_mode: mapped.billing_mode,
        default_sell_price: price,
        quantity_per_unit: qty,
        label,
      });
      added.push({ label, componentType: mapped.component_type, price });
      continue;
    }

    const live = liveById.get(c.sourceId);
    const liveIsIdentical =
      live &&
      live.component_type === mapped.component_type &&
      (live.billing_mode || "per_unit") === mapped.billing_mode &&
      (live.default_sell_price == null ? null : Number(live.default_sell_price)) === price &&
      Number(live.quantity_per_unit ?? 1) === qty &&
      (live.label || null) === label;

    if (liveIsIdentical) continue; // unchanged - omit from payload and from the review

    payload.push({
      action: "update",
      source_id: c.sourceId,
      component_type: mapped.component_type,
      billing_mode: mapped.billing_mode,
      default_sell_price: price,
      quantity_per_unit: qty,
      label,
    });
    changed.push({
      label: label || live?.label || "(no label)",
      componentType: mapped.component_type,
      oldPrice: live?.default_sell_price ?? null,
      newPrice: price,
    });
  }

  return { payload, added, changed, removed };
}

// SAVE V1 — the exact p_components payload the save RPC expects. Every
// entry maps straight to the RPC's own per-entry contract (action,
// source_id, component_type, billing_mode, default_sell_price,
// quantity_per_unit, label) - no price arithmetic, no derived total.
// New-then-removed rows are never included, by construction.
//
// SAVE V1.2 SLICE 1 — an existing row identical to its live stored
// values is now omitted entirely rather than resent as a no-op
// 'update' (see diffDraftComponents above). SAVE V1.1 SLICE 2 — a row
// with isNew still true is sent as action: "insert" (never with a
// source_id); quantity_per_unit is always 1 for a new row.
export function buildSaveComponentPayload(liveComponents, draftComponents) {
  return diffDraftComponents(liveComponents, draftComponents).payload;
}

// SAVE V1.2 SLICE 1 — the before/after review's data source. Raw stored
// values only (label, component type, price, old price, new price) -
// never a computed total, never anything the resolver itself owns.
// Built from the exact same diff buildSaveComponentPayload uses, so the
// review can never show a change that wasn't actually sent, or omit one
// that was.
export function buildComponentChangeSummary(liveComponents, draftComponents) {
  const { added, changed, removed } = diffDraftComponents(liveComponents, draftComponents);
  return { added, changed, removed };
}

// SAVE V1.1 SLICE 2 — a pending new row needs a real label and a valid
// price before it can be sent at all (the server rejects a blank label
// on insert with SAVE_COMPONENT_LABEL_REQUIRED, and has no concept of a
// deliberately-unpriced NEW commercial row the way an existing one can
// be left unresolved). Price validity mirrors the agreed-price field's
// own rule exactly: checked by Number.isFinite, never truthiness, so an
// explicit 0 is valid and only blank/NaN/negative are not.
export function isPendingNewComponentValid(component) {
  const hasLabel = Boolean(component.label && component.label.trim());
  const priceNum = Number(component.defaultSellPrice);
  const hasValidPrice =
    component.defaultSellPrice != null &&
    component.defaultSellPrice !== "" &&
    Number.isFinite(priceNum) &&
    priceNum >= 0;
  return hasLabel && hasValidPrice;
}

export function buildInitialProduction(product) {
  return {
    printMethod: product.print_method || "__none",
    placement: product.placement || "",
    artworkRequired: null, // unset - staff decides locally, nothing to infer safely
  };
}
