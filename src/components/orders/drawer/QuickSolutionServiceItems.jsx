import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabaseClient";
import { ExternalLink, FileText, Package, Printer, Settings2 } from "lucide-react";
import { getSignedFileUrl, toPrivateUploadRef } from "@/lib/privateFiles";

const OMIT_CONFIG_KEYS = new Set([
  "clientEstimate",
  "documentInstructions",
  "documentPlanValid",
  "serverCalculatedPages",
]);

function configLabel(key) {
  const special = {
    printMode: "Print mode",
    fileName: "File",
    sides: "Sides",
    copies: "Copies",
    pages: "Pages",
    finish: "Finish",
    widthM: "Width",
    heightM: "Height",
    width: "Width",
    height: "Height",
    size: "Size",
    colour: "Colour",
    color: "Colour",
  };
  if (special[key]) return special[key];
  return String(key)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function configValue(key, value) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map((item) => configValue(key, item)).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  const raw = String(value);
  if (key === "widthM" || key === "heightM") return `${raw} m`;
  return raw.replace(/-/g, " ");
}

function money(value) {
  const n = Number(value || 0);
  return Number.isFinite(n)
    ? `R${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
    : "—";
}

function humanizePrintMode(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "Print mode not set";
  if (["bw", "b&w", "black-white", "black_and_white", "black & white", "black and white"].includes(raw)) {
    return "Black & white";
  }
  if (["colour", "color", "full-colour", "full-color"].includes(raw)) {
    return "Colour";
  }
  return String(value).replace(/[-_]/g, " ");
}

function humanizeSides(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "Sides not set";
  if (["single", "single-sided", "simplex", "one-sided"].includes(raw)) {
    return "Single-sided";
  }
  if (["double", "double-sided", "duplex", "two-sided"].includes(raw)) {
    return "Double-sided";
  }
  return String(value).replace(/[-_]/g, " ");
}

function documentInstructionText(instruction) {
  if (!instruction || typeof instruction !== "object") return "Print instructions not available";

  const selection = String(instruction.selection || "all").toLowerCase();
  if (selection === "specific") {
    const pages = String(instruction.pagesSpec || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .join(", ");
    return pages ? `Print pages ${pages}` : "Specific pages selected";
  }

  const sourcePages = Number(instruction.sourcePages || 0);
  if (Number.isFinite(sourcePages) && sourcePages > 0) {
    return `Print all ${sourcePages.toLocaleString()} ${sourcePages === 1 ? "page" : "pages"}`;
  }

  return "Print entire document";
}

function fileStorageReference(file) {
  if (!file?.bucket || !file?.path) return "";
  return toPrivateUploadRef(file.bucket, file.path);
}

async function openProductionFile(file) {
  const ref = fileStorageReference(file);
  if (!ref) return;
  const url = await getSignedFileUrl(ref, { expiresIn: 600 });
  window.open(url, "_blank", "noopener,noreferrer");
}

async function printProductionFile(file) {
  const ref = fileStorageReference(file);
  if (!ref) return;
  const url = await getSignedFileUrl(ref, { expiresIn: 600 });
  const mime = String(file?.mimeType || "").toLowerCase();

  if (mime.startsWith("image/")) {
    const popup = window.open("", "_blank");
    if (!popup) return;
    // Keep a writable handle long enough to render the print document, then
    // sever the opener reference so the new tab cannot control OPPS.
    try { popup.opener = null; } catch {}
    popup.document.write(`<!doctype html>
<html>
<head>
  <title>${String(file?.name || "Print file").replace(/</g, "&lt;")}</title>
  <style>
    html,body{margin:0;padding:0;background:#fff}
    img{display:block;max-width:100%;height:auto;margin:0 auto}
    @media print{img{max-width:100%;page-break-inside:avoid}}
  </style>
</head>
<body>
  <img src="${url.replace(/"/g, "&quot;")}" onload="window.focus();window.print();" />
