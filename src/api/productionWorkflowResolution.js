import { supabase } from "@/lib/supabaseClient";

export async function productionWorkflowRpc(name, args) {
  if (!supabase) throw new Error("Production connection is unavailable.");
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    const messages = {
      CLIENT_PRODUCT_APPROVAL_DENIED: "Only an authorised admin can record customer approval.",
      CLIENT_PRODUCT_REVISION_STALE: "This product changed. Reload it before recording approval.",
      CLIENT_PRODUCT_APPROVAL_EVIDENCE_REQUIRED: "Choose the approval source and enter a reference.",
      PRODUCTION_FILE_STALE_OR_UNAVAILABLE: "This file changed or is no longer pending. Reload the artwork.",
      PRODUCTION_SCOPE_ORDER_LOCKED: "Production scope is locked after production starts.",
      PRODUCTION_SCOPE_NOT_PRINT_ONLY: "Print-only scope requires a composition containing print services only.",
    };
    const message = Object.entries(messages).find(([code]) => error.message?.includes(code))?.[1];
    throw new Error(message || error.message || "Could not save the production decision.");
  }
  return data;
}
