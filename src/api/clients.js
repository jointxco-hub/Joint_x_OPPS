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

const CLIENT_SEARCH_COLUMNS = "id, name, email, phone, saved_contact_name, delivery_address, billing_address, preferred_courier, pep_code, courier_guy_code, delivery_note, fulfillment_type";

// Tenant-scoped client search by name, email, or phone - used by the
// invoice-first "Link Existing Order" / "Create Order" flows to let staff
// find or confirm a real Client profile to attach. Text search only;
// never used as automatic identity resolution - the caller always
// presents matches for a staff pick, never auto-attaches one.
export async function searchClients(options = {}) {
  ensureSupabase();
  const tenantId = await getTenantId();
  const needle = String(options.query || "").trim();
  const limit = options.limit || 20;
  if (!needle) return [];
  const safe = escapeFilterValue(needle);
  const { data, error } = await supabase
    .from("clients")
    .select(CLIENT_SEARCH_COLUMNS)
    .eq("tenant_id", tenantId)
    .or(`name.ilike.%${safe}%,email.ilike.%${safe}%,phone.ilike.%${safe}%`)
    .order("name", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data || [];
}

// Tenant-scoped exact(ish)-contact lookup - used only to SUGGEST a client
// to attach when both the invoice and the candidate order have no client
// record at all. Purely informational: the result is presented to staff
// for confirmation, never fed back into a server identity check.
export async function findClientsByContact(options = {}) {
  ensureSupabase();
  const tenantId = await getTenantId();
  const normalizedEmail = String(options.email || "").trim().toLowerCase();
  const normalizedPhone = String(options.phone || "").replace(/[^\d+]/g, "");
  const clauses = [];
  if (normalizedEmail) clauses.push(`email.ilike.${escapeFilterValue(normalizedEmail)}`);
  if (normalizedPhone) clauses.push(`phone.ilike.%${escapeFilterValue(normalizedPhone)}%`);
  if (!clauses.length) return [];
  const { data, error } = await supabase
    .from("clients")
    .select(CLIENT_SEARCH_COLUMNS)
    .eq("tenant_id", tenantId)
    .or(clauses.join(","))
    .limit(options.limit || 5);
  if (error) throw new Error(error.message);
  return data || [];
}
