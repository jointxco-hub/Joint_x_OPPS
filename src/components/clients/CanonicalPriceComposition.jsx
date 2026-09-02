import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  readPricing,
  bearingComponents,
  derivedComponentLabel,
  billingModeIsEditable,
  defaultBillingModeFor,
  roleForType,
  buildPricingSavePayload,
  wouldBreakSingleBase,
  ROLE_LABEL,
  BILLING_LABEL,
  formatMoney,
} from "@/lib/xosPriceComposition";

// ─────────────────────────────────────────────────────────────────────
// OPPS — canonical Client Product PRICE COMPOSITION (P2). The SAME view
// X LAB Admin shows. Reads get_client_product_full().pricing (server-
// derived — no local pricing math) and edits the customer sell price /
// label / billing of the price-bearing components through the SAME
// canonical writer as Production (admin_set_client_product_production_
// components, passed in as onSave). Sell amounts only — never cost.
//
// Props:
//   full     — get_client_product_full() output
//   onSave   — async (components[]) => void   (throws / toasts on error)
//   saving   — boolean
//   readOnly — hide editing affordances
// ─────────────────────────────────────────────────────────────────────
export default function CanonicalPriceComposition({ full, onSave, saving = false, readOnly = false }) {
  const pricing = readPricing(full);
  const bearing = bearingComponents(full);
  const serverKey = bearing
    .map((c) => `${c.id}|${c.default_sell_price ?? ""}|${c.price_label ?? ""}|${c.billing_mode ?? ""}`)
    .join("~");

  const [edits, setEdits] = useState({});
  const [building, setBuilding] = useState(false);
  useEffect(() => {
    setEdits({});
    setBuilding(false);
  }, [serverKey]);

  const editVal = (c, field) => {
    const e = edits[c.id] || {};
    if (field in e) return e[field];
    if (field === "default_sell_price") return c.default_sell_price ?? "";
    if (field === "price_label") return c.price_label ?? "";
    if (field === "billing_mode") return c.billing_mode || defaultBillingModeFor(c.component_type);
    return "";
  };
  const setEdit = (id, field, value) =>
    setEdits((cur) => ({ ...cur, [id]: { ...(cur[id] || {}), [field]: value } }));
  const dirty = Object.keys(edits).length > 0;
  const composedView = pricing.mode === "composed" || building;
  const canBuild = bearing.length > 0;

  const save = async () => {
    const norm = {};
    for (const [id, e] of Object.entries(edits)) {
      norm[id] = {};
      if ("default_sell_price" in e)
        norm[id].default_sell_price = e.default_sell_price === "" || e.default_sell_price == null ? null : Number(e.default_sell_price);
      if ("price_label" in e) norm[id].price_label = String(e.price_label).trim() || null;
      if ("billing_mode" in e) norm[id].billing_mode = e.billing_mode;
    }
    const payload = buildPricingSavePayload(full, norm);
    if (wouldBreakSingleBase(payload, pricing.allowMultipleBase)) {
      toast.error("More than one active base / blank garment. Fix in Production, or enable a multi-base bundle.");
      return;
    }
    if (payload.some((c) => c.default_sell_price != null && Number(c.default_sell_price) < 0)) {
      toast.error("Component prices cannot be negative.");
      return;
    }
    await onSave?.(payload);
  };

  const BreakdownList = ({ title, rows, total }) => (
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{title}</p>
      {rows.length === 0 ? (
        <p className="mt-1 text-xs text-slate-400">{title === "Once-off" ? "No once-off fees." : "No priced per-item components yet."}</p>
      ) : (
        <ul className="mt-1 space-y-1 text-sm text-slate-700">
          {rows.map((r, i) => (
            <li key={i} className="flex justify-between gap-3">
              <span className="truncate">
                <span className="text-slate-400">{ROLE_LABEL[r.role] || r.role}</span> · {r.label}
              </span>
              <span className="shrink-0">{formatMoney(r.amount, pricing.currency)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 flex justify-between border-t border-slate-200 pt-2 text-sm font-medium text-slate-800">
        <span>{title === "Once-off" ? "Once-off total" : "Per-item total"}</span>
        <span>{formatMoney(total, pricing.currency)}</span>
      </p>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant={pricing.mode === "composed" ? "default" : "secondary"}>
          {pricing.mode === "composed" ? "Composed price" : "Single price"}
        </Badge>
        <span className="text-slate-500">
          Agreed client price:{" "}
          <span className="font-medium text-slate-800">
            {pricing.requiresQuote
              ? "Requires a quote"
              : pricing.clientPrice != null
                ? formatMoney(pricing.clientPrice, pricing.currency)
                : "Pricing pending"}
          </span>
        </span>
        <span className="text-[11px] text-slate-400">— the agreed price is edited in Details.</span>
      </div>

      {!composedView && (
        <div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm">
          <p className="font-medium text-slate-700">Price breakdown not configured</p>
          <p className="mt-1 text-slate-500">
            {canBuild
              ? `${bearing.length} priceable component${bearing.length === 1 ? "" : "s"} in Production — set a sell price for each to build a composed breakdown.`
              : "Add blank / print / setup / add-on components in Production first, then price them here."}
          </p>
          {!readOnly && (
            <Button type="button" size="sm" variant="outline" className="mt-3" disabled={!canBuild} onClick={() => setBuilding(true)}>
              Build price breakdown
            </Button>
          )}
        </div>
      )}

      {composedView && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <BreakdownList title="Per item" rows={pricing.perUnit} total={pricing.computedUnitPrice} />
            <BreakdownList title="Once-off" rows={pricing.oncePerOrder} total={pricing.computedOnceTotal} />
          </div>

          {pricing.reconciled === true && (
            <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              Reconciled ✓ — the per-item total matches the agreed client price.
            </p>
          )}
          {pricing.reconciled === false && (
            <div className="rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <p className="font-semibold">Price breakdown does not match the agreed price</p>
              <p className="mt-0.5">
                Per-item total {formatMoney(pricing.computedUnitPrice, pricing.currency)} · agreed{" "}
                {formatMoney(pricing.clientPrice, pricing.currency)} · difference {formatMoney(pricing.difference, pricing.currency)}.
              </p>
              <p className="mt-0.5 text-[11px]">
                The agreed price is authoritative for orders. Adjust a component price or the agreed price to reconcile — nothing is redistributed automatically.
              </p>
            </div>
          )}
          {pricing.reconciled === null && (
            <p className="text-[11px] text-slate-400">Set an agreed client price in Details to check it against the component total.</p>
          )}

          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Component sell prices</p>
            {bearing.length === 0 && <p className="text-sm text-slate-400">No priceable components in Production.</p>}
            {bearing.map((c) => (
              <div key={c.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{ROLE_LABEL[roleForType(c.component_type)] || c.component_type}</Badge>
                  <span className="text-sm text-slate-500">{derivedComponentLabel(c)}</span>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  <div className="space-y-1">
                    <Label className="text-[11px] text-slate-500">Customer label</Label>
                    <Input
                      className="h-8"
                      value={editVal(c, "price_label")}
                      placeholder={derivedComponentLabel(c)}
                      disabled={readOnly}
                      onChange={(e) => setEdit(c.id, "price_label", e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-slate-500">Sell price</Label>
                    <Input
                      className="h-8"
                      type="number"
                      min="0"
                      step="0.01"
                      value={editVal(c, "default_sell_price")}
                      placeholder="Unpriced"
                      disabled={readOnly}
                      onChange={(e) => setEdit(c.id, "default_sell_price", e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-slate-500">Billing</Label>
                    {billingModeIsEditable(c.component_type) && !readOnly ? (
                      <Select value={editVal(c, "billing_mode")} onValueChange={(v) => setEdit(c.id, "billing_mode", v)}>
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="per_unit">Per item</SelectItem>
                          <SelectItem value="once_per_order">Once-off</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <p className="pt-1.5 text-sm text-slate-700">
                        {BILLING_LABEL[billingModeIsEditable(c.component_type) ? editVal(c, "billing_mode") : defaultBillingModeFor(c.component_type)]}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {!readOnly && (
            <>
              <div className="flex items-center gap-2">
                <Button size="sm" disabled={!dirty || saving} onClick={save}>
                  {saving ? "Saving…" : "Save prices"}
                </Button>
                {dirty && <span className="text-[11px] text-amber-700">Unsaved changes</span>}
              </div>
              <p className="text-[11px] text-slate-400">
                Structure (add / remove components, method, placement) is edited in Production. One active base / blank garment per product.
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
