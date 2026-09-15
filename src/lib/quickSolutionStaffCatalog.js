import { supabase } from "@/lib/supabaseClient";

function ensureClient() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

export async function listQuickSolutionStaffCatalog(tenantId) {
  if (!tenantId) return [];

  const client = ensureClient();
  const { data, error } = await client.rpc(
    "get_quick_solution_staff_catalog",
    { p_tenant_id: tenantId }
  );

  if (error) throw error;

  return Array.isArray(data?.products) ? data.products : [];
}

export async function quoteQuickSolutionStaffItem(
  tenantId,
  productKey,
  configuration
) {
  if (!tenantId || !productKey) return null;

  const client = ensureClient();
  const { data, error } = await client.rpc(
    "quote_quick_solution_staff_item",
    {
      p_tenant_id: tenantId,
      p_product_key: productKey,
      p_configuration: configuration || {},
    }
  );

  if (error) throw error;

  return data || null;
}

export function buildQuickSolutionInitialConfiguration(product) {
  const fields = Array.isArray(product?.customerDefinition?.fields)
    ? product.customerDefinition.fields
    : [];

  const configuration = {};

  for (const field of fields) {
    if (!field?.id || field.type === "file") continue;

    if (field.default !== undefined && field.default !== null) {
      configuration[field.id] = field.default;
      continue;
    }

    if (field.required && field.type === "number") {
      configuration[field.id] = field.min ?? 1;
    }
  }

  return configuration;
}

export function quickSolutionConfigurationComplete(product, configuration = {}) {
  const fields = Array.isArray(product?.customerDefinition?.fields)
    ? product.customerDefinition.fields
    : [];

  return fields
    .filter((field) => field?.required && field.type !== "file")
    .every((field) => {
      const value = configuration[field.id];
      return value !== undefined && value !== null && String(value).trim() !== "";
    });
}