import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { dataClient } from "@/api/dataClient";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2, Plus, Copy, ChevronDown, ChevronRight } from "lucide-react";
import GarmentVariantForm, { emptyGarmentVariantForm } from "@/components/composition/GarmentVariantForm";
import DuplicateGarmentVariantModal from "@/components/composition/DuplicateGarmentVariantModal";
import ScopedComponentsEditor from "@/components/composition/ScopedComponentsEditor";
import VariantTreatmentMappingEditor from "@/components/composition/VariantTreatmentMappingEditor";
import VariantPricingPreview from "@/components/composition/VariantPricingPreview";
import { buildGarmentVariantPayload } from "@/lib/garmentVariantTreatmentPayloads";
import { toStaffMessage } from "@/lib/pgErrorMessages";

// Phase 2B Step 3 - Garment Variants subsection of Catalog Management's
// Composition panel. Zero variants -> the family's existing simple-
// product composition (rendered separately, above this section) remains
// the primary flow, unchanged - this section only ever ADDS an optional
// per-variant layer, never forces a simple product into variant setup.
export default function GarmentVariantsSection({
  clientProductId, clientProduct, internalProducts, pricingDefaultFor, allComponents, currentArtwork, onArtworkLinked,
}) {
  const queryClient = useQueryClient();
  const [addingVariant, setAddingVariant] = useState(false);
  const [newVariant, setNewVariant] = useState(emptyGarmentVariantForm());
  const [editingVariantId, setEditingVariantId] = useState("");
  const [editVariantForm, setEditVariantForm] = useState(emptyGarmentVariantForm());
  const [expandedVariantId, setExpandedVariantId] = useState("");
  const [duplicatingVariant, setDuplicatingVariant] = useState(null);

  const variantsQueryKey = ["garmentVariants", clientProductId];
  const { data: variants = [] } = useQuery({
    queryKey: variantsQueryKey,
    queryFn: () => dataClient.entities.GarmentVariant.filter({ client_product_id: clientProductId }, "sort_order", 200),
    enabled: Boolean(clientProductId),
  });

  const mappingCountsQueryKey = ["variantTreatmentMappingsForFamily", clientProductId];
  const { data: allMappings = [] } = useQuery({
    queryKey: mappingCountsQueryKey,
    queryFn: () => dataClient.entities.VariantTreatmentMapping.filter({ client_product_id: clientProductId }, "created_at", 500),
    enabled: Boolean(clientProductId),
  });
  const allowedTreatmentCount = (variantId) => allMappings.filter((m) => m.garment_variant_id === variantId && m.is_active).length;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: variantsQueryKey });

  const createMutation = useMutation({
    mutationFn: (form) => dataClient.entities.GarmentVariant.create(buildGarmentVariantPayload(form, { clientProductId, sortOrder: variants.length })),
    onSuccess: () => {
      invalidate();
      setAddingVariant(false);
      setNewVariant(emptyGarmentVariantForm());
      toast.success("Garment variant added");
    },
    onError: (error) => toast.error(toStaffMessage(error.message)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, form }) => dataClient.entities.GarmentVariant.update(id, buildGarmentVariantPayload(form, { clientProductId })),
    onSuccess: () => {
      invalidate();
      setEditingVariantId("");
      toast.success("Garment variant updated");
    },
    onError: (error) => toast.error(toStaffMessage(error.message)),
  });

  const setActiveMutation = useMutation({
    mutationFn: ({ id, is_active }) => dataClient.entities.GarmentVariant.update(id, { is_active }),
    onSuccess: (_, { is_active }) => {
      invalidate();
      toast.success(is_active ? "Variant re-enabled" : "Variant disabled");
    },
    onError: (error) => toast.error(toStaffMessage(error.message)),
  });

  const startEditing = (variant) => {
    setAddingVariant(false);
    setEditingVariantId(variant.id);
    setEditVariantForm({
      name: variant.name || "",
      inventory_product_id: variant.inventory_product_id || "",
      colour_name: variant.colour_name || "",
      manual_available_sizes: Array.isArray(variant.manual_available_sizes) ? variant.manual_available_sizes.join(", ") : "",
      price_override: variant.price_override ?? "",
      sort_order: variant.sort_order ?? 0,
      notes: variant.notes || "",
      is_active: variant.is_active !== false,
    });
  };

  const internalProductLabel = (id) => internalProducts.find((p) => p.id === id)?.internal_name || internalProducts.find((p) => p.id === id)?.internal_code || "Unmapped";
  const gsmFor = (id) => internalProducts.find((p) => p.id === id)?.weight_gsm;

  return (
    <div className="space-y-2 rounded-xl border border-slate-200 p-4">
      <p className="text-sm font-semibold text-slate-800">Garment Variants</p>
      <p className="text-xs text-slate-500">Reusable blank/garment configurations for this product family - configure once, duplicate, then edit only what differs.</p>

      {variants.length === 0 && !addingVariant && (
        <p className="text-xs text-slate-400 rounded-lg bg-slate-50 px-3 py-2">
          No garment variants configured - this product uses the standard product setup above.
        </p>
      )}

      {variants.length > 0 && (
        <div className="space-y-1.5">
          {variants.map((variant) => {
            const isExpanded = expandedVariantId === variant.id;
            const effectivePrice = variant.price_override ?? clientProduct?.client_price;
            return (
              <div key={variant.id} className={`rounded-lg border ${variant.is_active === false ? "border-slate-200 bg-slate-50 opacity-60" : "border-slate-200 bg-white"}`}>
                {editingVariantId === variant.id ? (
                  <div className="p-3">
                    <GarmentVariantForm form={editVariantForm} setForm={setEditVariantForm} internalProducts={internalProducts} />
                    <div className="mt-2 flex gap-2">
                      <Button variant="outline" size="sm" className="flex-1" onClick={() => setEditingVariantId("")}>Cancel</Button>
                      <Button
                        size="sm"
                        className="flex-1"
                        disabled={updateMutation.isPending || !editVariantForm.name.trim()}
                        onClick={() => updateMutation.mutate({ id: variant.id, form: editVariantForm })}
                      >
                        Save changes
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-2 px-3 py-2">
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm"
                        onClick={() => setExpandedVariantId(isExpanded ? "" : variant.id)}
                      >
                        {isExpanded ? <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />}
                        <span className="min-w-0">
                          <span className="font-medium text-slate-800">{variant.name}</span>
                          {variant.inventory_product_id && <span className="ml-1.5 text-slate-500">- {internalProductLabel(variant.inventory_product_id)}</span>}
                          {gsmFor(variant.inventory_product_id) && <span className="ml-1.5 text-slate-400">{gsmFor(variant.inventory_product_id)}gsm</span>}
                          {variant.colour_name && <span className="ml-1.5 text-slate-400">/ {variant.colour_name}</span>}
                          <span className="ml-1.5 text-slate-400">R{effectivePrice ?? "—"}</span>
                          <span className="ml-1.5 text-slate-400">{allowedTreatmentCount(variant.id)} treatment{allowedTreatmentCount(variant.id) === 1 ? "" : "s"}</span>
                          {variant.is_active === false && <span className="ml-1.5 rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">Inactive</span>}
                        </span>
                      </button>
                      <div className="flex flex-shrink-0 items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDuplicatingVariant(variant)} title="Duplicate">
                          <Copy className="h-3.5 w-3.5 text-slate-500" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEditing(variant)} title="Edit">
                          <Pencil className="h-3.5 w-3.5 text-slate-500" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => {
                            const reEnabling = variant.is_active === false;
                            if (!reEnabling && !window.confirm(`Disable "${variant.name}"? Existing components, mappings, and artwork are kept - it just becomes unavailable for future ordering.`)) return;
                            setActiveMutation.mutate({ id: variant.id, is_active: reEnabling });
                          }}
                          disabled={setActiveMutation.isPending}
                          title={variant.is_active === false ? "Re-enable" : "Disable"}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-400" />
                        </Button>
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="space-y-3 border-t border-slate-100 p-3">
                        <div>
                          <p className="mb-1 text-xs font-medium text-slate-500">Production components for this garment variant</p>
                          <ScopedComponentsEditor
                            clientProductId={clientProductId}
                            scope={{ type: "variant", id: variant.id }}
                            allComponents={allComponents}
                            queryKeyForInvalidation={["productComponents", clientProductId]}
                            internalProducts={internalProducts}
                            pricingDefaultFor={pricingDefaultFor}
                            clientProduct={clientProduct}
                            currentArtwork={currentArtwork}
                            onArtworkLinked={onArtworkLinked}
                            addLabel="Add component"
                            emptyLabel="No components for this variant yet."
                          />
                        </div>
                        <VariantTreatmentMappingEditor
                          variantId={variant.id}
                          clientProductId={clientProductId}
                          tenantId={clientProduct?.tenant_id}
                        />
                        <VariantPricingPreview variant={variant} clientProduct={clientProduct} />
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {addingVariant ? (
        <div>
          <GarmentVariantForm form={newVariant} setForm={setNewVariant} internalProducts={internalProducts} />
          <div className="mt-2 flex gap-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={() => { setAddingVariant(false); setNewVariant(emptyGarmentVariantForm()); }}>Cancel</Button>
            <Button
              size="sm"
              className="flex-1"
              disabled={createMutation.isPending || !newVariant.name.trim()}
              onClick={() => createMutation.mutate(newVariant)}
            >
              Add variant
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" size="sm" className="w-full" onClick={() => { setEditingVariantId(""); setAddingVariant(true); }}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Add variant
        </Button>
      )}

      {duplicatingVariant && (
        <DuplicateGarmentVariantModal
          sourceVariant={duplicatingVariant}
          targetClientProductId={clientProductId}
          onClose={() => setDuplicatingVariant(null)}
          onSuccess={() => { invalidate(); setDuplicatingVariant(null); }}
        />
      )}
    </div>
  );
}
