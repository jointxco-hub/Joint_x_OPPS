import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SearchSelect } from "@/pages/Inventory";
import { PRINT_COMPONENT_METHODS, PLACEMENT_PRESETS } from "@/lib/productionStages";
import { resolvePlacement } from "@/lib/productComposition";
import ClientAssetPickerModal from "@/components/files/ClientAssetPickerModal";
import { findOrCreateClientProductArtworkFromAsset } from "@/api/artworkLinking";

export const COMPONENT_TYPES = [
  { value: "blank_garment", label: "Blank garment" },
  { value: "print_service", label: "Print option" },
  { value: "setup_fee", label: "Setup fee" },
  { value: "material", label: "Material" },
  { value: "packaging", label: "Packaging" },
  { value: "labour", label: "Labour" },
  { value: "other", label: "Other" },
];

export const BILLING_MODES = [
  { value: "per_unit", label: "Per unit (× quantity)" },
  { value: "once_per_order", label: "Once-off (not multiplied)" },
];

// component_type defaults to blank_garment here because this is the
// general-purpose form (Catalog Management's "Add component" covers
// every type, garments included). ProductsEditor's "+ Add print
// option" entry point is print-service-specific - it must never default
// here, or reuse this default without overriding component_type, since
// blank_garment silently makes the resulting component inventory-bearing
// (requires an internal-product pick + later variant resolution), which
// a print option was never meant to need. See emptyPrintOptionForm below.
export function emptyComponentForm() {
  return {
    component_type: "blank_garment",
    inventory_product_id: "",
    fixed_inventory_variant_id: "",
    quantity_per_unit: 1,
    default_sell_price: "",
    billing_mode: "per_unit",
    production_method: "",
    placement: "",
    placementCustom: "",
    production_colour: "",
    specification: "",
    production_instructions: "",
    label: "",
    notes: "",
    setupRequired: false,
    setupFee: "",
    orderPrice: "",
  };
}

// ProductsEditor's "+ Add print option" entry point - staff are
// configuring a print service (DTF/vinyl/embroidery/screen/sublimation/
// custom), never picking an inventory component type, so this defaults
// to print_service. production_method itself stays empty - staff must
// choose it explicitly, no silent default to any one method.
export function emptyPrintOptionForm() {
  return { ...emptyComponentForm(), component_type: "print_service" };
}

