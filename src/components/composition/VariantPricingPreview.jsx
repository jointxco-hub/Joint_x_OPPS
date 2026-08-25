import { useQuery } from "@tanstack/react-query";
import { dataClient } from "@/api/dataClient";

// Phase 2B Step 3 - staff-only pricing preview, no checkout/order pricing
// change. base = variant.price_override ?? family.client_price; effective
// = base + treatment.surcharge, shown per active allowed treatment.
export default function VariantPricingPreview({ variant, clientProduct }) {
  const { data: mappings = [] } = useQuery({
    queryKey: ["variantTreatmentMappings", variant.id],
    queryFn: () => dataClient.entities.VariantTreatmentMapping.filter({ garment_variant_id: variant.id }, "created_at", 200),
    enabled: Boolean(variant.id),
  });
  const { data: familyTreatments = [] } = useQuery({
    queryKey: ["treatmentsForFamily", clientProduct?.id],
    queryFn: () => dataClient.entities.Treatment.filter({ client_product_id: clientProduct.id }, "name", 200),
    enabled: Boolean(clientProduct?.id),
  });

  const base = variant.price_override ?? clientProduct?.client_price ?? null;
  const activeTreatmentIds = mappings.filter((m) => m.is_active).map((m) => m.treatment_id);
  const activeTreatments = familyTreatments.filter((t) => activeTreatmentIds.includes(t.id));

  if (base == null) return null;

  return (
    <div className="rounded-lg bg-slate-50 p-2 text-xs text-slate-600 space-y-0.5">
      <p className="font-medium text-slate-500">Pricing preview</p>
      <p>
        {variant.price_override != null ? `Variant R${base}` : `Family R${base}`}
      </p>
      {activeTreatments.length === 0 ? (
        <p className="text-slate-400">No treatments allowed yet.</p>
      ) : (
        activeTreatments.map((t) => (
          <p key={t.id}>
            + {t.name} surcharge R{t.surcharge ?? 0} = <span className="font-semibold text-slate-800">R{base + Number(t.surcharge ?? 0)}</span>
          </p>
        ))
      )}
    </div>
  );
}
