import { useQuery } from "@tanstack/react-query";
import { dataClient } from "@/api/dataClient";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchSelect } from "@/pages/Inventory";
import { deriveSizesForProductColour } from "@/lib/inventorySizeDerivation";

export function emptyGarmentVariantForm() {
  return {
    name: "",
    inventory_product_id: "",
    colour_name: "",
    manual_available_sizes: "",
    price_override: "",
    sort_order: 0,
    notes: "",
    is_active: true,
  };
}

// Phase 2B Step 3 - add/edit form for one garment variant. Inventory-
// aware: once an inventory_product_id is picked, the colour choices are
// restricted to colours that actually exist for that product in
// inventory_variants, and available sizes are DERIVED (never manually
// entered) via deriveSizesForProductColour. With no inventory product
// linked, manual_available_sizes (free-text, comma-separated) is the
// authoritative source instead - the two are never silently merged, and
// the UI always labels which one is in effect.
export default function GarmentVariantForm({ form, setForm, internalProducts }) {
  const set = (patch) => setForm((c) => ({ ...c, ...patch }));

  const { data: inventoryVariants = [] } = useQuery({
    queryKey: ["inventoryVariantsForVariantForm", form.inventory_product_id],
    queryFn: () => dataClient.entities.InventoryVariant.filter({ inventory_product_id: form.inventory_product_id }, "colour_name", 200),
    enabled: Boolean(form.inventory_product_id),
  });

  const inventoryColours = [...new Set(
    inventoryVariants.filter((v) => v.is_active !== false).map((v) => v.colour_name).filter(Boolean)
  )];

  const isInventoryLinked = Boolean(form.inventory_product_id);
  const derivedSizes = isInventoryLinked
    ? deriveSizesForProductColour(inventoryVariants, form.inventory_product_id, form.colour_name)
    : [];

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-3">
      <div className="space-y-1">
        <Label className="text-xs">Name</Label>
        <Input placeholder="e.g. 220gsm / Black" value={form.name} onChange={(e) => set({ name: e.target.value })} />
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Inventory product</Label>
        <SearchSelect
          options={internalProducts}
          value={form.inventory_product_id}
          onChange={(id) => set({ inventory_product_id: id, colour_name: "" })}
          getLabel={(p) => p.internal_name || p.internal_code}
          placeholder="Search internal product (optional)"
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Colour</Label>
        {isInventoryLinked && inventoryColours.length > 0 ? (
          <Select value={form.colour_name || "__none"} onValueChange={(v) => set({ colour_name: v === "__none" ? "" : v })}>
            <SelectTrigger><SelectValue placeholder="Colour" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">No colour</SelectItem>
              {inventoryColours.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : (
          <Input placeholder="Colour (free text)" value={form.colour_name} onChange={(e) => set({ colour_name: e.target.value })} />
        )}
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Available sizes</Label>
          <span className={`text-[10px] rounded-full px-1.5 py-0.5 font-semibold ${isInventoryLinked ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
            {isInventoryLinked ? "Inventory-derived" : "Manual"}
          </span>
        </div>
        {isInventoryLinked ? (
          <p className="text-xs text-slate-500">
            {derivedSizes.length > 0 ? derivedSizes.join(", ") : "No sizes found in inventory for this product/colour yet."}
          </p>
        ) : (
          <Input
            placeholder="e.g. S, M, L, XL"
            value={form.manual_available_sizes}
            onChange={(e) => set({ manual_available_sizes: e.target.value })}
          />
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Price override (R)</Label>
          <Input type="number" min="0" step="0.01" placeholder="Uses family price" value={form.price_override} onChange={(e) => set({ price_override: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Sort order</Label>
          <Input type="number" value={form.sort_order} onChange={(e) => set({ sort_order: e.target.value })} />
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Notes</Label>
        <Textarea className="min-h-[50px] text-sm" placeholder="Internal notes (optional)" value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
      </div>

      <label className="flex items-center gap-2 text-xs text-slate-600">
        <input type="checkbox" checked={form.is_active} onChange={(e) => set({ is_active: e.target.checked })} />
        Active
      </label>
    </div>
  );
}
