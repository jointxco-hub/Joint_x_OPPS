import { ChevronRight, ClipboardCheck, Truck } from "lucide-react";
import { useOrderAutomaticReadiness } from "@/hooks/useOrderAutomaticReadiness";
import AutomaticReadinessStrip from "@/components/orders/AutomaticReadinessStrip";

// Order Drawer Operational Summary, Phase C1 - surfaces the existing
// "Ready automatically" facts (Payment / Client approval / Line
// configuration / Production files) on the DEFAULT Details tab, so a
// counter/production operator sees them without an extra tap into the
// Readiness tab. Every fact comes from useOrderAutomaticReadiness - the
// exact same hook (and therefore the exact same React Query cache keys)
// ProductionReadinessCard.jsx uses on the Readiness tab, so opening this
// summary and later tapping "Full readiness" never re-fetches anything
// already in flight/cached - no new authority, no new calculation, no
// duplicate network waterfall.
//
// fulfilment completeness (shippingGapReason) is passed in from
// OrderDrawer.jsx's own EXISTING getCourierRequirementGap() call - this
// component never computes it itself and never reads/writes any shipping
// field. It is purely informational here: no status gate is added or
// changed - orders_paxi_dispatch_gate remains the sole authoritative
// enforcement point, untouched.
const TERMINAL_ORDER_STATUSES = ["delivered", "cancelled"];

export default function OrderOperationalSummary({
  order,
  readinessQuery,
  lineProductionReadiness,
  shippingGapReason,
  onViewReadiness,
}) {
  const { data, isLoading, error, isAuthorizationBlocked, canLoad, refetch } = readinessQuery || {};
  const { items } = useOrderAutomaticReadiness({ order, readinessQuery, lineProductionReadiness });

  if (!order?.id) return null;
  if (error || isAuthorizationBlocked || canLoad === false) {
    return (
      <div className="rounded-2xl border border-border bg-card p-3 text-sm text-muted-foreground">
        <p>{isAuthorizationBlocked ? "You do not have access to readiness information." : "Readiness information is unavailable."}</p>
        {canLoad !== false && !isAuthorizationBlocked && (
          <button type="button" onClick={() => refetch?.()} className="mt-2 font-medium text-primary hover:underline">Retry readiness</button>
        )}
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="rounded-2xl border border-border bg-card p-3 shadow-apple-sm">
        <div className="h-4 w-40 animate-pulse rounded bg-secondary" />
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-xl bg-secondary/60" />
          ))}
        </div>
      </div>
    );
  }

  // Respect a delivered/completed order's history: a historical frozen
  // production file that was never confirmed is a real, accurate fact -
  // but for an order that has already shipped, it must read as a
  // historical note, never as "this order needs to go back into
  // production". The Production files tile itself keeps its honest
  // amber/"not yet confirmed" state (unchanged, same shared component the
  // Readiness tab uses) - this only adds an explicit clarifying caption.
  const isTerminalOrder = TERMINAL_ORDER_STATUSES.includes(order?.status);
  const productionFilesItem = items.find((item) => item.key === "production_files");
  const showHistoricalArtworkNote = isTerminalOrder && productionFilesItem?.satisfied === false;

  return (
    <div className="space-y-2 rounded-2xl border border-border bg-card p-3 shadow-apple-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <ClipboardCheck className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold text-foreground">Operational summary</p>
        </div>
        {typeof onViewReadiness === "function" && (
          <button
            type="button"
            onClick={onViewReadiness}
            className="flex flex-shrink-0 items-center gap-0.5 text-xs font-medium text-primary hover:underline"
          >
            Full readiness
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <AutomaticReadinessStrip items={items} order={order} />

      {showHistoricalArtworkNote && (
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] leading-5 text-slate-600">
          This order is already {order.status} — the Production files note above reflects a historical
          production file from before delivery, not a pending action.
        </p>
      )}

      {shippingGapReason && (
        <p className="flex items-start gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-800">
          <Truck className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>Delivery details incomplete: {shippingGapReason}.</span>
        </p>
      )}
    </div>
  );
}
