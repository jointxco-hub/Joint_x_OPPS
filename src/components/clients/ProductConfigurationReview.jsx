import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Info } from "lucide-react";
import { resolveClientProductPrice, getClientProductHistoricalReference } from "@/api/clientProductPriceReview";
import ReconfigurationDraftWorkflow from "@/components/clients/reconfiguration/ReconfigurationDraftWorkflow";
import { getReconciliationStatusMeta, getPriceSourceLabel } from "@/components/clients/reconfiguration/resolverStatusLabels";

// PRODUCT CONFIGURATION REVIEW v1 — read-only staff diagnostic panel.
//
// Everything priced here is read verbatim from
// public.resolve_client_product_price(); this component computes nothing
// of its own. It renders unconditionally of the production canConfigure
// gate (unlike the older ClientProductPriceComposition preview further
// down this tab) so any staff member who can open this product's
// Production tab can see why its price is what it is, not just staff with
// write access.
//
// Nothing in this file writes anywhere: no mutation, no RPC call other
// than the read-only resolver, no table write. The "review classification"
// control below is local component state only - it is never saved, never
// sent to the server, and resets the moment this panel unmounts.

const money = (n) => `R${Number(n || 0).toFixed(2)}`;

const COMMERCIAL_TYPES = new Set(["blank_garment", "print_service", "setup_fee", "addon"]);

const NEXT_ACTION = {
  reconciled: "Pricing checked. Artwork and ordering approval are reviewed separately.",
  diverged: "No action required if this divergence is intentional. Only revisit it if the difference looks accidental.",
  unresolved_components: "Add a sell price to the component(s) listed below before this product can be added to an order at a computed price.",
  no_composition: "Add pricing components (blank, print, setup fee, or add-on), or confirm this product is meant to be priced by agreed price alone.",
};

const REVIEW_OPTIONS = ["Not yet reviewed", "Recurring", "Once-off", "Historical", "Needs review"];

function Collapsible({ title, subtitle = null, children, count = null }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-slate-200">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />}
        <span className="flex-1 text-xs font-medium text-slate-700">{title}</span>
        {count != null && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">{count}</span>}
      </button>
      {open && (
        <div className="border-t border-slate-100 p-2.5">
          {subtitle && <p className="mb-2 text-[11px] text-slate-400">{subtitle}</p>}
          {children}
        </div>
      )}
    </div>
  );
}

function FieldRow({ label, value, help = null }) {
  return (
    <div className="flex items-start justify-between gap-3 text-xs">
      <div>
        <span className="text-slate-500">{label}</span>
        {help && <p className="text-[10px] text-slate-400">{help}</p>}
      </div>
      <span className="flex-shrink-0 font-semibold tabular-nums text-slate-800">{value}</span>
    </div>
  );
}

