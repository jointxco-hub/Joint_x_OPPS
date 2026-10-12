// Order Operational Readiness, Phase B2 - pure derivation of the "Ready
// automatically" strip shown at the top of ProductionReadinessCard. Every
// fact here reads an EXISTING authority's own output
// (get_order_production_readiness's order/approvals block, the order-line
// production readiness RPC, admin_get_client_product_artwork_readiness,
// and the order's own order_line_component_snapshots/client_product_artwork
// rows) - this file never recomputes payment, approval, or line-feasibility
// logic itself. No React/Supabase imports, node --test-able in isolation
// (same convention as clientProductReadiness.js / lineConfiguration.js).

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
// public.transactions - never a second balance calculation. A partially
// paid order (balance_due > 0) is never treated as satisfied, same as a
// fully unpaid one - this is a threshold check, not a percentage.
export function derivePaymentFact(readinessOrder) {
  const balanceDue = Number(readinessOrder?.balance_due ?? 0);
  if (!(balanceDue > 0)) return { satisfied: true, detail: null, unavailable: false };
  return {
    satisfied: false,
    detail: `R${balanceDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} outstanding`,
    unavailable: false,
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
  if (ids.length === 0) return { satisfied: true, detail: null, missingProductIds: [], unavailable: false };

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
    unavailable: false,
  };
}

// Reads get_order_line_production_readiness's own order_readiness
// aggregate (ready / ready_with_warnings / blocked) - never recomputes
// per-line feasibility in React. null when the query hasn't resolved yet
// (caller renders a neutral/loading state, not a false negative). Adds a
// "N/M lines ready" count straight off the RPC's own per-line `status`
// field (never a derived classification) when the satisfied state has
// nothing more specific to say.
export function deriveLineConfigurationFact(lineProductionReadiness) {
  const orderReadiness = lineProductionReadiness?.order_readiness;
  if (!orderReadiness) return { satisfied: null, detail: null, unavailable: false };

  const lines = Array.isArray(lineProductionReadiness.lines) ? lineProductionReadiness.lines : [];
  const readyCount = lines.filter((line) => line?.status === "ready").length;
  const countDetail = lines.length > 0 ? `${readyCount}/${lines.length} line${lines.length === 1 ? "" : "s"} ready` : null;

  if (orderReadiness === "blocked") {
    const firstReason = lines
      .filter((line) => line?.status === "blocked")
      .flatMap((line) => (Array.isArray(line.blocking_reasons) ? line.blocking_reasons : []))
      .map((reason) => reason?.message)
      .find(Boolean);
    return { satisfied: false, detail: firstReason || "One or more production lines are blocked", unavailable: false };
  }

  if (orderReadiness === "ready_with_warnings") {
    return { satisfied: true, detail: countDetail || "Ready, with warnings", unavailable: false };
  }

  return { satisfied: true, detail: countDetail, unavailable: false };
}

// Groups THIS ORDER's own current (is_current=true) line-component
// snapshots PER LINE - every order line is evaluated independently, never
// collapsed into a product-level union. A required placement missing on
// just ONE of several lines for the same product must surface as a real
// gap, not get silently covered by a sibling line's own artwork. A line
// is registered (as a key) the moment ANY snapshot row references it
// (including a placement-less "blank garment" row), so a line that has
// literally no artwork tracked for a required placement still counts as
// present-but-missing, not simply absent from consideration.
//
// Shape: { [clientProductId]: { [lineId]: { [placement]: revisionId[] } } }
export function groupOrderArtworkByLine(snapshots, representedClientProductIds) {
  const represented = new Set(Array.isArray(representedClientProductIds) ? representedClientProductIds : []);
  const byProduct = {};
  for (const row of Array.isArray(snapshots) ? snapshots : []) {
    const productId = row?.client_product_id;
    const lineId = row?.line_id;
    if (!productId || !represented.has(productId) || !lineId) continue;
    byProduct[productId] = byProduct[productId] || {};
    byProduct[productId][lineId] = byProduct[productId][lineId] || {};

    const placement = row?.placement;
    if (!placement) continue; // blank-garment row - still registers the line above, no placement requirement of its own
    const revisionIds = Array.isArray(row?.artwork_revision_ids) ? row.artwork_revision_ids.filter(Boolean) : [];
    if (revisionIds.length === 0) continue;
    byProduct[productId][lineId][placement] = byProduct[productId][lineId][placement] || new Set();
    // A Set within one (line, placement) pair de-duplicates identical
    // revision ids - it never counts the same frozen file twice as if it
    // were two different required artworks.
    for (const id of revisionIds) byProduct[productId][lineId][placement].add(id);
  }
  const out = {};
  for (const [productId, lines] of Object.entries(byProduct)) {
    out[productId] = {};
    for (const [lineId, placements] of Object.entries(lines)) {
      out[productId][lineId] = {};
      for (const [placement, ids] of Object.entries(placements)) {
        out[productId][lineId][placement] = Array.from(ids);
      }
    }
  }
  return out;
}

