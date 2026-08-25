import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toStaffMessage } from "@/lib/pgErrorMessages";

// Phase 2B Step 3 - calls the live duplicate_garment_variant RPC only,
// never clones client-side (see 20260826090000_garment_variant_treatment_
// duplication.sql for the authoritative server-side logic this UI only
// orchestrates). Mounted fresh each time "Duplicate" is clicked (the
// parent renders this conditionally on a single sourceVariant state) and
// unmounted on cancel/success - so the idempotency key below, generated
// once via useState's lazy initializer, is stable across retries within
// one duplication attempt but always fresh for a new intentional one.
// Matches the established convention in AddManagedBrandWizard/
// CommerceProductsSection.
export default function DuplicateGarmentVariantModal({ sourceVariant, targetClientProductId, onClose, onSuccess }) {
  const [name, setName] = useState(`${sourceVariant?.name || ""} (copy)`);
  const [idempotencyKey] = useState(() =>
    (typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : `dup-variant-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  );

  const duplicateMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("duplicate_garment_variant", {
        p_source_variant_id: sourceVariant.id,
        p_target_client_product_id: targetClientProductId,
        p_target_name: name,
        p_idempotency_key: idempotencyKey,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: (data) => {
      const parts = [];
      if (data.cloned_component_count != null) parts.push(`${data.cloned_component_count} production component${data.cloned_component_count === 1 ? "" : "s"}`);
      if (data.cloned_mapping_count != null) parts.push(`${data.cloned_mapping_count} treatment mapping${data.cloned_mapping_count === 1 ? "" : "s"}`);
      toast.success(`Variant duplicated${parts.length ? ` - ${parts.join(" and ")} copied.` : "."}`);
      onSuccess?.(data);
    },
    onError: (error) => toast.error(toStaffMessage(error.message)),
  });

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl p-6 space-y-4">
        <div>
          <h3 className="text-lg font-bold">Duplicate garment variant</h3>
          <p className="text-sm text-slate-500 mt-1">
            Duplicating <span className="font-medium text-slate-700">{sourceVariant?.name}</span>. Production components and active treatment mappings are copied; artwork is never touched.
          </p>
        </div>

        <div className="space-y-2">
          <Label>New variant name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 300gsm / Charcoal" />
        </div>

        <div className="flex gap-3 pt-2">
          <Button variant="outline" onClick={onClose} className="flex-1" disabled={duplicateMutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => duplicateMutation.mutate()}
            disabled={duplicateMutation.isPending || !name.trim()}
            className="flex-1"
          >
            {duplicateMutation.isPending ? "Duplicating…" : "Duplicate"}
          </Button>
        </div>
      </div>
    </div>
  );
}
