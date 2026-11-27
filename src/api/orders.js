import { supabase } from "@/lib/supabaseClient";
import { getCurrentTenantId } from "@/lib/tenantContext";

function ensureSupabase() {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }
}

async function getTenantId() {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error("No active tenant is available.");
  return tenantId;
}

// Escapes the characters PostgREST's .or()/.ilike() filter syntax treats
// specially (comma separates conditions, parens group them) so a search
// term containing them can't break out of its own ilike clause into a
// neighbouring one.
function escapeFilterValue(value) {
  return String(value).replace(/[,()]/g, "");
}

const ORDER_SEARCH_COLUMNS = "id, order_number, status, client_id, client_name, client_email, client_phone, source_quote_id, total_amount, created_at";

// Tenant-scoped order search by order number, client name, email, or
// phone - used by the invoice-first "Link Existing Order" picker on the
// invoice detail drawer. Text search only (dataClient's generic entity
// layer only supports equality filters), following the same .ilike()/
// tenant-scoping convention as src/api/invoices.js's listInvoices().
export async function searchOrdersForInvoiceLink(options = {}) {
  ensureSupabase();
  const tenantId = await getTenantId();
  const needle = String(options.query || "").trim();
  const limit = options.limit || 20;
  if (!needle) return [];
  const safe = escapeFilterValue(needle);
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_SEARCH_COLUMNS)
    .eq("tenant_id", tenantId)
    .or(`order_number.ilike.%${safe}%,client_name.ilike.%${safe}%,client_email.ilike.%${safe}%,client_phone.ilike.%${safe}%`)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data || [];
}
