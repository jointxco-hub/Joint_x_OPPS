import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { isValidReadinessOrderId } from "@/api/productionReadiness";
import { getClientProductArtworkReadiness } from "@/api/clientProducts";
import { dataClient } from "@/api/dataClient";
import {
  buildAutomaticReadinessItems,
  getRepresentedClientProductIds,
  groupOrderArtworkByLine,
} from "@/lib/orderAutomaticReadiness";

// The "Ready automatically" fact set (Payment / Client approval / Line
// configuration / Production files) - extracted out of
// ProductionReadinessCard.jsx (Order Drawer Operational Summary, Phase C1)
// so the Details tab's compact summary and the full Readiness tab can
// both show it WITHOUT duplicating any query. Every query here is keyed
// only by order.id / clientProductId - never by which component called
// this hook - so React Query's own cache dedupes identical in-flight
// requests and serves cached data to whichever caller mounts second,
// within staleTime. This is the same net request set as before the
// extraction; nothing here is a new authority or a new calculation, only
// a relocation so two call sites can share it.
export function useOrderAutomaticReadiness({ order, readinessQuery, lineProductionReadiness }) {
  const canLoadReadiness = isValidReadinessOrderId(order?.id);
  const { data } = readinessQuery || {};

  const representedClientProductIds = useMemo(() => getRepresentedClientProductIds(order), [order]);

  // admin_get_client_product_artwork_readiness - the existing authority
  // for a product's REQUIRED placements, called once per represented
  // product. Its own 'ready' boolean describes the CURRENT (is_current)
  // revision only, which is NOT order-specific and is deliberately not
  // used for the confirmation verdict below - only required_placements
  // is reused from it.
  const artworkReadinessQueries = useQueries({
    queries: representedClientProductIds.map((clientProductId) => ({
      queryKey: ["clientProductArtworkReadiness", clientProductId],
      queryFn: async () => {
        const result = await getClientProductArtworkReadiness({ clientProductId });
        if (result.error) throw new Error(result.error);
        return result.data;
      },
      enabled: canLoadReadiness && Boolean(data) && Boolean(clientProductId),
      staleTime: 30_000,
    })),
  });
  const artworkReadinessLoading = artworkReadinessQueries.some((q) => q.isLoading);
  const artworkReadinessEntries = representedClientProductIds.map((clientProductId, index) => ({
    clientProductId,
    readiness: artworkReadinessQueries[index]?.data,
  }));

  // This order's OWN frozen artwork_revision_ids per represented product/
  // line/placement - the same OrderLineComponentSnapshot entity/read path
  // ProductsEditor.jsx already uses for this order, just is_current-
  // filtered here. A client product's CURRENT artwork state can never
  // answer "is THIS order's own frozen file confirmed" - an order built
  // against an older, since-superseded revision needs that specific
  // revision's own status, not the product's current one. Independent of,
  // and runs in parallel with, the two query groups above - it does not
  // wait on either of them, and nothing below waits on IT either (see the
  // per-product artwork query next, which is keyed only on
  // representedClientProductIds, not on this query's result).
  const snapshotsQuery = useQuery({
    queryKey: ["orderLineComponentSnapshots", "automaticReadiness", order?.id],
    queryFn: () =>
      dataClient.entities.OrderLineComponentSnapshot.filter(
        { order_id: order.id, is_current: true },
        "sort_order",
        300,
      ),
    enabled: canLoadReadiness && Boolean(data) && Boolean(order?.id) && representedClientProductIds.length > 0,
    staleTime: 30_000,
  });
  const snapshotsLoading = snapshotsQuery.isLoading;
  const snapshots = snapshotsQuery.data || [];
  const orderArtworkByLine = useMemo(
    () => groupOrderArtworkByLine(snapshots, representedClientProductIds),
    [snapshots, representedClientProductIds],
  );

  // ALL of a product's own artwork rows (every placement, every
  // historical and current revision) in ONE query per represented
  // product - not one query per distinct revision id. This is the same
  // ClientProductArtwork entity used above, just filtered by
  // client_product_id instead of id (existing batch-read capability: a
  // product's full artwork history is already a single "WHERE
  // client_product_id = X" read, no new RPC). Keyed only on
  // representedClientProductIds, so it starts immediately alongside
  // snapshotsQuery/artworkReadinessQueries - no waterfall.
  const productArtworkQueries = useQueries({
    queries: representedClientProductIds.map((clientProductId) => ({
      queryKey: ["clientProductArtworkRows", clientProductId],
      queryFn: () => dataClient.entities.ClientProductArtwork.filter({ client_product_id: clientProductId }, undefined, 200),
      enabled: canLoadReadiness && Boolean(data) && Boolean(clientProductId),
      staleTime: 30_000,
    })),
  });
  const productArtworkLoading = productArtworkQueries.some((q) => q.isLoading);
  const revisionLookup = useMemo(() => {
    const out = {};
    for (const query of productArtworkQueries) {
      for (const row of Array.isArray(query.data) ? query.data : []) {
        if (!row?.id) continue;
        out[row.id] = {
          status: row.status,
          is_current: row.is_current,
          clientProductId: row.client_product_id,
          placement: row.placement,
        };
      }
    }
    return out;
  }, [productArtworkQueries]);

  const productionFilesLoading = artworkReadinessLoading || snapshotsLoading || productArtworkLoading;

  const items = data
    ? buildAutomaticReadinessItems({
        readinessOrder: data.order,
        approvals: data.approvals,
        representedClientProductIds,
        lineProductionReadiness,
        artworkReadinessEntries: productionFilesLoading ? null : artworkReadinessEntries,
        orderArtworkByLine: productionFilesLoading ? null : orderArtworkByLine,
        revisionLookup: productionFilesLoading ? null : revisionLookup,
      }).map((item) =>
        productionFilesLoading && item.key === "production_files"
          ? { ...item, satisfied: null, detail: null, unavailable: false }
          : item,
      )
    : [];

  return { items, isLoading: !data };
}
