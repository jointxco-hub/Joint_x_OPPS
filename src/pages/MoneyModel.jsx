import { useState } from "react";
import { dataClient } from "@/api/dataClient";
import { useQuery } from "@tanstack/react-query";
import { DollarSign, TrendingUp, AlertCircle, Plus } from "lucide-react";
import { format } from "date-fns";
import AdminOnly from "@/components/common/AdminOnly";
import HelperHint from "@/components/common/HelperHint";

function paybackColor(days) {
  if (days === null || days === undefined) return "bg-secondary text-muted-foreground";
  if (days <= 30) return "bg-green-100 text-green-700";
  if (days <= 60) return "bg-amber-100 text-amber-700";
  return "bg-red-100 text-red-700";
}

function grossMargin(snap) {
  if (!snap.revenue || snap.revenue === 0) return null;
  const cost = (snap.cogs ?? 0) + (snap.ad_spend ?? 0);
  return Math.round(((snap.revenue - cost) / snap.revenue) * 100);
}

function RevenueSparkline({ snaps }) {
  if (!snaps || snaps.length < 2) return null;
  const values = snaps.map(s => s.revenue ?? 0);
  const max = Math.max(...values, 1);
  const min = Math.min(...values);
  const range = max - min || 1;

  const w = 120;
  const h = 32;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  }).join(" ");

  const trend = values[values.length - 1] - values[0];

  return (
    <div className="flex items-center gap-2">
      <svg width={w} height={h} className="overflow-visible">
        <polyline
          fill="none"
          stroke={trend >= 0 ? "#16a34a" : "#dc2626"}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={pts}
        />
      </svg>
      <span className={`text-xs font-medium ${trend >= 0 ? "text-green-600" : "text-red-600"}`}>
        {trend >= 0 ? "↑" : "↓"} R{Math.abs(trend).toLocaleString()}
      </span>
    </div>
  );
}

function MoneyModelInner() {
  const [offerFilter, setOfferFilter] = useState("all");

  const { data: snapshots = [], isLoading } = useQuery({
    queryKey: ["moneyModel"],
    queryFn: () => dataClient.entities.MoneyModel.list("-period_start", 200),
  });

  const { data: offers = [] } = useQuery({
    queryKey: ["offerScores"],
    queryFn: () => dataClient.entities.OfferScore.list("-scored_at", 100),
  });

  const offerKeys = [...new Set(snapshots.map(s => s.offer_key).filter(Boolean))];

  const filtered = offerFilter === "all"
    ? snapshots
    : snapshots.filter(s => s.offer_key === offerFilter);

  // Group by offer for sparklines
  const byOffer = {};
  for (const snap of [...snapshots].sort((a, b) => new Date(a.period_start) - new Date(b.period_start))) {
    if (!byOffer[snap.offer_key]) byOffer[snap.offer_key] = [];
    byOffer[snap.offer_key].push(snap);
  }

  const totalRevenue = filtered.reduce((s, x) => s + (x.revenue ?? 0), 0);
  const totalUnits = filtered.reduce((s, x) => s + (x.units_sold ?? 0), 0);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-6 md:py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-primary" />
              <h1 className="text-2xl font-bold text-foreground">Money Model</h1>
              <HelperHint
                storageKey="money_model"
                title="Money Model"
                body="Track revenue, COGS, ad spend, and payback period per offer per month. Low payback days = efficient acquisition."
                learnMore="Alex Hormozi — understand your offer economics before scaling spend."
              />
            </div>
            <p className="text-muted-foreground text-sm mt-0.5">
              Revenue & payback by offer
            </p>
          </div>
        </div>

        {/* Summary tiles */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <div className="bg-card rounded-2xl border border-border p-4">
            <p className="text-xs text-muted-foreground mb-1">Total Revenue</p>
            <p className="text-2xl font-bold text-foreground">R{totalRevenue.toLocaleString()}</p>
          </div>
          <div className="bg-card rounded-2xl border border-border p-4">
            <p className="text-xs text-muted-foreground mb-1">Units Sold</p>
            <p className="text-2xl font-bold text-foreground">{totalUnits.toLocaleString()}</p>
          </div>
        </div>

        {/* Offer filter */}
        {offerKeys.length > 1 && (
          <div className="flex flex-wrap gap-2 mb-4">
            <button
              onClick={() => setOfferFilter("all")}
              className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-all ${
                offerFilter === "all"
                  ? "bg-primary text-primary-foreground"
                  : "bg-card border border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              All offers
            </button>
            {offerKeys.map(k => (
              <button
                key={k}
                onClick={() => setOfferFilter(k)}
                className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-all ${
                  offerFilter === k
                    ? "bg-primary text-primary-foreground"
                    : "bg-card border border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {k}
              </button>
            ))}
          </div>
        )}

        {/* Revenue trend per offer */}
        {offerKeys.length > 0 && offerFilter === "all" && (
          <div className="mb-6 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Revenue trend</p>
            {offerKeys.map(k => (
              <div key={k} className="flex items-center gap-3 bg-card rounded-xl border border-border px-4 py-3">
                <span className="text-sm font-medium text-foreground min-w-[120px] font-mono">{k}</span>
                <RevenueSparkline snaps={byOffer[k]} />
              </div>
            ))}
          </div>
        )}

        {/* Snapshots table */}
        {isLoading ? (
          <div className="space-y-3">
            {[1,2,3].map(i => <div key={i} className="h-16 bg-card rounded-2xl animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 bg-card rounded-2xl border border-border">
            <TrendingUp className="w-12 h-12 text-muted-foreground/20 mx-auto mb-3" />
            <h3 className="font-semibold text-foreground mb-1">No snapshots yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              Add monthly money model snapshots to track offer economics over time.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-secondary/40 border-b border-border">
                  {["Period", "Offer", "Units", "Revenue", "COGS", "Ad Spend", "Margin", "Payback", "LTV"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(snap => {
                  const margin = grossMargin(snap);
                  return (
                    <tr key={snap.id} className="border-b border-border last:border-0 hover:bg-secondary/30 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground font-mono text-xs">
                        {snap.period_start ? format(new Date(snap.period_start), "MMM yyyy") : "—"}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="font-medium text-foreground font-mono text-xs">{snap.offer_key || "—"}</span>
                      </td>
                      <td className="px-4 py-3 text-center">{snap.units_sold ?? "—"}</td>
                      <td className="px-4 py-3 font-semibold text-foreground">
                        {snap.revenue != null ? `R${Number(snap.revenue).toLocaleString()}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {snap.cogs != null ? `R${Number(snap.cogs).toLocaleString()}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {snap.ad_spend != null ? `R${Number(snap.ad_spend).toLocaleString()}` : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {margin != null ? (
                          <span className={`text-xs font-medium ${margin >= 40 ? "text-green-600" : margin >= 20 ? "text-amber-600" : "text-red-600"}`}>
                            {margin}%
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {snap.payback_days != null ? (
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${paybackColor(snap.payback_days)}`}>
                            {snap.payback_days}d
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {snap.ltv_estimate != null ? `R${Number(snap.ltv_estimate).toLocaleString()}` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function MoneyModel() {
  return <AdminOnly><MoneyModelInner /></AdminOnly>;
}
