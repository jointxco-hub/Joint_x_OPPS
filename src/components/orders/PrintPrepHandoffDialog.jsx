import { useQuery } from "@tanstack/react-query";
import { Clipboard, Download, Factory, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getPrintPrepHandoff, printPrepHandoffFileName } from "@/api/printPrepHandoff";
import { Button } from "@/components/ui/button";
import ArtworkDownloadButton from "@/components/orders/ArtworkDownloadButton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

function downloadJson(payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = printPrepHandoffFileName(payload);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function PrintPrepHandoffDialog({ open, onClose, orderId, lineId, snapshotId }) {
  const { data: result, isLoading } = useQuery({
    queryKey: ["printPrepHandoff", orderId, lineId, snapshotId],
    queryFn: () => getPrintPrepHandoff({ orderId, lineId, snapshotId }),
    enabled: Boolean(open && orderId && lineId && snapshotId),
    staleTime: 0,
    gcTime: 60_000,
  });

  const payload = result?.data || null;
  const error = result?.error || "";

  const copyPayload = async () => {
    if (!payload) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      toast.success("Print Prep handoff copied");
    } catch {
      toast.error("Could not copy the handoff. Download the JSON instead.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose?.(); }}>
      <DialogContent className="max-w-lg rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Factory className="h-4 w-4" />
            Print Prep handoff
          </DialogTitle>
          <DialogDescription>
            Read-only OPPS production payload from this line&apos;s frozen production snapshot.
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-secondary/30 px-3 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Preparing production handoff…
          </div>
        )}

        {!isLoading && error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {!isLoading && payload && (
          <div className="space-y-3">
            <div className="rounded-2xl border border-border bg-secondary/30 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {payload.production_component?.label || payload.order?.line_name || "Production item"}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {[payload.production_component?.production_method, payload.production_component?.placement].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                  {payload.readiness?.status || "ready"}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-xl bg-background px-2 py-2">
                  <p className="text-muted-foreground">Pieces</p>
                  <p className="font-semibold text-foreground">{payload.production?.piece_quantity ?? "—"}</p>
                </div>
                <div className="rounded-xl bg-background px-2 py-2">
                  <p className="text-muted-foreground">Artwork</p>
                  <p className="font-semibold text-foreground">{payload.artwork?.assets?.length || 0} linked</p>
                </div>
              </div>
              {payload.production?.target_width_mm == null && (
                <p className="mt-2 text-[11px] text-amber-700">
                  Production width is not frozen in OPPS yet. Print Prep will still require the operator to choose/confirm size.
                </p>
              )}
            </div>

            <div className="space-y-2">
              {(payload.artwork?.assets || []).map((asset) => (
                <div key={asset.revision_id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3">
                  <span className="min-w-0 break-all text-xs">{asset.display_name || "Artwork"}</span>
                  <ArtworkDownloadButton filePath={asset.file_path} fileName={asset.display_name || "Artwork"}
                    className="rounded-lg border border-border px-3 py-2 text-xs font-semibold disabled:opacity-50" />
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 rounded-xl" onClick={copyPayload}>
                <Clipboard className="mr-2 h-4 w-4" />
                Copy JSON
              </Button>
              <Button className="flex-1 rounded-xl" onClick={() => downloadJson(payload)}>
                <Download className="mr-2 h-4 w-4" />
                Download handoff
              </Button>
            </div>

            <p className="text-[11px] text-muted-foreground">
              Import the handoff into Print Prep, then download and select the matching artwork in Corel. Creating this handoff does not change the order or production record.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