// Every distinct artwork_revision_id referenced anywhere in
// orderArtworkByLine. Only used for logging/tests - the actual data fetch
// (ProductionReadinessCard.jsx) now reads ALL of a product's artwork rows
// in one batched query per product rather than one query per id (existing
// batch-read capability: ClientProductArtwork.filter({ client_product_id })
// already returns every placement/revision for that product).
export function listDistinctOrderArtworkRevisionIds(orderArtworkByLine) {
  const ids = new Set();
  for (const lines of Object.values(orderArtworkByLine || {})) {
    for (const placements of Object.values(lines || {})) {
      for (const revisionIds of Object.values(placements || {})) {
        for (const id of revisionIds) ids.add(id);
      }
    }
  }
  return Array.from(ids).sort();
}

// Order-aware, per-line production-files fact. THIS IS NOT the same
// question as "is this client product's CURRENT artwork confirmed" -
// admin_get_client_product_artwork_readiness's own 'ready' boolean
// answers that question (about whichever revision is_current=true today),
// and is deliberately NOT used here for the confirmation verdict. A
// product's current artwork being fully confirmed (e.g. a Pitch Black
// revision approved today) never implies THIS order's own frozen
// revision is confirmed - if this order was built against an earlier,
// now-superseded revision (e.g. a historical Sky Blue row) that was
// never reviewed, its production file is NOT confirmed, regardless of
// what the current family looks like. And the converse also holds: a
// frozen revision that WAS approved before being superseded stays
// confirmed for this order, even though it is no longer "current".
//
// required_placements still comes from the existing
// admin_get_client_product_artwork_readiness authority (what a product
// is SUPPOSED to need) - this never invents that list itself, it only
// decides, per order LINE and per required placement, whether that
// line's own frozen revision(s) carry status==='approved'.
//
// revisionLookup: { [artworkRevisionId]: { status, is_current,
//   clientProductId, placement } | undefined }
//   undefined means "no usable result for this id" (fetch still pending
//   OR the row could not be read/found) - callers should only present a
//   terminal verdict once every relevant fetch has settled; see
//   ProductionReadinessCard.jsx's productionFilesLoading guard, which
//   keeps this whole fact in the existing satisfied:null "loading" state
//   until then. Once settled, a genuinely missing id surfaces here as
//   unavailable:true - "Not verified", never a silent green check. A
//   resolved entry whose own clientProductId/placement does not match
//   what the order's snapshot claims is treated the same way - an
//   ambiguous/mismatched reference is never trusted as confirmation.
export function deriveProductionFilesFact({
  representedClientProductIds,
  artworkReadinessEntries,
  orderArtworkByLine,
  revisionLookup,
}) {
  const ids = Array.isArray(representedClientProductIds) ? representedClientProductIds : [];
  if (ids.length === 0) return { satisfied: true, detail: null, missingProductIds: [], unavailable: false };

  const entries = Array.isArray(artworkReadinessEntries) ? artworkReadinessEntries : [];
  const lookup = revisionLookup || {};
  const byProduct = orderArtworkByLine || {};

  let readyProductCount = 0;
  let anyUnavailable = false;
  let firstDetail = null;
  const missingProductIds = [];

  for (const productId of ids) {
    const entry = entries.find((e) => e?.clientProductId === productId);
    // A product with no resolved readiness entry at all (the required-
    // placements authority itself failed to load, not merely "nothing
    // required") must never be silently counted as satisfied - that would
    // be exactly the misleading green check this fact exists to avoid.
    if (!entry || entry.readiness == null) {
      anyUnavailable = true;
      continue;
    }
    const requiredPlacements = Array.isArray(entry.readiness.required_placements)
      ? entry.readiness.required_placements
      : [];

    if (requiredPlacements.length === 0) {
      readyProductCount += 1;
      continue; // nothing required for this product on this order
    }

    const lines = byProduct[productId] || {};
    const lineIds = Object.keys(lines);

    if (lineIds.length === 0) {
      // None of this order's lines for this product have ANY tracked
      // component snapshot at all - cannot verify any required placement.
      missingProductIds.push(productId);
      if (!firstDetail) firstDetail = `${requiredPlacements[0]}: not linked to this order's lines`;
      continue;
    }

    let productReady = true;
    let productUnavailable = false;

    for (const lineId of lineIds) {
      const placements = lines[lineId] || {};
      for (const placement of requiredPlacements) {
        const revisionIds = placements[placement] || [];
        if (revisionIds.length === 0) {
          productReady = false;
          if (!firstDetail) firstDetail = `${placement}: not linked to this order's lines`;
          continue;
        }
        for (const revisionId of revisionIds) {
          const revision = lookup[revisionId];
          if (revision === undefined) {
            productUnavailable = true;
            continue;
          }
          // Defence-in-depth: never trust a resolved row's status for a
          // product/placement it does not actually belong to. Not an
          // expected live case, but a frozen reference that turned out
          // to point somewhere else must be rejected, not believed.
          if (revision.clientProductId !== productId || revision.placement !== placement) {
            productUnavailable = true;
            continue;
          }
          if (revision.status !== "approved") {
            productReady = false;
            if (!firstDetail) firstDetail = `${placement}: this order's production file is not yet confirmed`;
          }
        }
      }
    }

    // A definite "not ready" (a real, already-identified gap) always
    // wins over "partially unavailable" for the SAME product - a known
    // blocker is more actionable than an unresolved unknown.
    if (!productReady) {
      missingProductIds.push(productId);
    } else if (productUnavailable) {
      anyUnavailable = true;
    } else {
      readyProductCount += 1;
    }
  }

  if (missingProductIds.length > 0) {
    return {
      satisfied: false,
      detail: firstDetail || "Production files not yet confirmed",
      missingProductIds,
      unavailable: false,
    };
  }
  if (anyUnavailable) {
    return {
      satisfied: null,
      detail: "Could not verify this order's production files",
      missingProductIds: [],
      unavailable: true,
    };
  }
  return {
    satisfied: true,
    detail: `${readyProductCount}/${ids.length} product${ids.length === 1 ? "" : "s"} confirmed`,
    missingProductIds: [],
    unavailable: false,
  };
}

export function buildAutomaticReadinessItems({
  readinessOrder,
  approvals,
  representedClientProductIds,
  lineProductionReadiness,
  artworkReadinessEntries,
  orderArtworkByLine,
  revisionLookup,
}) {
  const payment = derivePaymentFact(readinessOrder);
  const clientApproval = deriveClientApprovalFact({ representedClientProductIds, approvals });
  const lineConfiguration = deriveLineConfigurationFact(lineProductionReadiness);
  const productionFiles = deriveProductionFilesFact({
    representedClientProductIds,
    artworkReadinessEntries,
    orderArtworkByLine,
    revisionLookup,
  });

  return [
    { key: "payment", label: "Payment", ...payment },
    { key: "client_approval", label: "Client approval", ...clientApproval },
    { key: "line_configuration", label: "Line configuration", ...lineConfiguration },
    { key: "production_files", label: "Production files", ...productionFiles },
  ];
}
