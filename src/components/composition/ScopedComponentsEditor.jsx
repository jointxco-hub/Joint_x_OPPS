import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2, Plus } from "lucide-react";
import { dataClient } from "@/api/dataClient";
import { PLACEMENT_PRESETS, PRINT_COMPONENT_METHODS } from "@/lib/productionStages";
import { buildComponentPayload, buildSetupFeeCompanionPayload, filterComponentsByScope } from "@/lib/productComposition";
import ComponentFieldsForm, { COMPONENT_TYPES, emptyComponentForm } from "@/components/composition/ComponentFieldsForm";

// Phase 2B Step 3 - one shared list/add/edit editor for product_components,
// parameterized by scope ({type:'family'|'variant'|'treatment', id}).
// Extracted from CatalogManagement's original family-only inline block so
// the family, variant, and treatment editors never drift on behaviour -
// see productComposition.js's filterComponentsByScope/buildComponentPayload
// for how scope is resolved and enforced on every write.
//
// Artwork awareness is scope-gated HERE, not left to each caller to
// remember: the existing family artwork-linking path (find_or_create_
// client_product_artwork_from_asset via ComponentFieldsForm) only
// understands treatment_id IS NULL family rows. Passing that same
// currentArtwork/onArtworkLinked into a variant- or treatment-scoped
// instance would be misleading (family artwork state rendered as if it
// were that variant's/treatment's own) and would let staff invoke a
// linking action that writes family-level artwork from inside what looks
// like a treatment-scoped editor. So: family scope keeps existing
// behaviour unchanged; variant and treatment scope both ignore whatever
// currentArtwork/onArtworkLinked the caller passes (defensively, even if
// a caller forgets to omit them) and never render the artwork-linking
// control or the "no approved artwork" warning. Treatment artwork state
// is shown separately, read-only, by TreatmentArtworkState - variant
// composition does not own artwork at all (see GarmentVariantsSection,
// which renders no artwork surface for its ScopedComponentsEditor
// instance).
//
// onBusyChange(isAddingOrEditing) - the add/edit form state now lives in
// here rather than in the parent, but CatalogManagement's family instance
// still needs to know whether it's open (to hide "Duplicate composition"
// while a form is mid-edit, exactly as before this was extracted).
export default function ScopedComponentsEditor({
  clientProductId, scope, allComponents, queryKeyForInvalidation,
  internalProducts, pricingDefaultFor, clientProduct, currentArtwork, onArtworkLinked,
  addLabel = "Add component", emptyLabel = "No components yet.",
  excludeComponentTypes = [], onBusyChange,
}) {
  const queryClient = useQueryClient();
  const [addingComponent, setAddingComponent] = useState(false);
  const [newComponent, setNewComponent] = useState(emptyComponentForm());
  const [editingComponentId, setEditingComponentId] = useState("");
  const [editComponentForm, setEditComponentForm] = useState(emptyComponentForm());

  useEffect(() => {
    onBusyChange?.(addingComponent || Boolean(editingComponentId));
  }, [addingComponent, editingComponentId, onBusyChange]);

  const scopedComponents = filterComponentsByScope(allComponents, scope);
  const activeComponents = scopedComponents.filter((c) => c.is_active !== false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeyForInvalidation });

  // Only family scope (the default, and CatalogManagement's own instance)
  // may treat currentArtwork/onArtworkLinked as meaningful - see the
  // module header for why variant/treatment scope discard them entirely.
  const artworkAware = !scope || scope.type === "family";
  const scopedCurrentArtwork = artworkAware ? currentArtwork : undefined;
  const scopedOnArtworkLinked = artworkAware ? onArtworkLinked : undefined;

  const internalProductLabel = (id) => internalProducts.find((p) => p.id === id)?.internal_name || internalProducts.find((p) => p.id === id)?.internal_code || "Unmapped";
  const hasApprovedArtwork = (placement) => !artworkAware || !placement
    ? null
    : (Array.isArray(scopedCurrentArtwork) ? scopedCurrentArtwork : []).some((a) => a.placement === placement && a.status === 'approved');

  const createSetupFeeCompanion = async (printForm) => {
    const method = printForm.production_method;
    const methodLabel = PRINT_COMPONENT_METHODS.find((m) => m.value === method)?.label || method;
    await dataClient.entities.ProductComponent.create({
      ...buildSetupFeeCompanionPayload(printForm, {
        clientProductId,
        sortOrder: activeComponents.length + 1,
        methodLabel,
        productionDefault: pricingDefaultFor(method),
      }),
      ...(scope?.type === "variant" ? { garment_variant_id: scope.id, treatment_id: null }
        : scope?.type === "treatment" ? { garment_variant_id: null, treatment_id: scope.id }
        : { garment_variant_id: null, treatment_id: null }),
    });
  };

  const createComponentMutation = useMutation({
    mutationFn: async (form) => {
      const created = await dataClient.entities.ProductComponent.create(
        buildComponentPayload(form, { clientProductId, sortOrder: activeComponents.length, scope })
      );
      if (form.component_type === "print_service" && form.setupRequired && form.production_method) {
        await createSetupFeeCompanion(form);
      }
      return created;
    },
    onSuccess: () => {
      invalidate();
      setAddingComponent(false);
      setNewComponent(emptyComponentForm());
      toast.success("Component added");
    },
    onError: () => toast.error("Could not add component"),
  });

  const updateComponentMutation = useMutation({
    mutationFn: ({ id, form }) => dataClient.entities.ProductComponent.update(
      id, buildComponentPayload(form, { clientProductId, sortOrder: undefined, scope })
    ),
    onSuccess: () => {
      invalidate();
      setEditingComponentId("");
      toast.success("Component updated");
    },
    onError: () => toast.error("Could not update component"),
  });

  const removeComponentMutation = useMutation({
    mutationFn: (id) => dataClient.entities.ProductComponent.update(id, { is_active: false }),
    onSuccess: () => {
      invalidate();
      toast.success("Component removed");
    },
    onError: () => toast.error("Could not remove component"),
  });

  const startEditingComponent = (component) => {
    setAddingComponent(false);
    setEditingComponentId(component.id);
    const knownPlacement = PLACEMENT_PRESETS.includes(component.placement);
    setEditComponentForm({
      ...emptyComponentForm(),
      component_type: component.component_type,
      inventory_product_id: component.inventory_product_id || "",
      fixed_inventory_variant_id: component.fixed_inventory_variant_id || "",
      quantity_per_unit: component.quantity_per_unit ?? 1,
      default_sell_price: component.default_sell_price ?? "",
      billing_mode: component.billing_mode || "per_unit",
      production_method: component.production_method || "",
      placement: component.placement ? (knownPlacement ? component.placement : "__custom") : "",
      placementCustom: component.placement && !knownPlacement ? component.placement : "",
      production_colour: component.production_colour || "",
      specification: component.specification || "",
      production_instructions: component.production_instructions || "",
      label: component.label || "",
      notes: component.notes || "",
    });
  };

  return (
    <div className="space-y-1.5">
      {activeComponents.length === 0 && !addingComponent && (
        <p className="text-xs text-slate-400">{emptyLabel}</p>
      )}

      {activeComponents.length > 0 && (
        <div className="space-y-1.5">
          {activeComponents.map((component) => (
            editingComponentId === component.id ? (
              <div key={component.id} className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                <ComponentFieldsForm
                  form={editComponentForm}
                  setForm={setEditComponentForm}
                  internalProducts={internalProducts}
                  pricingDefaultFor={pricingDefaultFor}
                  clientProduct={clientProduct}
                  currentArtwork={scopedCurrentArtwork}
                  onArtworkLinked={scopedOnArtworkLinked}
                  excludeComponentTypes={excludeComponentTypes}
                  allowArtworkLinking={artworkAware}
                />
                <div className="mt-2 flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => setEditingComponentId("")}>Cancel</Button>
                  <Button
                    size="sm"
                    className="flex-1"
                    disabled={updateComponentMutation.isPending || (editComponentForm.component_type === "blank_garment" && !editComponentForm.inventory_product_id)}
                    onClick={() => updateComponentMutation.mutate({ id: component.id, form: editComponentForm })}
                  >
                    Save changes
                  </Button>
                </div>
              </div>
            ) : (
              <div key={component.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <span className="font-medium text-slate-800">
                    {COMPONENT_TYPES.find((t) => t.value === component.component_type)?.label || component.component_type}
                  </span>
                  {component.placement && <span className="ml-1.5 text-slate-500">- {component.placement}</span>}
                  {component.inventory_product_id && (
                    <span className="ml-1.5 text-slate-500">- {internalProductLabel(component.inventory_product_id)}</span>
                  )}
                  {component.label && <span className="ml-1.5 text-slate-500">({component.label})</span>}
                  {component.billing_mode === "once_per_order" ? (
                    <span className="ml-1.5 text-slate-400">R{component.default_sell_price} ×1 once-off</span>
                  ) : (
                    <>
                      <span className="ml-1.5 text-slate-400">x{component.quantity_per_unit}</span>
                      {component.default_sell_price != null && (
                        <span className="ml-1.5 text-slate-400">R{component.default_sell_price}</span>
                      )}
                    </>
                  )}
                  {component.placement && hasApprovedArtwork(component.placement) === false && (
                    <span className="ml-1.5 text-amber-600">no approved artwork</span>
                  )}
                </div>
                <div className="flex flex-shrink-0 items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEditingComponent(component)}>
                    <Pencil className="h-3.5 w-3.5 text-slate-500" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => removeComponentMutation.mutate(component.id)}
                    disabled={removeComponentMutation.isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-red-400" />
                  </Button>
                </div>
              </div>
            )
          ))}
        </div>
      )}

      {addingComponent ? (
        <div>
          <ComponentFieldsForm
            form={newComponent}
            setForm={setNewComponent}
            internalProducts={internalProducts}
            pricingDefaultFor={pricingDefaultFor}
            clientProduct={clientProduct}
            currentArtwork={scopedCurrentArtwork}
            onArtworkLinked={scopedOnArtworkLinked}
            excludeComponentTypes={excludeComponentTypes}
            allowArtworkLinking={artworkAware}
          />
          <div className="mt-2 flex gap-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={() => { setAddingComponent(false); setNewComponent(emptyComponentForm()); }}>Cancel</Button>
            <Button
              size="sm"
              className="flex-1"
              disabled={createComponentMutation.isPending || (newComponent.component_type === "blank_garment" && !newComponent.inventory_product_id)}
              onClick={() => createComponentMutation.mutate(newComponent)}
            >
              Add component
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" size="sm" className="w-full" onClick={() => { setEditingComponentId(""); setAddingComponent(true); }}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> {addLabel}
        </Button>
      )}
    </div>
  );
}
