import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabaseClient";
import { FileText, Package, Settings2 } from "lucide-react";

const OMIT_CONFIG_KEYS = new Set(["clientEstimate"]);

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

export default function QuickSolutionServiceItems({ order }) {
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
        const configEntries = Object.entries(item.configuration || {})
          .filter(([key, value]) => !OMIT_CONFIG_KEYS.has(key) && value !== null && value !== undefined && value !== "");
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
