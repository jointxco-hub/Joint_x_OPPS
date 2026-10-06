// SAVE V1.1 — shared staff-facing labels for the canonical resolver's own
// enums (reconciliation_status, price_source). One source of truth so
// ProductConfigurationReview and ReconfigurationDraftWorkflow never
// maintain two copies of the same mapping. Labels only - nothing here
// reads, calls, or recomputes anything the resolver itself owns.

export const RECONCILIATION_STATUS_META = {
  reconciled: {
    label: "Pricing aligned",
    hint: "The agreed price matches what the priced components add up to.",
    tone: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  diverged: {
    label: "Agreed price differs from component total",
    hint: "This can be intentional (a negotiated rate) - it is not automatically a problem.",
    tone: "bg-slate-100 text-slate-700 border-slate-200",
  },
  unresolved_components: {
    label: "Pricing incomplete",
    hint: "One or more pricing components has no sell price set yet.",
    tone: "bg-amber-50 text-amber-800 border-amber-200",
  },
  no_composition: {
    label: "Agreed price set — composition not configured",
    hint: "No priced components exist for this product yet.",
    tone: "bg-slate-100 text-slate-500 border-slate-200",
  },
};

const UNKNOWN_STATUS_META = {
  label: "Status unavailable",
  hint: "This product has no resolver result yet.",
  tone: "bg-slate-100 text-slate-500 border-slate-200",
};

export function getReconciliationStatusMeta(status) {
  return RECONCILIATION_STATUS_META[status] || UNKNOWN_STATUS_META;
}

export const PRICE_SOURCE_LABELS = {
  agreed: "Agreed price",
  override: "Override price",
  default_zero: "No agreed price set",
};

export function getPriceSourceLabel(source) {
  return PRICE_SOURCE_LABELS[source] || (source ?? "—");
}
