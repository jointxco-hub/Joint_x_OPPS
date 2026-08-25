import { useQuery } from "@tanstack/react-query";
import { dataClient } from "@/api/dataClient";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";

// Phase 2B Step 3 - read-only per-treatment/per-placement artwork state.
// Queries client_product_artwork scoped to THIS treatment (treatment_id =
// treatment.id) - never the treatment_id IS NULL family rows, which are a
// separate namespace entirely (see _compute_artwork_readiness, which this
// component deliberately does not call - no treatment readiness concept
// exists yet, this is state display only). Actual upload/revision/
// approval stays owned by X LAB Admin's AdminClientProductDetail; this is
// a deep link to it, not a second upload flow.
export default function TreatmentArtworkState({ treatmentId, clientProductId }) {
  const { data: artwork = [] } = useQuery({
    queryKey: ["treatmentArtworkState", clientProductId, treatmentId],
    queryFn: () => dataClient.entities.ClientProductArtwork.filter({ client_product_id: clientProductId, treatment_id: treatmentId }, "placement", 100),
    enabled: Boolean(treatmentId && clientProductId),
  });

  const byPlacement = artwork.reduce((acc, a) => {
    if (!acc[a.placement]) acc[a.placement] = [];
    acc[a.placement].push(a);
    return acc;
  }, {});

  const placements = Object.keys(byPlacement);

  const badgeClass = (status) => ({
    approved: "bg-emerald-50 text-emerald-700",
    pending: "bg-amber-50 text-amber-700",
    rejected: "bg-red-50 text-red-700",
    superseded: "bg-slate-100 text-slate-500",
  }[status] || "bg-slate-100 text-slate-500");

  return (
    <div className="space-y-1.5">
      {placements.length === 0 ? (
        <p className="text-xs text-slate-400">No artwork</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {placements.map((placement) => {
            // Current revision for this placement, if any - falls back to
            // the most recent row when nothing is marked current yet.
            const current = byPlacement[placement].find((a) => a.is_current) || byPlacement[placement][0];
            return (
              <span key={placement} className={`text-[11px] rounded-full px-2 py-0.5 font-medium ${badgeClass(current.status)}`}>
                {placement}: {current.status}
              </span>
            );
          })}
        </div>
      )}
      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto p-0 text-xs"
        onClick={() => window.open(`https://xlab.jointx.co.za/admin/client-products/${clientProductId}`, "_blank", "noopener,noreferrer")}
      >
        <ExternalLink className="w-3 h-3 mr-1" />
        Open artwork management
      </Button>
    </div>
  );
}