// Shared by CatalogManagement's "Add component"/inline "Edit component"
// flows AND ProductsEditor's "+ Add print option" flow, so all three
// never drift apart on what fields exist or how they behave. Field
// visibility is driven by component_type: blank_garment needs an
// internal-product picker; print_service/setup_fee need a method; only
// print_service gets a placement (sleeve/neck/front/back are
// placements, not production methods, so they never appear as method
// choices). "Custom" placement always falls through to free text.
//
// showOrderPrice (ProductsEditor only) adds a second, order-specific
// price field alongside the reusable default - editing it never writes
// back to default_sell_price, matching the established pricing
// hierarchy (production default -> client-product default -> order
// override -> frozen snapshot).
export default function ComponentFieldsForm({
  form, setForm, internalProducts, pricingDefaultFor, clientProduct, currentArtwork, onArtworkLinked,
  showOrderPrice = false, excludeComponentTypes = [],
  // Phase 2B Step 3 - the family-level artwork-linking control (find_or_
  // create_client_product_artwork_from_asset) only understands
  // treatment_id IS NULL family artwork. It must never be shown for a
  // variant- or treatment-scoped component, where currentArtwork/
  // onArtworkLinked (if passed at all) would represent a DIFFERENT,
  // unrelated artwork namespace - see ScopedComponentsEditor, which is
  // the only caller that sets this false. Default true preserves every
  // pre-Step-3 caller (CatalogManagement's family composition,
  // ProductsEditor's "+ Add print option") unchanged.
  allowArtworkLinking = true,
}) {
  const availableComponentTypes = COMPONENT_TYPES.filter((t) => !excludeComponentTypes.includes(t.value));
  const set = (patch) => setForm((c) => ({ ...c, ...patch }));
  const methodDefault = pricingDefaultFor(form.production_method);
  const [showArtworkPicker, setShowArtworkPicker] = useState(false);
  const effectivePlacement = resolvePlacement(form);
  const linkedArtwork = effectivePlacement
    ? (Array.isArray(currentArtwork) ? currentArtwork : []).find((a) => a.placement === effectivePlacement)
    : null;
  const artworkMutation = useMutation({
    mutationFn: async (asset) => {
      const { data, error } = await findOrCreateClientProductArtworkFromAsset({
        tenantId: clientProduct?.tenant_id,
        clientProductId: clientProduct?.id,
        clientAssetId: asset.id,
        placement: effectivePlacement,
      });
      if (error) throw new Error(error);
      return data;
    },
    onSuccess: () => {
      toast.success("Artwork linked");
      setShowArtworkPicker(false);
      onArtworkLinked?.();
    },
    onError: (error) => toast.error(error.message || "Could not link artwork"),
  });

  const orderPriceIsOverride = showOrderPrice && form.default_sell_price !== "" && form.orderPrice !== ""
    && Number(form.orderPrice) !== Number(form.default_sell_price);

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-3">
      <Select
        value={form.component_type}
        onValueChange={(v) => set({
          component_type: v,
          inventory_product_id: v === "blank_garment" ? form.inventory_product_id : "",
          // UI strongly prefers once-off for setup fees (not forced at
          // the DB level - staff can still change it below).
          billing_mode: v === "setup_fee" && form.component_type !== "setup_fee" ? "once_per_order" : form.billing_mode,
        })}
      >
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {availableComponentTypes.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
        </SelectContent>
      </Select>

      {form.component_type === "blank_garment" && (
        <SearchSelect
          options={internalProducts}
          value={form.inventory_product_id}
          onChange={(id) => set({ inventory_product_id: id })}
          getLabel={(p) => p.internal_name || p.internal_code}
          placeholder="Search internal product (e.g. JET)"
        />
      )}

      {(form.component_type === "print_service" || form.component_type === "setup_fee") && (
        <div className="grid grid-cols-2 gap-2">
          <Select
            value={form.production_method || "__none"}
            onValueChange={(v) => {
              const method = v === "__none" ? "" : v;
              const def = pricingDefaultFor(method);
              set({
                production_method: method,
                default_sell_price: form.default_sell_price === "" && def?.default_sell_price != null ? String(def.default_sell_price) : form.default_sell_price,
                setupFee: form.setupFee === "" && def?.default_setup_fee != null ? String(def.default_setup_fee) : form.setupFee,
              });
            }}
          >
            <SelectTrigger><SelectValue placeholder="Method" /></SelectTrigger>
            <SelectContent>
              {PRINT_COMPONENT_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
          {form.component_type === "print_service" ? (
            <Select value={form.placement || "__none"} onValueChange={(v) => set({ placement: v === "__none" ? "" : v })}>
              <SelectTrigger><SelectValue placeholder="Placement" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">No placement</SelectItem>
                {PLACEMENT_PRESETS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                <SelectItem value="__custom">Custom…</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            methodDefault?.default_setup_fee != null && (
              <p className="flex items-center text-xs text-slate-500">Suggested setup: R{methodDefault.default_setup_fee}</p>
            )
          )}
        </div>
      )}
      {form.component_type === "print_service" && form.placement === "__custom" && (
        <Input
          placeholder="Custom placement"
          value={form.placementCustom}
          onChange={(e) => set({ placementCustom: e.target.value })}
        />
      )}

      <div className="grid grid-cols-[1fr_80px] gap-2">
        <Input
          placeholder="Label (e.g. Front DTF print)"
          value={form.label}
          onChange={(e) => set({ label: e.target.value })}
        />
        <Input
          type="number"
          min="1"
          placeholder="Qty"
          value={form.quantity_per_unit}
          onChange={(e) => set({ quantity_per_unit: e.target.value })}
          disabled={form.billing_mode === "once_per_order"}
          title={form.billing_mode === "once_per_order" ? "Once-off components are always ×1" : undefined}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Input
            type="number"
            min="0"
            step="0.01"
            placeholder="Client-product default price"
            value={form.default_sell_price}
            onChange={(e) => set({ default_sell_price: e.target.value })}
          />
          {showOrderPrice && <p className="mt-0.5 text-[10px] text-slate-400">Reusable default - saved to Catalog Management, unaffected by the order price below.</p>}
        </div>
        <Select value={form.billing_mode} onValueChange={(v) => set({ billing_mode: v, quantity_per_unit: v === "once_per_order" ? 1 : form.quantity_per_unit })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {BILLING_MODES.map((b) => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {showOrderPrice && (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-primary/30 bg-primary/5 p-2">
          <span className="text-xs text-slate-500 whitespace-nowrap">
            Default {form.default_sell_price !== "" ? `R${form.default_sell_price}` : "—"}
          </span>
          <Input
            type="number"
            min="0"
            step="0.01"
            placeholder="Order price"
            value={form.orderPrice}
            onChange={(e) => set({ orderPrice: e.target.value })}
            className="h-8 flex-1"
          />
          {orderPriceIsOverride && (
            <span className="whitespace-nowrap rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Order override</span>
          )}
        </div>
      )}

      <Input
        placeholder="Production colour (optional)"
        value={form.production_colour}
        onChange={(e) => set({ production_colour: e.target.value })}
      />
      <Textarea
        placeholder="Specification (optional)"
        value={form.specification}
        onChange={(e) => set({ specification: e.target.value })}
        className="min-h-[50px] text-sm"
      />
      <Textarea
        placeholder="Production instructions (optional)"
        value={form.production_instructions}
        onChange={(e) => set({ production_instructions: e.target.value })}
        className="min-h-[50px] text-sm"
      />
      <Textarea
        placeholder="Internal notes (optional)"
        value={form.notes}
        onChange={(e) => set({ notes: e.target.value })}
        className="min-h-[40px] text-sm"
      />

      {form.component_type === "print_service" && (
        <label className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={form.setupRequired}
            onChange={(e) => set({ setupRequired: e.target.checked })}
          />
          Setup required for this method
          {form.setupRequired && (
            <Input
              type="number"
              min="0"
              step="0.01"
              placeholder={methodDefault?.default_setup_fee != null ? `Suggested R${methodDefault.default_setup_fee}` : "Setup fee"}
              value={form.setupFee}
              onChange={(e) => set({ setupFee: e.target.value })}
              className="h-7 w-28"
            />
          )}
        </label>
      )}

      {allowArtworkLinking && form.component_type === "print_service" && effectivePlacement && (
        <div className="rounded-lg border border-dashed border-slate-300 p-2 text-xs">
          {linkedArtwork ? (
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-slate-700">
                Artwork: {linkedArtwork.file_name || "linked file"}
                <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                  linkedArtwork.status === "approved" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                }`}>
                  {linkedArtwork.status}
                </span>
              </span>
              <Button type="button" size="sm" variant="outline" onClick={() => setShowArtworkPicker(true)} disabled={!clientProduct?.id}>
                Change
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-500">No artwork linked for {effectivePlacement}</span>
              <Button type="button" size="sm" variant="outline" onClick={() => setShowArtworkPicker(true)} disabled={!clientProduct?.id}>
                Select artwork
              </Button>
            </div>
          )}
        </div>
      )}
      {allowArtworkLinking && showArtworkPicker && (
        <ClientAssetPickerModal
          clientId={clientProduct?.client_id}
          selectionMode="single"
          defaultCategory="Artwork"
          showApprovalBadge
          title="Select artwork"
          description={`Browsing this client's approved/current files. The selected file becomes the current revision for ${effectivePlacement || "this placement"} - nothing is re-uploaded.`}
          confirmVerb="Use"
          onClose={() => setShowArtworkPicker(false)}
          onConfirm={([asset]) => asset && artworkMutation.mutate(asset)}
        />
      )}
    </div>
  );
}
