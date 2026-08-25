import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { dataClient } from "@/api/dataClient";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2, Plus, Copy, ChevronDown, ChevronRight } from "lucide-react";
import TreatmentForm from "@/components/composition/TreatmentForm";
import DuplicateTreatmentModal from "@/components/composition/DuplicateTreatmentModal";
import ScopedComponentsEditor from "@/components/composition/ScopedComponentsEditor";
import TreatmentArtworkState from "@/components/composition/TreatmentArtworkState";
import { emptyTreatmentForm, buildTreatmentPayload } from "@/lib/garmentVariantTreatmentPayloads";
import { toStaffMessage } from "@/lib/pgErrorMessages";

// Phase 2B Step 3 - Treatments subsection of Catalog Management's
// Composition panel. Mirrors GarmentVariantsSection's structure exactly
// (list/add/edit/duplicate/disable, expandable detail) - see that file
// for the shared design rationale.
// No currentArtwork/onArtworkLinked props - the family artwork-linking
// path never applies here. Treatment artwork state is handled entirely
// by TreatmentArtworkState (its own scoped query + the X LAB Admin deep
// link), not by feeding family data into ScopedComponentsEditor.
export default function TreatmentsSection({
  clientProductId, clientProduct, internalProducts, pricingDefaultFor, allComponents,
}) {
  const queryClient = useQueryClient();
  const [addingTreatment, setAddingTreatment] = useState(false);
  const [newTreatment, setNewTreatment] = useState(emptyTreatmentForm());
  const [editingTreatmentId, setEditingTreatmentId] = useState("");
  const [editTreatmentForm, setEditTreatmentForm] = useState(emptyTreatmentForm());
  const [expandedTreatmentId, setExpandedTreatmentId] = useState("");
  const [duplicatingTreatment, setDuplicatingTreatment] = useState(null);

  const treatmentsQueryKey = ["treatmentsForFamily", clientProductId];
  const { data: treatments = [] } = useQuery({
    queryKey: treatmentsQueryKey,
    queryFn: () => dataClient.entities.Treatment.filter({ client_product_id: clientProductId }, "sort_order", 200),
    enabled: Boolean(clientProductId),
  });

  const mappingCountsQueryKey = ["variantTreatmentMappingsForFamily", clientProductId];
  const { data: allMappings = [] } = useQuery({
    queryKey: mappingCountsQueryKey,
    queryFn: () => dataClient.entities.VariantTreatmentMapping.filter({ client_product_id: clientProductId }, "created_at", 500),
    enabled: Boolean(clientProductId),
  });
  const allowedVariantCount = (treatmentId) => allMappings.filter((m) => m.treatment_id === treatmentId && m.is_active).length;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: treatmentsQueryKey });
    queryClient.invalidateQueries({ queryKey: mappingCountsQueryKey });
  };

  // duplicate_treatment creates a new treatment row and clones treatment-
  // scoped product_components (intentionally zero mappings/artwork -
  // invalidating the mapping-count query here is harmless and keeps both
  // list counts in sync regardless).
  const invalidateAfterDuplicate = () => {
    invalidate();
    queryClient.invalidateQueries({ queryKey: ["productComponents", clientProductId] });
  };

  const createMutation = useMutation({
    mutationFn: (form) => dataClient.entities.Treatment.create(buildTreatmentPayload(form, { clientProductId, sortOrder: treatments.length })),
    onSuccess: () => {
      invalidate();
      setAddingTreatment(false);
      setNewTreatment(emptyTreatmentForm());
      toast.success("Treatment added");
    },
    onError: (error) => toast.error(toStaffMessage(error.message)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, form }) => dataClient.entities.Treatment.update(id, buildTreatmentPayload(form, { clientProductId })),
    onSuccess: () => {
      invalidate();
      setEditingTreatmentId("");
      toast.success("Treatment updated");
    },
    onError: (error) => toast.error(toStaffMessage(error.message)),
  });

  const setActiveMutation = useMutation({
    mutationFn: ({ id, is_active }) => dataClient.entities.Treatment.update(id, { is_active }),
    onSuccess: (_, { is_active }) => {
      invalidate();
      toast.success(is_active ? "Treatment re-enabled" : "Treatment disabled");
    },
    onError: (error) => toast.error(toStaffMessage(error.message)),
  });

  const startEditing = (treatment) => {
    setAddingTreatment(false);
    setEditingTreatmentId(treatment.id);
    setEditTreatmentForm({
      name: treatment.name || "",
      print_colour: treatment.print_colour || "",
      production_method: treatment.production_method || "",
      primary_placement: treatment.primary_placement || "",
      print_size: treatment.print_size || "",
      surcharge: treatment.surcharge ?? "",
      production_instructions: treatment.production_instructions || "",
      sort_order: treatment.sort_order ?? 0,
      is_active: treatment.is_active !== false,
    });
  };

  return (
    <div className="space-y-2 rounded-xl border border-slate-200 p-4">
      <p className="text-sm font-semibold text-slate-800">Treatments</p>
      <p className="text-xs text-slate-500">Reusable print/production treatments for this product family - configure once, duplicate, then edit only what differs.</p>

      {treatments.length === 0 && !addingTreatment && (
        <p className="text-xs text-slate-400 rounded-lg bg-slate-50 px-3 py-2">No treatments configured yet.</p>
      )}

      {treatments.length > 0 && (
        <div className="space-y-1.5">
          {treatments.map((treatment) => {
            const isExpanded = expandedTreatmentId === treatment.id;
            return (
              <div key={treatment.id} className={`rounded-lg border ${treatment.is_active === false ? "border-slate-200 bg-slate-50 opacity-60" : "border-slate-200 bg-white"}`}>
                {editingTreatmentId === treatment.id ? (
                  <div className="p-3">
                    <TreatmentForm form={editTreatmentForm} setForm={setEditTreatmentForm} />
                    <div className="mt-2 flex gap-2">
                      <Button variant="outline" size="sm" className="flex-1" onClick={() => setEditingTreatmentId("")}>Cancel</Button>
                      <Button
                        size="sm"
                        className="flex-1"
                        disabled={updateMutation.isPending || !editTreatmentForm.name.trim()}
                        onClick={() => updateMutation.mutate({ id: treatment.id, form: editTreatmentForm })}
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
                        onClick={() => setExpandedTreatmentId(isExpanded ? "" : treatment.id)}
                      >
                        {isExpanded ? <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />}
                        <span className="min-w-0">
                          <span className="font-medium text-slate-800">{treatment.name}</span>
                          {treatment.print_colour && <span className="ml-1.5 text-slate-500">- {treatment.print_colour}</span>}
                          {treatment.production_method && <span className="ml-1.5 text-slate-400">{treatment.production_method}</span>}
                          {treatment.surcharge != null && Number(treatment.surcharge) > 0 && <span className="ml-1.5 text-slate-400">+R{treatment.surcharge}</span>}
                          <span className="ml-1.5 text-slate-400">{allowedVariantCount(treatment.id)} garment{allowedVariantCount(treatment.id) === 1 ? "" : "s"}</span>
                          {treatment.is_active === false && <span className="ml-1.5 rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">Inactive</span>}
                        </span>
                      </button>
                      <div className="flex flex-shrink-0 items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDuplicatingTreatment(treatment)} title="Duplicate">
                          <Copy className="h-3.5 w-3.5 text-slate-500" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEditing(treatment)} title="Edit">
                          <Pencil className="h-3.5 w-3.5 text-slate-500" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => {
                            const reEnabling = treatment.is_active === false;
                            if (!reEnabling && !window.confirm(`Disable "${treatment.name}"? Existing components, mappings, and artwork are kept - it just becomes unavailable for future ordering.`)) return;
                            setActiveMutation.mutate({ id: treatment.id, is_active: reEnabling });
                          }}
                          disabled={setActiveMutation.isPending}
                          title={treatment.is_active === false ? "Re-enable" : "Disable"}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-400" />
                        </Button>
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="space-y-3 border-t border-slate-100 p-3">
                        <div>
                          <p className="mb-1 text-xs font-medium text-slate-500">Production components for this treatment</p>
                          {/* Deliberately no currentArtwork/onArtworkLinked here - see
                              module header. Artwork state is TreatmentArtworkState, below. */}
                          <ScopedComponentsEditor
                            clientProductId={clientProductId}
                            scope={{ type: "treatment", id: treatment.id }}
                            allComponents={allComponents}
                            queryKeyForInvalidation={["productComponents", clientProductId]}
                            internalProducts={internalProducts}
                            pricingDefaultFor={pricingDefaultFor}
                            clientProduct={clientProduct}
                            addLabel="Add component"
                            emptyLabel="No components for this treatment yet."
                            excludeComponentTypes={["blank_garment"]}
                          />
                        </div>
                        <div>
                          <p className="mb-1 text-xs font-medium text-slate-500">Artwork</p>
                          <TreatmentArtworkState treatmentId={treatment.id} clientProductId={clientProductId} />
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {addingTreatment ? (
        <div>
          <TreatmentForm form={newTreatment} setForm={setNewTreatment} />
          <div className="mt-2 flex gap-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={() => { setAddingTreatment(false); setNewTreatment(emptyTreatmentForm()); }}>Cancel</Button>
            <Button
              size="sm"
              className="flex-1"
              disabled={createMutation.isPending || !newTreatment.name.trim()}
              onClick={() => createMutation.mutate(newTreatment)}
            >
              Add treatment
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" size="sm" className="w-full" onClick={() => { setEditingTreatmentId(""); setAddingTreatment(true); }}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Add treatment
        </Button>
      )}

      {duplicatingTreatment && (
        <DuplicateTreatmentModal
          sourceTreatment={duplicatingTreatment}
          targetClientProductId={clientProductId}
          onClose={() => setDuplicatingTreatment(null)}
          onSuccess={() => { invalidateAfterDuplicate(); setDuplicatingTreatment(null); }}
        />
      )}
    </div>
  );
}
