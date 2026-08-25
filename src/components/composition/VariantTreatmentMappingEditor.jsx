import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { dataClient } from "@/api/dataClient";
import { toast } from "sonner";
import { toStaffMessage } from "@/lib/pgErrorMessages";

// Phase 2B Step 3 - "Allowed Treatments" for one garment variant, backed
// by client_product_variant_treatments. Upsert-by-existence: toggling a
// checkbox never blindly INSERTs - it looks up whether ANY mapping row
// (active or inactive) already exists for this (variant, treatment) pair
// first, and either flips its is_active flag or creates exactly one new
// row, so a variant+treatment pair can never end up with two rows.
// Inactive historical mappings are fetched (not filtered to active-only)
// so re-checking a previously-unchecked box re-activates the SAME row
// instead of creating a duplicate.
export default function VariantTreatmentMappingEditor({ variantId, clientProductId, tenantId }) {
  const queryClient = useQueryClient();

  const { data: familyTreatments = [] } = useQuery({
    queryKey: ["treatmentsForFamily", clientProductId],
    queryFn: () => dataClient.entities.Treatment.filter({ client_product_id: clientProductId }, "name", 200),
    enabled: Boolean(clientProductId),
  });

  // Includes inactive mappings deliberately - see header comment.
  const { data: mappings = [] } = useQuery({
    queryKey: ["variantTreatmentMappings", variantId],
    queryFn: () => dataClient.entities.VariantTreatmentMapping.filter({ garment_variant_id: variantId }, "created_at", 200),
    enabled: Boolean(variantId),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["variantTreatmentMappings", variantId] });
    queryClient.invalidateQueries({ queryKey: ["garmentVariants", clientProductId] });
  };

  const toggleMutation = useMutation({
    mutationFn: async ({ treatment, existingMapping, nextChecked }) => {
      if (existingMapping) {
        return dataClient.entities.VariantTreatmentMapping.update(existingMapping.id, { is_active: nextChecked });
      }
      return dataClient.entities.VariantTreatmentMapping.create({
        client_product_id: clientProductId,
        garment_variant_id: variantId,
        treatment_id: treatment.id,
        is_active: true,
        tenant_id: tenantId,
      });
    },
    onSuccess: invalidate,
    onError: (error) => toast.error(toStaffMessage(error.message)),
  });

  const activeTreatments = familyTreatments.filter((t) => t.is_active !== false);
  const inactiveTreatments = familyTreatments.filter((t) => t.is_active === false);
  const orderedTreatments = [...activeTreatments, ...inactiveTreatments];

  if (familyTreatments.length === 0) {
    return <p className="text-xs text-slate-400">No treatments exist yet for this product family.</p>;
  }

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-slate-500">Allowed treatments</p>
      <div className="space-y-1">
        {orderedTreatments.map((treatment) => {
          const existingMapping = mappings.find((m) => m.treatment_id === treatment.id);
          const checked = existingMapping?.is_active === true;
          return (
            <label
              key={treatment.id}
              className={`flex items-center gap-2 text-sm rounded-lg px-2 py-1 ${treatment.is_active === false ? "text-slate-400" : "text-slate-700"}`}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={toggleMutation.isPending}
                onChange={(e) => toggleMutation.mutate({ treatment, existingMapping, nextChecked: e.target.checked })}
              />
              {treatment.name}
              {treatment.is_active === false && <span className="text-[10px] text-slate-400">(inactive treatment)</span>}
            </label>
          );
        })}
      </div>
    </div>
  );
}
