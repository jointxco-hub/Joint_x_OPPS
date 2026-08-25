import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toStaffMessage } from "@/lib/pgErrorMessages";

// Phase 2B Step 3 - calls the live duplicate_treatment RPC only, never
// clones client-side. Same mount-fresh-per-attempt idempotency-key
// lifecycle as DuplicateGarmentVariantModal - see that file's header for
// the full rationale.
export default function DuplicateTreatmentModal({ sourceTreatment, targetClientProductId, onClose, onSuccess }) {
  const [name, setName] = useState(`${sourceTreatment?.name || ""} (copy)`);
  const [idempotencyKey] = useState(() =>
    (typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : `dup-treatment-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  );

  const duplicateMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("duplicate_treatment", {
        p_source_treatment_id: sourceTreatment.id,
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
      toast.success(`Treatment duplicated${parts.length ? ` - ${parts.join(", ")} copied.` : "."} Artwork and allowed garments were not copied.`);
      onSuccess?.(data);
    },
    onError: (error) => toast.error(toStaffMessage(error.message)),
  });

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl p-6 space-y-4">
        <div>
          <h3 className="text-lg font-bold">Duplicate treatment</h3>
          <p className="text-sm text-slate-500 mt-1">
            Duplicating <span className="font-medium text-slate-700">{sourceTreatment?.name}</span>. Production components are copied.
          </p>
          <p className="text-xs text-amber-600 mt-2 rounded-lg bg-amber-50 border border-amber-200 px-2 py-1.5">
            Artwork and allowed garment variants are intentionally not copied - the new treatment starts unlinked from both until you configure them.
          </p>
        </div>

        <div className="space-y-2">
          <Label>New treatment name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sky Blue SFR Print" />
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