export default function ProductConfigurationReview({ product, components = [] }) {
  const [reviewClassification, setReviewClassification] = useState(REVIEW_OPTIONS[0]);
  const [reconfigureOpen, setReconfigureOpen] = useState(false);

  const { data: priceRes, isLoading: priceLoading } = useQuery({
    queryKey: ["resolveClientProductPrice", product.id],
    queryFn: () => resolveClientProductPrice({ clientProductId: product.id }),
    enabled: Boolean(product.id),
    staleTime: 15_000,
  });

  const { data: historyRes, isLoading: historyLoading } = useQuery({
    queryKey: ["clientProductHistoricalReference", product.id],
    queryFn: () => getClientProductHistoricalReference({ clientProductId: product.id }),
    enabled: Boolean(product.id),
    staleTime: 30_000,
  });

  const result = priceRes?.data;
  const resolveError = priceRes?.error;

  const familyComponents = (Array.isArray(components) ? components : []).filter(
    (c) => !c.garment_variant_id && !c.treatment_id && c.is_active !== false
  );
  const commercialComponents = familyComponents.filter((c) => COMMERCIAL_TYPES.has(c.component_type));
  const productionComponents = familyComponents.filter((c) => !COMMERCIAL_TYPES.has(c.component_type));

  const history = historyRes?.data;
  const hasHistory = (history?.orderLines?.length || 0) > 0 || (history?.snapshots?.length || 0) > 0;

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-800">Price review</p>
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wide text-slate-400">Read-only</span>
          <button
            type="button"
            onClick={() => setReconfigureOpen(true)}
            className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-100"
          >
            Configure product
          </button>
        </div>
      </div>
      {reconfigureOpen && (
        <ReconfigurationDraftWorkflow product={product} components={components} onClose={() => setReconfigureOpen(false)} />
      )}
      <p className="text-[11px] text-slate-400">
        Current saved pricing for new orders.
      </p>

      {priceLoading && <p className="text-xs text-slate-400">Loading price review…</p>}

      {!priceLoading && (resolveError || !result) && (
        <p className="text-xs text-red-500">{resolveError || "Could not load the price review for this product."}</p>
      )}

      {!priceLoading && result && (
        <>
          {/* A) Commercial price fields - verbatim from the resolver, no recomputation */}
          <div className="space-y-1.5 rounded-lg bg-slate-50 p-2.5">
            <FieldRow label="Effective unit price" value={money(result.effective_unit_price)} help="What an order line would actually charge today." />
            <FieldRow label="Agreed unit price" value={result.agreed_unit_price == null ? "Not set" : money(result.agreed_unit_price)} />
            <FieldRow label="Computed from components" value={result.computed_unit_price == null ? "Not available" : money(result.computed_unit_price)} />
            <FieldRow label="Price source" value={getPriceSourceLabel(result.price_source)} help="Which value won: an override, the agreed price, or a zero default." />
            {result.requires_quote && (
              <p className="mt-1 rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
                Marked as requiring a quote. Shown for information only - this never hides the price fields above.
              </p>
            )}
          </div>

          {/* B) Status label mapping */}
          {(() => {
            const meta = getReconciliationStatusMeta(result.reconciliation_status);
            return (
              <div className={`rounded-lg border px-2.5 py-2 text-xs ${meta.tone}`}>
                <p className="font-medium">{meta.label}</p>
                <p className="mt-0.5 text-[11px] opacity-80">{meta.hint}</p>
              </div>
            );
          })()}

          {/* C) Component summary, split commercial vs production/BOM */}
          <Collapsible
            title="Pricing components"
            subtitle="Family-level components that feed the computed price above (blank, print, setup fee, add-on)."
            count={commercialComponents.length}
          >
            {commercialComponents.length === 0 ? (
              <p className="text-[11px] text-slate-400">No pricing components configured at family level.</p>
            ) : (
              <div className="space-y-1">
                {commercialComponents.map((c) => (
                  <div key={c.id} className="flex items-center justify-between text-xs">
                    <span className="text-slate-600">{c.label || c.component_type}</span>
                    <span className="tabular-nums text-slate-500">
                      {c.default_sell_price == null ? "No price set" : money(c.default_sell_price)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Collapsible>

          <details className="rounded-lg border border-slate-200 p-2.5">
            <summary className="cursor-pointer text-xs font-medium text-slate-600">Advanced pricing details</summary>
            <div className="mt-3 space-y-3">
          <Collapsible title="Raw resolver state" subtitle="The exact values this panel was built from, for staff who want to see the unprocessed state rather than the summary above.">
            <dl className="space-y-1 text-[11px]">
              {["reconciliation_status", "price_source", "requires_quote"].map((key) => (
                <div key={key} className="flex justify-between gap-3">
                  <dt className="text-slate-400">{key}</dt>
                  <dd className="font-mono text-slate-600">{String(result[key])}</dd>
                </div>
              ))}
              {(result.unresolved_components || []).length > 0 && (
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-400">unresolved_components</dt>
                  <dd className="font-mono text-slate-600">
                    {(result.unresolved_components || []).map((u) => u.label || u.component_id).join(", ")}
                  </dd>
                </div>
              )}
            </dl>
          </Collapsible>

          <Collapsible
            title="Production / BOM components"
            subtitle="Materials, packaging, labour, and other production-only components. These never affect the commercial price above - they describe what gets made, not what it costs the client."
            count={productionComponents.length}
          >
            {productionComponents.length === 0 ? (
              <p className="text-[11px] text-slate-400">No production-only components configured at family level.</p>
            ) : (
              <div className="space-y-1">
                {productionComponents.map((c) => (
                  <div key={c.id} className="flex items-center justify-between text-xs">
                    <span className="text-slate-600">{c.label || c.component_type}</span>
                    <span className="text-[11px] text-slate-400">{c.component_type}</span>
                  </div>
                ))}
              </div>
            )}
          </Collapsible>

          {/* D) Historical price reference - context only */}
          <Collapsible
            title="Historical price reference"
            subtitle="Past order lines and production snapshots for this product, shown for context only. This is history, not a recommendation - it never implies the current price should change to match it."
            count={hasHistory ? (history.orderLines.length + history.snapshots.length) : 0}
          >
            {historyLoading && <p className="text-[11px] text-slate-400">Loading history…</p>}
            {!historyLoading && !hasHistory && (
              <p className="text-[11px] text-slate-400">Historical reference unavailable - no past orders or production snapshots found for this product.</p>
            )}
            {!historyLoading && hasHistory && (
              <div className="space-y-2">
                {history.orderLines.length > 0 && (
                  <div>
                    <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">Order lines</p>
                    <div className="space-y-1">
                      {history.orderLines.map((line, i) => (
                        <div key={`${line.orderId}-${i}`} className="flex items-center justify-between text-[11px] text-slate-600">
                          <span>{line.orderCreatedAt ? new Date(line.orderCreatedAt).toLocaleDateString() : "Unknown date"} · {line.orderStatus}</span>
                          <span className="tabular-nums">{money(line.price)} × {line.quantity}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {history.snapshots.length > 0 && (
                  <div>
                    <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">Production snapshots</p>
                    <div className="space-y-1">
                      {history.snapshots.map((s) => (
                        <div key={s.id} className="flex items-center justify-between text-[11px] text-slate-600">
                          <span>{s.label || s.component_type}</span>
                          <span className="tabular-nums">{s.sell_price == null ? "No price" : money(s.sell_price)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <p className="text-[10px] text-slate-400">Quote and invoice history is not shown - those records do not currently link back to this product.</p>
              </div>
            )}
          </Collapsible>

          {/* X LAB safety - future-safe, hidden today since no live product has this link */}
          {product.xlab_product_id && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-2.5 text-xs text-blue-800">
              <p className="font-medium">Live storefront reference</p>
              <p className="mt-0.5 text-[11px] opacity-90">
                This product is linked to a live X LAB storefront item. Treat the storefront price as
                commercial truth - nothing here changes it, and it should never be overwritten silently
                from this panel.
              </p>
            </div>
          )}

          {/* Temporary, non-persisted review classification */}
          <div className="rounded-lg border border-dashed border-slate-300 p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-medium text-slate-600" htmlFor={`review-classification-${product.id}`}>
                Review classification — not saved
              </label>
            </div>
            <p className="mb-1.5 text-[10px] text-slate-400">
              A scratchpad for this review session only. It is never written to the database and resets
              when this panel closes.
            </p>
            <select
              id={`review-classification-${product.id}`}
              value={reviewClassification}
              onChange={(e) => setReviewClassification(e.target.value)}
              className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs text-slate-700"
            >
              {REVIEW_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
            </div>
          </details>
          {/* Recommended next action */}
          <div className="flex items-start gap-2 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600">
            <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
            <span>{NEXT_ACTION[result.reconciliation_status] || NEXT_ACTION.no_composition}</span>
          </div>

        </>
      )}
    </div>
  );
}
