// Order Operational Readiness, Phase B2 - pure derivation of the "Ready
// automatically" strip shown at the top of ProductionReadinessCard. Every
// fact here reads an EXISTING authority's own output
// (get_order_production_readiness's order/approvals block, the order-line
// production readiness RPC, admin_get_client_product_artwork_readiness) -
// this file never recomputes payment, approval, line, or artwork readiness
// itself. No React/Supabase imports, node --test-able in isolation (same
// convention as clientProductReadiness.js / lineConfiguration.js).

// The client products this order's OWN composition represents - never
// "every product the client owns". Mirrors the server-side derivation
// get_order_production_readiness now uses (20261011140000) exactly, so
// the two never disagree about which products are in scope.
export function getRepresentedClientProductIds(order) {
  const products = Array.isArray(order?.products) ? order.products : [];
  const ids = [];
  const seen = new Set();
  for (const line of products) {
    const role = line?.line_role ? line.line_role : "product";
    if (role !== "product") continue;
    const id = line?.client_product_id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

// Reads the balance_due the readiness RPC already computes live from
// public.transactions - never a second balance calculation.
export function derivePaymentFact(readinessOrder) {
  const balanceDue = Number(readinessOrder?.balance_due ?? 0);
  if (!(balanceDue > 0)) return { satisfied: true, detail: null };
  return {
    satisfied: false,
    detail: `R${balanceDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} outstanding`,
  };
}

// Every represented product must have ITS OWN approved
// client_product_concept row - one approval never covers another
// product, and a pending/rejected row never counts. Mirrors the
// all-represented-products rule get_order_production_readiness enforces
// server-side (20261011140000) - this never re-derives "is this approval
// valid", it only checks whether the already-fixed approvals list covers
// every represented product.
export function deriveClientApprovalFact({ representedClientProductIds, approvals }) {
  const ids = Array.isArray(representedClientProductIds) ? representedClientProductIds : [];
  if (ids.length === 0) return { satisfied: true, detail: null, missingProductIds: [] };

  const approvedIds = new Set(
    (Array.isArray(approvals) ? approvals : [])
      .filter(
        (a) =>
          a?.related_table === "client_products" &&
          a?.approval_type === "client_product_concept" &&
          a?.status === "approved",
      )
      .map((a) => a.related_id),
  );

  const missingProductIds = ids.filter((id) => !approvedIds.has(id));
  return {
    satisfied: missingProductIds.length === 0,
    detail:
      missingProductIds.length > 0
        ? `${missingProductIds.length} product${missingProductIds.length === 1 ? "" : "s"} awaiting client approval`
        : null,
    missingProductIds,
  };
}

// Reads get_order_line_production_readiness's own order_readiness
// aggregate (ready / ready_with_warnings / blocked) - never recomputes
// per-line feasibility in React. null when the query hasn't resolved yet
// (caller renders a neutral/loading state, not a false negative).
export function deriveLineConfigurationFact(lineProductionReadiness) {
  const orderReadiness = lineProductionReadiness?.order_readiness;
  if (!orderReadiness) return { satisfied: null, detail: null };

  if (orderReadiness === "blocked") {
    const lines = Array.isArray(lineProductionReadiness.lines) ? lineProductionReadiness.lines : [];
    const firstReason = lines
      .filter((line) => line?.status === "blocked")
      .flatMap((line) => (Array.isArray(line.blocking_reasons) ? line.blocking_reasons : []))
      .map((reason) => reason?.message)
      .find(Boolean);
    return { satisfied: false, detail: firstReason || "One or more production lines are blocked" };
  }

  if (orderReadiness === "ready_with_warnings") {
    return { satisfied: true, detail: "Ready, with warnings" };
  }

  return { satisfied: true, detail: null };
}

// entries: [{ clientProductId, readiness }], one per represented product,
// readiness being admin_get_client_product_artwork_readiness's own
// payload. Reads readiness.ready directly - the authority's own boolean -
// never the stricter deriveReadinessState() classification used elsewhere
// for the admin requirements-confirmation UI (that one treats
// legacy_fallback as "unconfirmed" even when ready===true, which is the
// wrong question here: this strip asks only "is the production file
// confirmed", not "has an admin explicitly locked the placement list").
export function deriveProductionFilesFact(artworkReadinessEntries) {
  const entries = Array.isArray(artworkReadinessEntries) ? artworkReadinessEntries : [];
  if (entries.length === 0) return { satisfied: true, detail: null, missingProductIds: [] };

  const notReady = entries.filter((entry) => entry?.readiness?.ready !== true);
  if (notReady.length === 0) return { satisfied: true, detail: null, missingProductIds: [] };

  const firstReason = notReady
    .flatMap((entry) => (Array.isArray(entry?.readiness?.blocking_reasons) ? entry.readiness.blocking_reasons : []))
    .find(Boolean);

  return {
    satisfied: false,
    detail: firstReason || "Production files not yet confirmed",
    missingProductIds: notReady.map((entry) => entry.clientProductId).filter(Boolean),
  };
}

export function buildAutomaticReadinessItems({
  readinessOrder,
  approvals,
  representedClientProductIds,
  lineProductionReadiness,
  artworkReadinessEntries,
}) {
  const payment = derivePaymentFact(readinessOrder);
  const clientApproval = deriveClientApprovalFact({ representedClientProductIds, approvals });
  const lineConfiguration = deriveLineConfigurationFact(lineProductionReadiness);
  const productionFiles = deriveProductionFilesFact(artworkReadinessEntries);

  return [
    { key: "payment", label: "Payment", ...payment },
    { key: "client_approval", label: "Client approval", ...clientApproval },
    { key: "line_configuration", label: "Line configuration", ...lineConfiguration },
    { key: "production_files", label: "Production files", ...productionFiles },
  ];
}