</body>
</html>`);
    popup.document.close();
    return;
  }

  // PDFs and other browser-printable documents open in the native viewer.
  // We intentionally do not build a custom print engine here.
  window.open(url, "_blank", "noopener,noreferrer");
}

function DocumentProductionSummary({ item, onOpenFiles }) {
  const config = item.configuration || {};
  const instructions = Array.isArray(config.documentInstructions)
    ? config.documentInstructions
    : [];
  const files = Array.isArray(item.fileRefs) ? item.fileRefs : [];
  const copies = Math.max(Number(config.copies || 1), 1);
  const pages = Number(
    config.serverCalculatedPages ??
    config.pages ??
    0
  );

  const rows = instructions.length > 0
    ? instructions
    : files.map((file) => ({
        name: file?.name || "Attached document",
        selection: "all",
        sourcePages: null,
      }));

  return (
    <div className="mt-4 rounded-2xl border border-primary/15 bg-background/80 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Production summary
          </p>
          <p className="mt-1 text-sm font-semibold text-foreground">
            {copies.toLocaleString()} {copies === 1 ? "copy" : "copies"}
            {pages > 0 ? ` · ${pages.toLocaleString()} selected ${pages === 1 ? "page" : "pages"}` : ""}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <span className="rounded-full border border-border bg-secondary/40 px-2.5 py-1 text-xs font-medium text-foreground">
            {humanizePrintMode(config.printMode)}
          </span>
          <span className="rounded-full border border-border bg-secondary/40 px-2.5 py-1 text-xs font-medium text-foreground">
            {humanizeSides(config.sides)}
          </span>
          {config.finish && String(config.finish).toLowerCase() !== "none" && (
            <span className="rounded-full border border-border bg-secondary/40 px-2.5 py-1 text-xs font-medium text-foreground">
              {configValue("finish", config.finish)}
            </span>
          )}
        </div>
      </div>

      {rows.length > 0 && (
        <div className="mt-4 space-y-2">
          {rows.map((instruction, index) => {
            const file = files[index];
            const fileName =
              instruction?.name ||
              file?.name ||
              `Document ${index + 1}`;

            return (
              <div
                key={instruction?.key || file?.id || file?.path || `${fileName}-${index}`}
                className="rounded-xl border border-border/70 bg-secondary/20 p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-start gap-2">
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => onOpenFiles?.(file)}
                        className="break-words text-left text-sm font-semibold text-foreground hover:text-primary hover:underline"
                      >
                        {fileName}
                      </button>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {documentInstructionText(instruction)}
                      </p>
                    </div>
                  </div>

                  {file && (
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => openProductionFile(file)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:border-primary/40"
                        title="Open this file"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Open
                      </button>
                      {["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(String(file?.mimeType || "").toLowerCase()) && (
                        <button
                          type="button"
                          onClick={() => printProductionFile(file)}
                          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:border-primary/40"
                          title="Print this file"
                        >
                          <Printer className="h-3 w-3" />
                          Print
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {instructions.length === 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Legacy document order — showing the saved order-level print settings.
        </p>
      )}
    </div>
  );
}


export default function QuickSolutionServiceItems({ order, onOpenFiles }) {
  const query = useQuery({
    queryKey: ["quickSolutionOppsItems", order.id, order.updated_at],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_quick_solution_opps_items", {
        p_opps_order_id: order.id,
      });
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    },
    enabled: Boolean(order?.id),
    staleTime: 30_000,
  });

  if (query.isLoading) {
    return (
      <div className="rounded-2xl border border-border bg-secondary/20 p-4">
        <div className="h-4 w-36 animate-pulse rounded bg-secondary" />
        <div className="mt-3 h-20 animate-pulse rounded-xl bg-background/70" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Could not load the Quick Solution service configuration.
        <span className="mt-1 block text-xs opacity-80">{query.error?.message || "Unknown error"}</span>
      </div>
    );
  }

  const rpcItems = query.data || [];

  const orderSnapshotItems =
    Array.isArray(order?.products)
      ? order.products
          .map((line, index) => {
            const quickSolution =
              line?.quick_solution;

            if (!quickSolution?.product_key) {
              return null;
            }

            return {
              id: `order-snapshot-${index}`,
              productId:
                quickSolution.commerce_product_id ||
                null,
              productKey:
                quickSolution.product_key,
              productName:
                line.name ||
                quickSolution
                  .operations_definition
                  ?.displayName ||
                "Quick Solution service",
              quantity:
                Number(line.quantity || 1),
              configuration:
                quickSolution.configuration || {},
              pricingSnapshot:
                quickSolution.pricing_snapshot || {},
              fileRefs:
                quickSolution.file_refs || [],
              lineTotal:
                Number(line.price || 0) *
                Number(line.quantity || 1),
              operations:
                quickSolution
                  .operations_definition || {},
            };
          })
          .filter(Boolean)
      : [];

  const items =
    rpcItems.length > 0
      ? rpcItems
      : orderSnapshotItems;

  if (!items.length) {
    return (
      <div className="rounded-2xl border border-border bg-secondary/20 p-4 text-sm text-muted-foreground">
        No Quick Solution service items were found for this order.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Service configuration</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Captured from Quick Solution checkout. Pricing/configuration stays tied to the customer order; operational progress is managed above.
        </p>
      </div>

      {items.map((item) => {
        const isDocumentPrint = item.productKey === "a4-print";
        const configEntries = Object.entries(item.configuration || {})
          .filter(([key, value]) => {
            if (OMIT_CONFIG_KEYS.has(key) || value === null || value === undefined || value === "") {
              return false;
            }

            if (isDocumentPrint && ["pages", "copies", "printMode", "sides", "finish"].includes(key)) {
              return false;
            }

            return true;
          });
        const files = Array.isArray(item.fileRefs) ? item.fileRefs : [];
        const workflowName = item.operations?.displayName || item.productName || "Quick Solution service";

        return (
          <div key={item.id} className="rounded-2xl border border-border bg-secondary/20 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-primary" />
                  <p className="font-semibold text-foreground">{item.productName || "Service"}</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Qty {Number(item.quantity || 0).toLocaleString()} · {item.productKey}
                </p>
              </div>
              <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                {money(item.lineTotal)}
              </span>
            </div>

            {isDocumentPrint && (
              <DocumentProductionSummary item={item} onOpenFiles={onOpenFiles} />
            )}

            {configEntries.length > 0 && (
              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {configEntries.map(([key, value]) => (
                  <div key={key} className="rounded-xl bg-background/75 p-3">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{configLabel(key)}</p>
                    <p className="mt-1 break-words text-sm font-medium text-foreground">{configValue(key, value)}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-muted-foreground">
                <Settings2 className="h-3 w-3" />
                {workflowName} workflow
              </span>
              {files.map((file) => (
                <span key={file.id || file.path || file.name} className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-muted-foreground">
                  <FileText className="h-3 w-3 shrink-0" />
                  <span className="truncate">{file.name || "Attached file"}</span>
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
