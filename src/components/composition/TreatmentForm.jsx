import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PRINT_COMPONENT_METHODS, PLACEMENT_PRESETS } from "@/lib/productionStages";

// Phase 2B Step 3 - add/edit form for one treatment. primary_placement is
// a display/default hint only (see buildTreatmentPayload) - it is never
// read as the authoritative required-artwork-placement list.
export default function TreatmentForm({ form, setForm }) {
  const set = (patch) => setForm((c) => ({ ...c, ...patch }));

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-3">
      <div className="space-y-1">
        <Label className="text-xs">Name</Label>
        <Input placeholder="e.g. White SFR Print" value={form.name} onChange={(e) => set({ name: e.target.value })} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Print colour</Label>
          <Input placeholder="e.g. White" value={form.print_colour} onChange={(e) => set({ print_colour: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Production method</Label>
          <Select value={form.production_method || "__none"} onValueChange={(v) => set({ production_method: v === "__none" ? "" : v })}>
            <SelectTrigger><SelectValue placeholder="Method" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">No method</SelectItem>
              {PRINT_COMPONENT_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Primary placement <span className="text-slate-400">(display hint only)</span></Label>
          <Select value={form.primary_placement || "__none"} onValueChange={(v) => set({ primary_placement: v === "__none" ? "" : v })}>
            <SelectTrigger><SelectValue placeholder="Placement" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">No placement</SelectItem>
              {PLACEMENT_PRESETS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Print size</Label>
          <Input placeholder="e.g. A5" value={form.print_size} onChange={(e) => set({ print_size: e.target.value })} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Surcharge (R)</Label>
          <Input type="number" min="0" step="0.01" value={form.surcharge} onChange={(e) => set({ surcharge: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Sort order</Label>
          <Input type="number" value={form.sort_order} onChange={(e) => set({ sort_order: e.target.value })} />
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Production instructions</Label>
        <Textarea className="min-h-[50px] text-sm" placeholder="Optional" value={form.production_instructions} onChange={(e) => set({ production_instructions: e.target.value })} />
      </div>

      <label className="flex items-center gap-2 text-xs text-slate-600">
        <input type="checkbox" checked={form.is_active} onChange={(e) => set({ is_active: e.target.checked })} />
        Active
      </label>
    </div>
  );
}
