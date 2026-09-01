import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Lock } from "lucide-react";
import { toast } from "sonner";
import { PRODUCTION_COMPONENT_TYPES, PRODUCTION_METHODS } from "@/api/xosClientProduct";

// ─────────────────────────────────────────────────────────────────────
// The ONE structured-production editor for a canonical Client Product.
// Edits product_components as a flat list — one atomic placement per
// component — and saves the WHOLE list through
// admin_set_client_product_production_components (passed in as onSave).
// It never derives the flat print_method/placement/print_locations
// summary or required_artwork_placements itself — those come back
// derived on `full` from the server. Shared by the OPPS Client Product
// drawer and Catalog Management so the two never drift.
//
// Props:
//   full     — get_client_product_full() output (reads full.production)
//   onSave   — async (components[]) => { data, error }
//   saving   — boolean
//   readOnly — hide all editing affordances (RLS write-gate probe)
// ─────────────────────────────────────────────────────────────────────
const NONE = "__none";

function toRow(c, ix) {
  return {
    id: c?.id || null,
    component_type: c?.component_type || "print_service",
    production_method: c?.production_method || "",
    placement: c?.placement || "",
    specification: c?.specification || "",
    production_instructions: c?.production_instructions || "",
    sort_order: c?.sort_order ?? ix,
    // Price fields live in the Pricing tab — carried through here verbatim
    // so a structural save never wipes them (P1 made the RPC accept them,
    // so an omitted field would be written as null).
    _billing_mode: c?.billing_mode || null,
    _default_sell_price: c?.default_sell_price ?? null,
    _price_label: c?.price_label ?? null,
  };
}

