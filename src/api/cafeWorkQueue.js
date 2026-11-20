import { supabase } from "@/lib/supabaseClient";
import { normalizeWorkQueue } from "@/features/cafeWorkQueue/normalizeWorkQueue";

// This client is intentionally not wired to a screen yet.
// The RPC must first be deployed with authenticated, tenant-scoped server
// authorization and reviewed separately. Never pass a tenant or balance from
// the browser as an authorization or financial input.
export async function getCafeWorkQueue({ cursor = null, limit = 25 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error("Invalid work queue page size.");
  }
  if (cursor !== null && (typeof cursor !== "string" || cursor.length > 512)) {
    throw new Error("Invalid work queue cursor.");
  }
  if (!supabase) throw new Error("Café work queue is unavailable.");
  const { data, error } = await supabase.rpc("qs_cafe_list_work_queue", {
    p_cursor: cursor,
    p_limit: limit,
  });
  if (error) throw error;
  return normalizeWorkQueue(data);
}
