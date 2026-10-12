import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, HelpCircle, RefreshCw } from "lucide-react";
import { createPageUrl } from "@/utils";

// Phase B2 - read-only display of facts the system already knows from
// other authorities (payment, client approval, line configuration,
// production files). No Select, no mutation, no checklist write path -
// this never becomes a 9th/10th/11th/12th manual checklist row.
//
// Four distinct states, never conflated: ready (green), blocked (amber),
// pending/loading (neutral, spinning), and unavailable (neutral grey,
// "Not verified" - a genuinely unknown fact, which must never render as
// a green check just because it isn't a known blocker).
//
// Extracted out of ProductionReadinessCard.jsx (Order Drawer Operational
// Summary, Phase C1) so the Details tab's compact summary and the full
// Readiness tab render the exact same markup/behavior - one component,
// two call sites, not a second copy that can drift.
const AUTOMATIC_READINESS_TONE = {
  ready: { className: "bg-emerald-50 text-emerald-700", icon: CheckCircle2, spin: false },
  blocked: { className: "bg-amber-50 text-amber-800", icon: AlertTriangle, spin: false },
  pending: { className: "bg-secondary/40 text-muted-foreground", icon: RefreshCw, spin: true },
  unavailable: { className: "bg-slate-100 text-slate-600", icon: HelpCircle, spin: false },
};

function automaticReadinessTone(item) {
  if (item.unavailable) return "unavailable";
  if (item.satisfied === true) return "ready";
  if (item.satisfied === false) return "blocked";
  return "pending";
}

export default function AutomaticReadinessStrip({ items, order, title = "Ready automatically" }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const needsAttention = items.filter((item) => item.satisfied === false || item.unavailable === true);

  return (
    <div className="rounded-2xl border border-border bg-secondary/10 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {items.map((item) => {
          const tone = AUTOMATIC_READINESS_TONE[automaticReadinessTone(item)];
          const Icon = tone.icon;
          return (
            <div key={item.key} className={`rounded-xl px-2.5 py-2 text-xs font-medium ${tone.className}`}>
              <div className="flex items-center gap-1.5">
                <Icon className={`h-3.5 w-3.5 flex-shrink-0 ${tone.spin ? "animate-spin" : ""}`} />
                <span className="truncate">{item.label}</span>
              </div>
              {item.detail && (
                <p className="mt-0.5 truncate text-[10px] font-normal text-muted-foreground">{item.detail}</p>
              )}
            </div>
          );
        })}
      </div>
      {needsAttention.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {needsAttention.map((item) => {
            const missingId = Array.isArray(item.missingProductIds) ? item.missingProductIds[0] : null;
            const linkTo =
              missingId && order?.client_id
                ? `${createPageUrl("Clients")}?${new URLSearchParams({ client: order.client_id, clientProduct: missingId }).toString()}`
                : null;
            return (
              <p key={item.key} className={`text-[11px] leading-5 ${item.unavailable ? "text-slate-600" : "text-amber-800"}`}>
                <span className="font-semibold">{item.label}:</span>{" "}
                {item.detail || (item.unavailable ? "Not verified" : "Not yet satisfied")}
                {linkTo && (
                  <Link to={linkTo} className="ml-1 underline underline-offset-2">
                    Open
                  </Link>
                )}
              </p>
            );
          })}
        </div>
      )}
    </div>
  );
}