export default function CanonicalProductionEditor({ full, onSave, saving = false, readOnly = false }) {
  const serverComponents = useMemo(
    () => (Array.isArray(full?.production?.components) ? full.production.components : []),
    [full],
  );
  // Stable string key of the server list — resets local edits only when
  // the server actually changed (not on every re-render).
  const serverKey = serverComponents
    .map((c) => `${c.id}:${c.component_type}:${c.production_method || ""}:${c.placement || ""}:${c.specification || ""}:${c.production_instructions || ""}:${c.sort_order ?? ""}`)
    .join("~");

  // Reset local edits only when the SERVER list actually changed (keyed on
  // a stable string), not on every get_client_product_full refetch that
  // returns a structurally-identical list.
  const [rows, setRows] = useState(() => serverComponents.map(toRow));
  useEffect(() => {
    setRows(serverComponents.map(toRow));
  }, [serverKey]);

  const summary = full?.production?.summary || {};
  const dirty = useMemo(() => {
    const norm = (list) =>
      JSON.stringify(
        list.map((c) => [
          c.id || null,
          c.component_type,
          c.production_method || "",
          (c.placement || "").trim(),
          (c.specification || "").trim(),
          (c.production_instructions || "").trim(),
        ]),
      );
    return norm(rows) !== norm(serverComponents.map(toRow));
  }, [rows, serverComponents]);

  const patchRow = (ix, patch) => setRows((cur) => cur.map((r, i) => (i === ix ? { ...r, ...patch } : r)));
  const addRow = () =>
    setRows((cur) => [...cur, toRow({ component_type: "print_service" }, cur.length)]);
  const removeRow = (ix) => setRows((cur) => cur.filter((_, i) => i !== ix));

  const allowMultipleBase = Boolean(full?.pricing?.allow_multiple_base);
  const baseConflict = !allowMultipleBase
    && rows.filter((r) => r.component_type === "blank_garment").length > 1;

  const save = async () => {
    if (baseConflict) {
      toast.error("Only one base / blank garment per product. Remove the extra, or enable a multi-base bundle.");
      return;
    }
    const payload = rows.map((r, ix) => ({
      ...(r.id ? { id: r.id } : {}),
      component_type: r.component_type,
      production_method: r.production_method ? r.production_method : null,
      placement: (r.placement || "").trim() || null,
      specification: (r.specification || "").trim() || null,
      production_instructions: (r.production_instructions || "").trim() || null,
      sort_order: ix,
      // carry price fields through unchanged (edited in the Pricing tab)
      ...(r._billing_mode ? { billing_mode: r._billing_mode } : {}),
      ...(r._default_sell_price != null ? { default_sell_price: r._default_sell_price } : {}),
      ...(r._price_label ? { price_label: r._price_label } : {}),
    }));
    await onSave?.(payload);
  };

  return (
    <div className="space-y-3">
      {/* Derived, read-only — never independently editable */}
      <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 text-xs text-slate-600">
        <p className="font-medium text-slate-700">Derived summary (read-only)</p>
        <p className="mt-0.5">
          {summary.print_method || "—"}
          {summary.placement ? ` · ${summary.placement}` : ""}
          {summary.print_locations != null ? ` · ${summary.print_locations} location${summary.print_locations === 1 ? "" : "s"}` : ""}
        </p>
        <p className="mt-1 text-[11px] text-slate-400">
          Derived from the components below. Print-service components with a placement become required artwork placements automatically.
        </p>
      </div>

      {readOnly ? (
        <>
          <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600">
            <Lock className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400" />
            <span>Production is read-only for your role. Ask a workspace owner or admin to make structural changes.</span>
          </div>
          {serverComponents.length === 0 ? (
            <p className="text-xs text-slate-400">No production components — production is not configured.</p>
          ) : (
            <ul className="space-y-1 text-xs text-slate-600">
              {serverComponents.map((c) => (
                <li key={c.id} className="rounded border border-slate-200 px-2 py-1.5">
                  <span className="font-medium text-slate-700">{c.component_type.replace(/_/g, " ")}</span>
                  {c.production_method ? ` · ${c.production_method.toUpperCase()}` : ""}
                  {c.placement ? ` · ${c.placement}` : ""}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          {rows.length === 0 && (
            <p className="text-xs text-slate-400">No production components yet — add one below.</p>
          )}
          <div className="space-y-2">
            {rows.map((row, ix) => (
              <div key={row.id || `new-${ix}`} className="rounded-lg border border-slate-200 p-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[11px] text-slate-500">Component type</Label>
                    <Select value={row.component_type} onValueChange={(v) => patchRow(ix, { component_type: v })}>
                      <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PRODUCTION_COMPONENT_TYPES.map((t) => (
                          <SelectItem key={t} value={t} className="capitalize">{t.replace(/_/g, " ")}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-slate-500">Print method</Label>
                    <Select
                      value={row.production_method || NONE}
                      onValueChange={(v) => patchRow(ix, { production_method: v === NONE ? "" : v })}
                    >
                      <SelectTrigger className="h-8"><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>— none —</SelectItem>
                        {PRODUCTION_METHODS.map((m) => (
                          <SelectItem key={m} value={m} className="uppercase">{m}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="mt-2 space-y-1">
                  <Label className="text-[11px] text-slate-500">Placement (one atomic placement)</Label>
                  <Input
                    className="h-8"
                    value={row.placement}
                    placeholder="e.g. Front"
                    onChange={(e) => patchRow(ix, { placement: e.target.value })}
                  />
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[11px] text-slate-500">Specification</Label>
                    <Input
                      className="h-8"
                      value={row.specification}
                      onChange={(e) => patchRow(ix, { specification: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-slate-500">Production instructions</Label>
                    <Textarea
                      rows={2}
                      value={row.production_instructions}
                      onChange={(e) => patchRow(ix, { production_instructions: e.target.value })}
                    />
                  </div>
                </div>
                <div className="mt-2 flex justify-end">
                  <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10" onClick={() => removeRow(ix)}>
                    <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove component
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {baseConflict && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              More than one base / blank garment. A normal product has exactly one — remove the extra, or enable a multi-base bundle. Saving is blocked until resolved.
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={addRow}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Add component
            </Button>
            <Button size="sm" disabled={!dirty || saving || baseConflict} onClick={save}>
              {saving ? "Saving…" : "Save production"}
            </Button>
          </div>
          <p className="text-[11px] text-slate-400">
            Removing a placement that already has linked artwork is blocked — remove or reassign that artwork first.
          </p>
        </>
      )}
    </div>
  );
}
