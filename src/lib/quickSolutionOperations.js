export const QUICK_SOLUTION_PIPELINE_STAGES = [
  { key: "received", display_name: "Received", sequence: 10, is_exception: false, legacy_status: "confirmed" },
  { key: "preflight", display_name: "Prepare / preflight", sequence: 20, is_exception: false, legacy_status: "in_production" },
  { key: "production", display_name: "Production", sequence: 30, is_exception: false, legacy_status: "in_production" },
  { key: "finishing", display_name: "Finishing", sequence: 40, is_exception: false, legacy_status: "in_production" },
  { key: "qa", display_name: "Quality check", sequence: 50, is_exception: false, legacy_status: "in_production" },
  { key: "ready", display_name: "Ready", sequence: 60, is_exception: false, legacy_status: "ready" },
  { key: "dispatched", display_name: "Collected / dispatched", sequence: 70, is_exception: false, legacy_status: "shipped" },
  { key: "complete", display_name: "Complete", sequence: 80, is_exception: false, legacy_status: "delivered" },
];

const QUICK_SOLUTION_ONLY_PIPELINE_STAGE_KEYS = new Set([
  "preflight",
  "ready",
  "dispatched",
]);

// The database is intentionally a superset: shared canonical stages
// remain available for FK integrity, while each workspace receives
// only the pipeline vocabulary that belongs to it.
export function getWorkspacePipelineStages(workspaceSlug, databaseStages = []) {
  if (workspaceSlug === "quick-solution") {
    return QUICK_SOLUTION_PIPELINE_STAGES;
  }

  const safeStages = Array.isArray(databaseStages) ? databaseStages : [];

  return safeStages.filter(
    (stage) =>
      !QUICK_SOLUTION_ONLY_PIPELINE_STAGE_KEYS.has(stage?.key)
  );
}

export function isQuickSolutionOrder(order) {
  return order?.source === "quick_solution";
}

export function getQuickSolutionProductKeys(order) {
  if (!Array.isArray(order?.products)) return [];
  return [...new Set(
    order.products
      .map((line) => line?.quick_solution?.product_key)
      .filter(Boolean)
  )];
}

export function mergeQuickSolutionProfiles(profiles = []) {
  const clean = profiles.filter((profile) => profile && typeof profile === "object");
  const methods = new Map();
  const stages = new Map();
  const quickValues = [];

  for (const profile of clean) {
    for (const item of profile.methods || []) {
      if (item?.value && !methods.has(item.value)) methods.set(item.value, item);
    }
    for (const item of profile.detailStages || []) {
      if (item?.value && !stages.has(item.value)) stages.set(item.value, item);
    }
    for (const value of profile.quickStages || []) {
      if (value && !quickValues.includes(value)) quickValues.push(value);
    }
  }

  return {
    profile: clean.length === 1 ? clean[0]?.profile : clean.length > 1 ? "mixed_services" : null,
    displayName: clean.length === 1 ? clean[0]?.displayName : clean.length > 1 ? "Mixed services" : null,
    methods: [...methods.values()],
    detailStages: [...stages.values()],
    quickStages: quickValues,
  };
}

export function pipelineStageForDetail(profile, detailStage) {
  if (!detailStage) return null;
  return profile?.detailStages?.find((item) => item.value === detailStage)?.pipelineStage || null;
}

export function quickSolutionStatusLabel(order, status) {
  if (!isQuickSolutionOrder(order)) return null;

  const delivery = ["courier", "delivery"].includes(order?.fulfillment_type);
  const labels = delivery
    ? {
        confirmed: "Received",
        in_production: "Preparing",
        ready: "Ready for dispatch",
        shipped: "On the way",
        delivered: "Delivered",
        cancelled: "Cancelled",
      }
    : {
        confirmed: "Received",
        in_production: "Preparing",
        ready: "Ready to collect",
        shipped: "Collected",
        delivered: "Complete",
        cancelled: "Cancelled",
      };

  return labels[status] || null;
}
