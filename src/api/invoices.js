import { supabase } from "@/lib/supabaseClient";
import { getCurrentTenantId } from "@/lib/tenantContext";
import { applyInvoiceTotals, calculateInvoiceLine } from "@/features/invoices/invoiceCalculations";
import { validateInvoice } from "@/features/invoices/invoiceValidation";
import {
  assertInvoiceItemsReadyForSave,
  completeInvoiceDetail,
  invoiceJsonValuesEqual,
  invoiceDiagnostic,
} from "@/features/invoices/invoiceReliability";
import {
  ZOHO_INVOICE_EXPORT_TYPE,
  ZOHO_INVOICE_TEMPLATE_VERSION,
} from "@/features/invoices/zohoInvoiceExportConfig";
import { buildOrderInvoiceSyncPlan, buildInvoiceOrderSyncPlan, buildShippingDiff, annotateProductionDataConflicts } from "@/features/invoices/orderToInvoiceItems";
import {
  INVOICE_SETTING_KEYS,
  defaultCustomerMappingSetting,
  defaultInvoiceMappingSetting,
  normalizeInvoiceDefaultsSetting,
  normalizeClientTemplateSetting,
} from "@/features/invoices/invoiceSettings";

const INVOICE_LIST_COLUMNS = [
  "id",
  "invoice_number",
  "customer_id",
  "customer_name",
  "customer_email",
  "source_order_id",
  "invoice_date",
  "due_date",
  "currency_code",
  "status",
  "reference_number",
  "subtotal",
  "discount_total",
  "shipping_charge",
  "adjustment",
  "tax_total",
  "total",
  "amount_paid",
  "balance_due",
  "zoho_exported_at",
  "zoho_imported_at",
  "created_at",
  "updated_at",
].join(",");

function ensureSupabase() {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }
}

function compactObject(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined)
  );
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function nullableField(object, key) {
  if (!hasOwn(object, key)) return undefined;
  return object[key] || null;
}

async function getAuthUserId() {
  ensureSupabase();
  const { data } = await supabase.auth.getUser();
  return data?.user?.id || null;
}

async function getTenantId() {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error("No active tenant is available for invoicing.");
  return tenantId;
}

function invoiceRecord(invoice = {}, userId = null) {
  return compactObject({
    invoice_number: invoice.invoice_number,
    customer_id: nullableField(invoice, "customer_id"),
    customer_name: invoice.customer_name,
    customer_email: nullableField(invoice, "customer_email"),
    customer_phone: nullableField(invoice, "customer_phone"),
    customer_billing_address: nullableField(invoice, "customer_billing_address"),
    source_order_id: nullableField(invoice, "source_order_id"),
    invoice_date: invoice.invoice_date,
    due_date: nullableField(invoice, "due_date"),
    payment_terms: nullableField(invoice, "payment_terms"),
    currency_code: hasOwn(invoice, "currency_code") ? invoice.currency_code || "ZAR" : undefined,
    status: hasOwn(invoice, "status") ? invoice.status || "draft" : undefined,
    reference_number: nullableField(invoice, "reference_number"),
    salesperson_name: nullableField(invoice, "salesperson_name"),
    subtotal: invoice.subtotal,
    discount_total: invoice.discount_total,
    shipping_charge: invoice.shipping_charge,
    adjustment: invoice.adjustment,
    tax_total: invoice.tax_total,
    total: invoice.total,
    amount_paid: invoice.amount_paid,
    balance_due: invoice.balance_due,
    notes: nullableField(invoice, "notes"),
    terms: nullableField(invoice, "terms"),
    internal_notes: nullableField(invoice, "internal_notes"),
    updated_by: userId,
  });
}

function invoiceItemRecord(item = {}, invoiceId, index = 0) {
  const calculated = calculateInvoiceLine(item);
  return compactObject({
    invoice_id: invoiceId,
    line_number: item.line_number || index + 1,
    item_name: item.item_name,
    item_description: item.item_description || null,
    item_type: item.item_type || "goods",
    quantity: calculated.quantity,
    unit: item.unit || null,
    rate: calculated.rate,
    discount: calculated.discount,
    tax_name: item.tax_name || null,
    tax_percentage: calculated.tax_percentage,
    account_name: item.account_name || null,
    item_total: calculated.item_total,
    source_order_item_id: item.source_order_item_id || null,
    invoice_item_template_id: item.invoice_item_template_id || null,
    catalog_item_id: item.catalog_item_id || null,
    inventory_item_id: item.inventory_item_id || null,
    source_metadata: item.source_metadata || {},
    line_key: item.line_key || null,
    image_url: item.image_url || null,
    specifications: item.specifications || {},
    proofs: Array.isArray(item.proofs) ? item.proofs : [],
  });
}

function invoiceItemRpcRecord(item = {}, index = 0) {
  const { invoice_id, tenant_id, id, created_at, ...record } = invoiceItemRecord(item, null, index);
  return record;
}

const ATOMIC_SAVE_ERROR_MESSAGES = {
  INVOICE_AUTH_REQUIRED: "Sign in again before saving this invoice.",
  INVOICE_ACCESS_DENIED: "This invoice is not available in the active tenant or you do not have permission to change it.",
  INVOICE_ITEMS_INVALID: "Invoice line items are invalid. Reload the invoice before saving.",
  INVOICE_EMPTY_ITEMS_BLOCKED: "Add at least one line item before saving.",
  INVOICE_ITEM_OWNERSHIP_MISMATCH: "One or more line items do not belong to this invoice or tenant.",
  INVOICE_ITEM_TEMPLATE_TENANT_MISMATCH: "An invoice item template belongs to another tenant. Reload before saving.",
  INVOICE_CATALOG_ITEM_TENANT_MISMATCH: "A catalog item belongs to another tenant. Reload before saving.",
  INVOICE_INVENTORY_ITEM_TENANT_MISMATCH: "An inventory item belongs to another tenant. Reload before saving.",
  INVOICE_NOT_EDITABLE: "Only draft invoices can be edited.",
  INVOICE_STALE_VERSION: "This invoice changed after you opened it. Reload it before saving.",
  INVOICE_ITEM_COUNT_CHANGED: "The saved invoice items changed after you opened the editor. Reload before saving.",
  INVOICE_FALSE_EMPTY_BLOCKED: "Saved invoice items are missing from the editor. Reload before saving.",
  INVOICE_TOTAL_MISMATCH: "The invoice total does not match its billable line items. Fix the amounts, or record an explicit total override with a reason.",
  INVOICE_TOTAL_OVERRIDE_REASON_REQUIRED: "A total override needs a written reason.",
};

const POSTGRES_SAVE_ERROR_MESSAGES = {
  "22P02": "One or more invoice values has an invalid format. Review the line items and try again.",
  "23502": "A required invoice item value is missing. Review the highlighted line and try again.",
  "23503": "A linked invoice item is no longer available. Reload the invoice before saving.",
  "23514": "An invoice item contains an invalid quantity or amount. Review the line items and try again.",
};

function atomicSaveError(error) {
  const rawMessage = String(error?.message || "");
  const code = Object.keys(ATOMIC_SAVE_ERROR_MESSAGES).find((candidate) => rawMessage.includes(candidate));
  const postgresMessage = POSTGRES_SAVE_ERROR_MESSAGES[error?.code];
  return Object.assign(
    new Error(code ? ATOMIC_SAVE_ERROR_MESSAGES[code] : postgresMessage || rawMessage || "Invoice transaction failed."),
    {
      code: code || error?.code || "INVOICE_TRANSACTION_FAILED",
      cause: error,
    }
  );
}

async function saveInvoiceWithItemsTransaction({ tenantId, invoiceId = null, invoice, items, expectedUpdatedAt = null, expectedItemCount = null, allowTotalOverride = false }) {
  const itemRows = items.map((item, index) => invoiceItemRpcRecord(item, index));
  const { data, error } = await supabase.rpc("save_opps_invoice_with_items", {
    p_tenant_id: tenantId,
    p_invoice_id: invoiceId,
    p_invoice: invoice,
    p_items: itemRows,
    p_expected_updated_at: expectedUpdatedAt,
    p_expected_item_count: expectedItemCount,
    // P5 — the server proves the stored total reconciles to the billable
    // items (invoiceCalculations formula). A normal save's total already
    // comes from applyInvoiceTotals so it matches; this is only ever true
    // for a deliberate staff override (needs invoice.total_override_reason).
    p_allow_total_override: Boolean(allowTotalOverride),
  });

  if (error) {
    const mapped = atomicSaveError(error);
    invoiceDiagnostic("transactional-save-failed", { invoiceId, code: mapped.code, error: mapped });
    throw mapped;
  }
  if (!data?.ok || !data?.invoice || !Array.isArray(data?.items)) {
    const malformed = Object.assign(
      new Error("Invoice transaction returned an incomplete result."),
      { code: "INVOICE_TRANSACTION_RESULT_INVALID" }
    );
    invoiceDiagnostic("transactional-save-failed", { invoiceId, error: malformed });
    throw malformed;
  }

  return completeInvoiceDetail(data.invoice, data.items);
}

async function recordInvoiceItemVersionsSafely(items, invoice, tenantId, userId) {
  try {
    await recordInvoiceItemVersions(items, invoice, tenantId, userId);
  } catch (error) {
    invoiceDiagnostic("item-version-history-failed", { invoiceId: invoice?.id, error });
  }
}


function invoiceItemTemplateRecord(item = {}, userId = null) {
  const calculated = calculateInvoiceLine(item);
  return compactObject({
    name: item.name || item.item_name,
    description: hasOwn(item, "description") ? item.description || null : item.item_description || null,
    item_type: item.item_type || "goods",
    unit: nullableField(item, "unit"),
    rate: calculated.rate,
    tax_name: nullableField(item, "tax_name"),
    tax_percentage: calculated.tax_percentage,
    account_name: nullableField(item, "account_name"),
    category: nullableField(item, "category"),
    client_id: nullableField(item, "client_id"),
    catalog_item_id: nullableField(item, "catalog_item_id"),
    inventory_item_id: nullableField(item, "inventory_item_id"),
    metadata: item.metadata || item.source_metadata || {},
    image_url: nullableField(item, "image_url"),
    specifications: item.specifications || {},
    proofs: Array.isArray(item.proofs) ? item.proofs : [],
    current_version: hasOwn(item, "current_version") ? Number(item.current_version || 1) : undefined,
    is_active: hasOwn(item, "is_active") ? item.is_active !== false : undefined,
    updated_by: userId,
  });
}

export function invoiceItemFromTemplate(template = {}) {
  return {
    item_name: template.name || "",
    item_description: template.description || "",
    item_type: template.item_type || "goods",
    quantity: 1,
    unit: template.unit || "",
    rate: template.rate || 0,
    discount: 0,
    tax_name: template.tax_name || "",
    tax_percentage: template.tax_percentage || 0,
    account_name: template.account_name || "",
    invoice_item_template_id: template.id || "",
    catalog_item_id: template.catalog_item_id || "",
    inventory_item_id: template.inventory_item_id || "",
    source_metadata: template.metadata || {},
    image_url: template.image_url || "",
    specifications: template.specifications || {},
    proofs: Array.isArray(template.proofs) ? template.proofs : [],
  };
}

function versionSnapshot(item = {}) {
  return {
    item_name: item.item_name || item.name || "",
    item_description: item.item_description ?? item.description ?? "",
    item_type: item.item_type || "goods",
    unit: item.unit || "",
    rate: Number(item.rate || 0),
    image_url: item.image_url || "",
    specifications: item.specifications || {},
    proofs: Array.isArray(item.proofs) ? item.proofs : [],
  };
}

function snapshotsEqual(left, right) {
  return invoiceJsonValuesEqual(left || {}, right || {});
}

// An order-derived invoice line is a snapshot of what was actually ordered
// (negotiated price, custom spec, etc.) and is expected to differ from the
// client's reusable saved item. templateSyncMode: "preserve" (used by
// createInvoice-from-order, linkInvoiceToOrder, syncInvoiceItemsFromOrder)
// carries that snapshot into the invoice's own item-version history under an
// automatic reason instead of demanding a manual one, and skips
// syncClientItemTemplates entirely so the order sync never rewrites or
// versions the reusable client template just because a name matches.
//
// The automatic reason applies only to order-derived lines (identified by
// source_order_item_id). An invoice-only/manual line carried through the
// same preserve-mode save (e.g. a kept line during Link/Sync) must not
// inherit it - that would bypass the manual change-reason guard for a line
// the order sync never touched.
const ORDER_SYNC_CHANGE_REASON = "Synced from linked order";

function withOrderSyncChangeReason(items) {
  return items.map((item) => (
    item.source_order_item_id && !String(item.change_reason || "").trim()
      ? { ...item, change_reason: ORDER_SYNC_CHANGE_REASON }
      : item
  ));
}


async function assertInvoiceItemChangeReasons(items, tenantId) {
  for (const item of items) {
    if (!item.line_key) continue;
    const { data: previous, error } = await supabase
      .from("opps_invoice_item_versions")
      .select("snapshot")
      .eq("tenant_id", tenantId)
      .eq("line_key", item.line_key)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (previous && !snapshotsEqual(previous.snapshot, versionSnapshot(item)) && !String(item.change_reason || "").trim()) {
      throw new Error(`Explain why ${item.item_name || "this invoice item"} changed before saving.`);
    }
  }
}
async function recordItemVersion({ tenantId, userId, clientId, invoiceId = null, templateId, lineKey, item, reason }) {
  if (!lineKey) return;
  const snapshot = versionSnapshot(item);
  const { data: previous, error: previousError } = await supabase
    .from("opps_invoice_item_versions")
    .select("version_number,snapshot")
    .eq("tenant_id", tenantId)
    .eq("line_key", lineKey)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (previousError) throw new Error(previousError.message);
  if (previous && snapshotsEqual(previous.snapshot, snapshot)) return;

  const changeReason = String(reason || "").trim();
  if (previous && !changeReason) {
    throw new Error(`Explain why ${snapshot.item_name || "this invoice item"} changed before saving.`);
  }

  const { error } = await supabase.from("opps_invoice_item_versions").insert({
    tenant_id: tenantId,
    client_id: clientId || null,
    invoice_id: invoiceId || null,
    invoice_item_template_id: templateId || null,
    line_key: lineKey,
    version_number: Number(previous?.version_number || 0) + 1,
    change_reason: changeReason || "Initial invoice item version",
    snapshot,
    changed_by: userId,
  });
  if (error) throw new Error(error.message);
}

async function syncClientItemTemplates(items, clientId, tenantId, userId) {
  if (!clientId) return items;
  const synced = [];

  for (const item of items) {
    const name = String(item.item_name || "").trim();
    if (!name) {
      synced.push(item);
      continue;
    }

    const { data: matches, error: matchError } = await supabase
      .from("opps_invoice_item_templates")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("client_id", clientId)
      .eq("is_active", true)
      .ilike("name", name)
      .limit(1);
    if (matchError) throw new Error(matchError.message);
    const existing = matches?.[0] || null;
    const templateChanged = existing && !snapshotsEqual(versionSnapshot(existing), versionSnapshot(item));
    if (templateChanged && !String(item.change_reason || "").trim()) {
      throw new Error(`Explain why ${name} changed before updating this client's saved item.`);
    }
    const nextVersion = templateChanged
      ? Number(existing.current_version || 1) + 1
      : Number(existing?.current_version || 1);
    const record = invoiceItemTemplateRecord({
      ...item,
      name,
      client_id: clientId,
      category: item.source_metadata?.category || item.category || "",
      current_version: nextVersion,
    }, userId);

    const result = existing
      ? await supabase.from("opps_invoice_item_templates").update(record).eq("id", existing.id).eq("tenant_id", tenantId).select("*").single()
      : await supabase.from("opps_invoice_item_templates").insert({ ...record, tenant_id: tenantId, created_by: userId }).select("*").single();
    if (result.error) throw new Error(result.error.message);
    synced.push({ ...item, invoice_item_template_id: result.data.id });
  }

  return synced;
}

async function recordInvoiceItemVersions(items, invoice, tenantId, userId) {
  for (const item of items) {
    await recordItemVersion({
      tenantId,
      userId,
      clientId: invoice.customer_id,
      invoiceId: invoice.id,
      templateId: item.invoice_item_template_id,
      lineKey: item.line_key,
      item,
      reason: item.change_reason,
    });
    if (item.invoice_item_template_id) {
      await recordItemVersion({
        tenantId,
        userId,
        clientId: invoice.customer_id,
        invoiceId: invoice.id,
        templateId: item.invoice_item_template_id,
        lineKey: `template:${item.invoice_item_template_id}`,
        item,
        reason: item.change_reason,
      });
    }
  }
}

const ACTIVITY_LABELS = {
  invoice_created: "Invoice created",
  invoice_approved: "Invoice approved",
  invoice_exported: "Invoice exported",
  invoice_imported_to_zoho: "Invoice imported to Zoho",
  invoice_marked_partially_paid: "Invoice marked partially paid",
  invoice_marked_paid: "Invoice marked paid",
  invoice_voided: "Invoice voided",
  invoice_duplicated: "Invoice duplicated",
  invoice_linked_to_order: "Linked to order",
  invoice_unlinked_from_order: "Unlinked from order",
  invoice_synced_from_order: "Synced from order",
  invoice_contact_refreshed: "Contact/shipping details refreshed",
};

async function createInvoiceActivity(invoiceId, input = {}) {
  if (!invoiceId) return null;
  ensureSupabase();
  const userId = await getAuthUserId();
  const tenantId = await getTenantId();
  const type = input.activity_type || "invoice_updated";
  const { data, error } = await supabase
    .from("opps_invoice_activity")
    .insert({
      invoice_id: invoiceId,
      activity_type: type,
      activity_label: input.activity_label || ACTIVITY_LABELS[type] || "Invoice updated",
      activity_note: input.activity_note || null,
      from_status: input.from_status || null,
      to_status: input.to_status || null,
      metadata: input.metadata || {},
      tenant_id: tenantId,
      created_by: userId,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function nextInvoiceNumber(tenantId) {
  ensureSupabase();
  const { data, error } = await supabase.rpc("next_opps_invoice_number", { p_tenant_id: tenantId });
  if (error) throw new Error(error.message);
  return data;
}

export async function createInvoice(input = {}, options = {}) {
  ensureSupabase();
  const templateSyncMode = options.templateSyncMode === "preserve" ? "preserve" : "normal";
  const userId = await getAuthUserId();
  const tenantId = await getTenantId();
  const invoiceNumber = input.invoice_number || await nextInvoiceNumber(tenantId);
  const rawItems = Array.isArray(input.items) ? input.items : [];
  const { invoice, items } = applyInvoiceTotals(
    { ...input, invoice_number: invoiceNumber },
    rawItems
  );
  const validation = validateInvoice(invoice, items);

  if (!validation.isValid) {
    throw Object.assign(new Error("Invoice validation failed."), { validation });
  }

  const linkedItems = templateSyncMode === "preserve"
    ? withOrderSyncChangeReason(items)
    : await syncClientItemTemplates(items, input.customer_id, tenantId, userId);
  const createdInvoice = await saveInvoiceWithItemsTransaction({
    tenantId,
    invoice: invoiceRecord(invoice, userId),
    items: linkedItems,
    expectedItemCount: 0,
  });
  await recordInvoiceItemVersionsSafely(linkedItems, createdInvoice, tenantId, userId);
  return createdInvoice;
}

export async function updateInvoice(id, input = {}, options = {}) {
  ensureSupabase();
  const templateSyncMode = options.templateSyncMode === "preserve" ? "preserve" : "normal";
  const userId = await getAuthUserId();
  const tenantId = await getTenantId();
  const hasItems = Array.isArray(input.items);
  const rawItems = hasItems ? input.items : [];
  let { invoice, items } = hasItems
    ? applyInvoiceTotals(input, rawItems)
    : { invoice: input, items: [] };
  if (hasItems && templateSyncMode === "preserve") {
    items = withOrderSyncChangeReason(items);
  }
  if (hasItems) {
    try {
      assertInvoiceItemsReadyForSave(input);
    } catch (error) {
      invoiceDiagnostic("blocked-false-empty-save", {
        invoiceId: id,
        code: error?.code,
        error,
        expectedCount: input.expected_item_count,
        actualCount: rawItems.length,
      });
      throw error;
    }
    await assertInvoiceItemChangeReasons(items, tenantId);
  }
  const { data: currentInvoice, error: currentError } = await supabase
    .from("opps_invoices")
    .select("id,status,updated_at,customer_id")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .single();

  if (currentError) throw new Error(currentError.message);

  const isStatusOnlyApproval =
    Object.keys(input).every((key) => ["status"].includes(key)) &&
    input.status === "approved" &&
    currentInvoice.status === "draft";

  if (currentInvoice.status !== "draft" && !isStatusOnlyApproval) {
    throw new Error("Only draft invoices can be edited.");
  }

  if (hasItems) {
    const linkedItems = templateSyncMode === "preserve"
      ? items
      : await syncClientItemTemplates(items, input.customer_id, tenantId, userId);
    const savedInvoice = await saveInvoiceWithItemsTransaction({
      tenantId,
      invoiceId: id,
      invoice: invoiceRecord(invoice, userId),
      items: linkedItems,
      expectedUpdatedAt: input.expected_updated_at || currentInvoice.updated_at,
      expectedItemCount: Number(input.expected_item_count),
    });
    await recordInvoiceItemVersionsSafely(linkedItems, savedInvoice, tenantId, userId);
    return savedInvoice;
  }

  const { data, error } = await supabase
    .from("opps_invoices")
    .update(invoiceRecord(invoice, userId))
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  if (currentInvoice.status !== data.status) {
    const activityType = data.status === "approved" ? "invoice_approved" : "invoice_updated";
    await createInvoiceActivity(id, {
      activity_type: activityType,
      from_status: currentInvoice.status,
      to_status: data.status,
    });
  }

  return data;
}

// Links a draft invoice to an order and, in the same save, pulls in the
// order's current products as line items. Order-sourced lines are matched
// to any existing invoice lines by source_order_item_id (see
// buildOrderInvoiceSyncPlan); lines already on the invoice with no order
// counterpart are left untouched. Reuses updateInvoice's atomic RPC and
// draft-only lock, so this fails the same way a normal edit would once the
// invoice is no longer a draft.
export async function linkInvoiceToOrder(invoice, order) {
  const plan = buildOrderInvoiceSyncPlan(order?.products, invoice?.items || []);
  const saved = await updateInvoice(invoice.id, {
    ...invoice,
    source_order_id: order.id,
    items: plan.items,
    expected_updated_at: invoice.updated_at,
    expected_item_count: (invoice.items || []).length,
  }, { templateSyncMode: "preserve" });
  await createInvoiceActivity(invoice.id, {
    activity_type: "invoice_linked_to_order",
    activity_note: `Linked to order ${order.order_number || order.id}`,
    metadata: { order_id: order.id, order_number: order.order_number || null, ...plan.diff },
  });
  return saved;
}

// Removes the order link only. Line items are left exactly as they are -
// unlinking does not delete or revert any item.
export async function unlinkInvoiceFromOrder(invoice) {
  const previousOrderId = invoice?.source_order_id || null;
  const saved = await updateInvoice(invoice.id, { source_order_id: null });
  await createInvoiceActivity(invoice.id, {
    activity_type: "invoice_unlinked_from_order",
    activity_note: previousOrderId ? `Unlinked from order ${previousOrderId}` : undefined,
    metadata: { previous_order_id: previousOrderId },
  });
  return saved;
}

const RELATIONAL_LINK_ERROR_MESSAGES = {
  FINANCE_PERMISSION_REQUIRED: "You do not have permission to link invoices.",
  INVOICE_NOT_FOUND: "This invoice could not be found.",
  ORDER_NOT_FOUND: "This order could not be found.",
  TENANT_ACCESS_DENIED: "This invoice or order is not available in the active tenant.",
  TENANT_MISMATCH: "This invoice and order belong to different tenants.",
  CLIENT_MISMATCH: "This invoice belongs to a different client than the order.",
  INVOICE_VOID: "A void invoice cannot be linked to an order.",
  INVOICE_ALREADY_LINKED: "This invoice is already linked to a different order.",
};

const REOPEN_INVOICE_ERROR_MESSAGES = {
  FINANCE_ADMIN_REQUIRED: "Reopening an invoice requires finance admin permission.",
  REASON_REQUIRED: "A reason is required to reopen this invoice.",
  INVOICE_NOT_FOUND: "This invoice could not be found.",
  TENANT_ACCESS_DENIED: "This invoice is not available in the active tenant.",
  INVOICE_ALREADY_DRAFT: "This invoice is already a draft.",
  PAID_INVOICE_REOPEN_BLOCKED: "A paid invoice cannot be reopened. OPPS has no credit-note/adjustment workflow yet - void and recreate if the financials must change.",
  VOID_INVOICE_REOPEN_BLOCKED: "A void invoice cannot be reopened.",
};

function rpcSafetyError(error, messageMap, fallback) {
  const rawMessage = String(error?.message || "");
  const code = Object.keys(messageMap).find((candidate) => rawMessage.includes(candidate));
  return Object.assign(new Error(code ? messageMap[code] : rawMessage || fallback), {
    code: code || error?.code || "UNKNOWN_ERROR",
    cause: error,
  });
}

// Relationship-only linking for a same-client, same-tenant invoice at ANY
// non-void status - writes source_order_id ONLY (see the RPC), never
// items/totals/customer snapshot/payment fields. This is deliberately a
// SEPARATE path from linkInvoiceToOrder() above, which stays exactly as
// it was for the existing draft-resync workflow. Same-client/tenant
// safety is enforced inside the RPC itself, not just here.
export async function linkInvoiceToOrderRelational(invoiceId, order) {
  ensureSupabase();
  const { data, error } = await supabase.rpc("link_invoice_to_order_relational", {
    p_invoice_id: invoiceId,
    p_order_id: order.id,
  });
  if (error) {
    throw rpcSafetyError(error, RELATIONAL_LINK_ERROR_MESSAGES, "Could not link this invoice to the order.");
  }
  return data;
}

// Moves an approved/exported/imported_to_zoho/overdue/partially_paid
// invoice back to draft so its line items/totals can be corrected,
// without erasing its approval history - the RPC records from_status/
// to_status/reason on the existing opps_invoice_activity table. Paid and
// void invoices are refused by the RPC itself; there is no client-side
// override for that.
export async function reopenInvoice(invoiceId, reason) {
  ensureSupabase();
  const { data, error } = await supabase.rpc("reopen_invoice", {
    p_invoice_id: invoiceId,
    p_reason: reason,
  });
  if (error) {
    throw rpcSafetyError(error, REOPEN_INVOICE_ERROR_MESSAGES, "Could not reopen this invoice.");
  }
  return data;
}

// Fetches the safe, customer-facing subset of a client record for the
// "Refresh from client profile" preview - just the category-A fields
// this feature is allowed to pull from, not the whole clients row.
export async function getClientContactSnapshot(clientId) {
  if (!clientId) return null;
  ensureSupabase();
  const { data, error } = await supabase
    .from("clients")
    .select("id, name, email, phone, saved_contact_name, delivery_address, billing_address, preferred_courier, pep_code, courier_guy_code, delivery_note, fulfillment_type")
    .eq("id", clientId)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

function courierCodeForClient(client) {
  if (!client) return "";
  if (client.preferred_courier === "pep_paxi") return client.pep_code || client.courier_guy_code || "";
  if (client.preferred_courier === "the_courier_guy") return client.courier_guy_code || client.pep_code || "";
  return client.pep_code || client.courier_guy_code || "";
}

// Maps a clients row onto the invoice's category-A field names, so the
// preview/diff and the actual refreshInvoiceContactDetails() call use
// identical field mapping logic.
export function clientToInvoiceContactFields(client) {
  if (!client) return {};
  return {
    contact_person: client.saved_contact_name || "",
    customer_phone: client.phone || "",
    customer_email: client.email || "",
    customer_billing_address: client.billing_address || client.delivery_address || "",
    shipping_address: client.delivery_address || "",
    shipping_courier: client.preferred_courier || "",
    shipping_courier_code: courierCodeForClient(client),
    delivery_instructions: client.delivery_note || "",
    fulfillment_type: client.fulfillment_type || "courier",
  };
}

const CONTACT_REFRESH_FIELDS = [
  "contact_person", "customer_phone", "customer_email", "customer_billing_address",
  "shipping_address", "shipping_courier", "shipping_courier_code", "delivery_instructions",
  "fulfillment_type",
];

// Refreshes ONLY the live/refreshable contact-shipping metadata on an
// existing invoice (category A) - never items, totals, payments, balance,
// or approval/payment status (category B). Modeled directly on
// markInvoicePaid()'s narrowly-scoped direct update: works at any
// invoice status, deliberately bypassing updateInvoice()'s draft-only
// gate rather than routing through it, since that gate exists to protect
// the financial snapshot this function never touches.
//
// Logs actual before/after VALUES (not just field names) to
// opps_invoice_activity on every call, regardless of invoice status -
// this is the one function in this file that intentionally does NOT
// special-case approved/exported/paid, precisely so a refresh on an
// approved or paid invoice is captured with the same before/after detail
// as one on a draft, per "record significant contact/shipping refreshes
// in activity/history" for exactly those statuses.
export async function refreshInvoiceContactDetails(id, fields = {}) {
  ensureSupabase();
  const invoice = await getInvoice(id);

  const patch = {};
  const changes = [];
  for (const key of CONTACT_REFRESH_FIELDS) {
    if (!(key in fields)) continue;
    const value = fields[key];
    const from = invoice[key] ?? null;
    const to = value === "" ? null : value;
    if (from !== to) changes.push({ field: key, from, to });
    patch[key] = to;
  }

  if (changes.length === 0) return invoice;

  const { data, error } = await supabase
    .from("opps_invoices")
    .update({ ...patch, updated_by: await getAuthUserId() })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  await createInvoiceActivity(id, {
    activity_type: "invoice_contact_refreshed",
    activity_note: `Refreshed from client profile - ${changes.map((c) => `${c.field}: "${c.from ?? ""}" -> "${c.to ?? ""}"`).join("; ")}`,
    metadata: {
      invoice_status_at_refresh: invoice.status,
      changes,
    },
  });
  return data;
}

// Re-pulls an already-linked invoice's order-sourced lines from the order's
// current products. Same matching/preservation rules as linkInvoiceToOrder.
// Shipping (PHASE 10): apply_shipping_fee ? shipping_fee : 0 becomes the
// invoice's shipping_charge - never both, never left stale.
export async function syncInvoiceItemsFromOrder(invoice, order) {
  const shippingContext = {
    orderApplyShippingFee: order?.apply_shipping_fee,
    orderShippingFee: order?.shipping_fee,
    invoiceShippingCharge: invoice?.shipping_charge,
  };
  const plan = buildOrderInvoiceSyncPlan(order?.products, invoice?.items || [], shippingContext);
  const saved = await updateInvoice(invoice.id, {
    ...invoice,
    items: plan.items,
    shipping_charge: plan.diff.shipping.orderAmount,
    expected_updated_at: invoice.updated_at,
    expected_item_count: (invoice.items || []).length,
  }, { templateSyncMode: "preserve" });
  await createInvoiceActivity(invoice.id, {
    activity_type: "invoice_synced_from_order",
    activity_note: `Synced from order ${order.order_number || order.id}`,
    metadata: { order_id: order.id, ...plan.diff },
  });
  return saved;
}

// Read-only - computes the invoice -> order plan and flags which changed/
// removal-candidate lines already have frozen production data, so the UI
// can show the PHASE 8 warning in the preview, before staff ever confirms
// an apply. Never writes anything.
export async function previewInvoiceOrderSync(order, invoice) {
  ensureSupabase();
  const shippingContext = {
    orderApplyShippingFee: order?.apply_shipping_fee,
    orderShippingFee: order?.shipping_fee,
    invoiceShippingCharge: invoice?.shipping_charge,
  };
  const plan = buildInvoiceOrderSyncPlan(invoice?.items || [], order?.products || [], shippingContext);

  const candidateLineIds = [
    ...plan.diff.updated.map((entry) => entry.line_id),
    ...plan.diff.missingFromInvoice.map((entry) => entry.line_id),
  ].filter(Boolean);

  let lineIdsWithProductionData = [];
  if (candidateLineIds.length && order?.id) {
    const [snapshots, reservations, tracking] = await Promise.all([
      supabase.from("order_line_component_snapshots").select("line_id").eq("order_id", order.id).in("line_id", candidateLineIds),
      supabase.from("inventory_variant_reservations").select("line_id").eq("order_id", order.id).eq("status", "active").in("line_id", candidateLineIds),
      supabase.from("order_line_production_tracking").select("line_id").eq("order_id", order.id).in("line_id", candidateLineIds),
    ]);
    const ids = new Set();
    [snapshots, reservations, tracking].forEach((result) => {
      (result.data || []).forEach((row) => ids.add(row.line_id));
    });
    lineIdsWithProductionData = Array.from(ids);
  }

  return {
    products: plan.products,
    diff: annotateProductionDataConflicts(plan.diff, lineIdsWithProductionData),
  };
}

// Pulls an already-linked invoice's current line items into the order's
// commercial product representation - the reverse of syncInvoiceItemsFromOrder.
// Blocked for paid/void invoices (PHASE 11 - a source invoice that is
// settled/void must never drive further sync in either direction); draft
// and approved invoices may be read from here without requiring
// reopen_invoice, since this direction never mutates the invoice itself.
// Respects isProductsLocked (PHASE 8) exactly like every other order
// product edit - no sync-specific bypass.
export async function syncOrderItemsFromInvoice(order, invoice, { productsLocked = false, removeLineIds = [] } = {}) {
  ensureSupabase();
  if (!order?.id) throw new Error("No order to sync into.");
  if (invoice?.status === "paid") throw new Error("PAID_INVOICE_SYNC_BLOCKED");
  if (invoice?.status === "void") throw new Error("VOID_INVOICE_SYNC_BLOCKED");
  if (productsLocked) throw new Error("ORDER_PRODUCTS_LOCKED");

  const shippingContext = {
    orderApplyShippingFee: order?.apply_shipping_fee,
    orderShippingFee: order?.shipping_fee,
    invoiceShippingCharge: invoice?.shipping_charge,
  };
  const plan = buildInvoiceOrderSyncPlan(invoice?.items || [], order?.products || [], shippingContext);
  // Default to Keep (PHASE 9) - buildInvoiceOrderSyncPlan already carries
  // every missingFromInvoice line forward unchanged; only a line_id staff
  // explicitly opted into removing (via the confirm dialog) is dropped
  // here, never as an implicit side effect of the plan itself.
  const removeSet = new Set(removeLineIds);
  const finalProducts = removeSet.size
    ? plan.products.filter((product) => !removeSet.has(product.line_id))
    : plan.products;
  const finalLineIds = new Set(finalProducts.map((product) => product.line_id));
  // Only write back pairings for lines that actually survived the removal
  // choices above - a newly-added line staff chose to remove in the same
  // confirm step must never get its source_order_item_id set, which
  // would make a future sync silently skip re-adding it.
  const linePairings = plan.linePairings.filter((pairing) => finalLineIds.has(pairing.newLineId));
  const shippingPatch = plan.diff.shipping.differs
    ? {
        apply_shipping_fee: plan.diff.shipping.invoiceAmount > 0,
        shipping_fee: plan.diff.shipping.invoiceAmount > 0 ? plan.diff.shipping.invoiceAmount : order.shipping_fee,
      }
    : {};

  // Single atomic RPC (apply_invoice_order_sync): the order's products
  // update, every invoice-item source_order_item_id write-back, and the
  // activity log entry all happen inside one Postgres transaction - never
  // separate REST calls that could leave the order updated with a still-
  // unmatched invoice item (the exact bug this replaces).
  const { data, error } = await supabase.rpc("apply_invoice_order_sync", {
    p_order_id: order.id,
    p_invoice_id: invoice.id,
    p_products: finalProducts,
    p_line_pairings: linePairings,
    p_activity_metadata: { ...plan.diff, removedLineIds: Array.from(removeSet) },
    p_apply_shipping_fee: plan.diff.shipping.differs ? shippingPatch.apply_shipping_fee : null,
    p_shipping_fee: plan.diff.shipping.differs ? shippingPatch.shipping_fee : null,
  });
  if (error) throw new Error(error.message);

  return data;
}

export async function getInvoice(id, options = {}) {
  ensureSupabase();
  const tenantId = await getTenantId();
  const { data, error } = await supabase
    .from("opps_invoices")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .single();

  if (error) {
    invoiceDiagnostic("invoice-detail-query-failed", { invoiceId: id, error });
    throw new Error(`Invoice detail query failed: ${error.message}`);
  }
  if (!options.includeItems) return data;

  const items = await listInvoiceItems(id);
  return completeInvoiceDetail(data, items);
}

export async function listInvoices(options = {}) {
  ensureSupabase();
  const tenantId = await getTenantId();
  const page = Math.max(Number(options.page || 1), 1);
  const pageSize = Math.min(Math.max(Number(options.pageSize || 25), 1), 100);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("opps_invoices")
    .select(INVOICE_LIST_COLUMNS, { count: "exact" })
    .eq("tenant_id", tenantId)
    .order(options.sortBy || "invoice_date", { ascending: options.ascending === true })
    .range(from, to);

  if (options.status) query = query.eq("status", options.status);
  if (options.customerId) query = query.eq("customer_id", options.customerId);
  if (options.sourceOrderId) query = query.eq("source_order_id", options.sourceOrderId);
  if (options.dateFrom) query = query.gte("invoice_date", options.dateFrom);
  if (options.dateTo) query = query.lte("invoice_date", options.dateTo);
  if (options.search) query = query.ilike("customer_name", `%${options.search}%`);

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);

  return {
    data: data || [],
    count: count || 0,
    page,
    pageSize,
  };
}

export async function listInvoiceItems(invoiceId) {
  ensureSupabase();
  const tenantId = await getTenantId();
  const { data, error } = await supabase
    .from("opps_invoice_items")
    .select("*")
    .eq("invoice_id", invoiceId)
    .eq("tenant_id", tenantId)
    .order("line_number", { ascending: true });

  if (error) {
    invoiceDiagnostic("invoice-item-query-failed", { invoiceId, error });
    throw Object.assign(
      new Error(`Invoice item query failed: ${error.message}`),
      { code: "INVOICE_ITEM_QUERY_FAILED" }
    );
  }
  return data || [];
}

export async function approveInvoice(id) {
  return updateInvoice(id, { status: "approved" });
}

export async function duplicateInvoiceAsDraft(id) {
  const invoice = await getInvoice(id, { includeItems: true });
  const duplicated = await createInvoice({
    ...invoice,
    id: undefined,
    invoice_number: undefined,
    status: "draft",
    zoho_exported_at: null,
    zoho_imported_at: null,
    reference_number: invoice.reference_number ? `${invoice.reference_number} copy` : "",
    internal_notes: `Duplicated from ${invoice.invoice_number || "invoice"}`,
    amount_paid: 0,
    items: (invoice.items || []).map((item) => ({
      ...item,
      id: undefined,
      invoice_id: undefined,
    })),
  });
  await createInvoiceActivity(duplicated.id, {
    activity_type: "invoice_duplicated",
    activity_note: `Created from ${invoice.invoice_number || "invoice"}`,
    from_status: invoice.status,
    to_status: duplicated.status,
    metadata: { source_invoice_id: invoice.id, source_invoice_number: invoice.invoice_number },
  });
  return duplicated;
}

export async function markInvoicePaid(id) {
  ensureSupabase();
  const invoice = await getInvoice(id);
  if (invoice.status === "draft") {
    throw new Error("Approve the invoice before marking it paid.");
  }
  if (invoice.status === "void") {
    throw new Error("Void invoices cannot be marked paid.");
  }

  const { data, error } = await supabase
    .from("opps_invoices")
    .update({
      status: "paid",
      amount_paid: invoice.total || 0,
      balance_due: 0,
      updated_by: await getAuthUserId(),
    })
    .eq("id", id)
    .select(INVOICE_LIST_COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  await createInvoiceActivity(id, {
    activity_type: "invoice_marked_paid",
    from_status: invoice.status,
    to_status: "paid",
  });
  return data;
}

export async function markInvoicePartiallyPaid(id, amountPaid, note = "") {
  ensureSupabase();
  const invoice = await getInvoice(id);
  if (invoice.status === "draft") {
    throw new Error("Approve the invoice before recording a payment.");
  }
  if (invoice.status === "void") {
    throw new Error("Void invoices cannot be marked paid.");
  }

  const paid = Number(amountPaid);
  const total = Number(invoice.total || 0);
  if (!Number.isFinite(paid) || paid < 0) {
    throw new Error("Amount paid must be 0 or more.");
  }
  if (paid > total) {
    throw new Error("Amount paid cannot be greater than the invoice total.");
  }

  const internalNote = note
    ? [invoice.internal_notes, `Partial payment note: ${note}`].filter(Boolean).join("\n")
    : invoice.internal_notes;

  const { data, error } = await supabase
    .from("opps_invoices")
    .update({
      status: "partially_paid",
      amount_paid: paid,
      balance_due: Math.max(total - paid, 0),
      internal_notes: internalNote || null,
      updated_by: await getAuthUserId(),
    })
    .eq("id", id)
    .select(INVOICE_LIST_COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  await createInvoiceActivity(id, {
    activity_type: "invoice_marked_partially_paid",
    activity_note: note || null,
    from_status: invoice.status,
    to_status: "partially_paid",
    metadata: { amount_paid: paid, balance_due: Math.max(total - paid, 0) },
  });
  return data;
}

export async function markInvoiceVoid(id) {
  ensureSupabase();
  const invoice = await getInvoice(id);
  if (invoice.status === "paid") {
    throw new Error("Paid invoices cannot be voided here.");
  }

  const { data, error } = await supabase
    .from("opps_invoices")
    .update({
      status: "void",
      updated_by: await getAuthUserId(),
    })
    .eq("id", id)
    .select(INVOICE_LIST_COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  await createInvoiceActivity(id, {
    activity_type: "invoice_voided",
    from_status: invoice.status,
    to_status: "void",
  });
  return data;
}

export async function markInvoiceExported(invoiceIds = []) {
  ensureSupabase();
  const ids = Array.isArray(invoiceIds) ? invoiceIds : [invoiceIds];
  const { data: beforeRows, error: beforeError } = await supabase
    .from("opps_invoices")
    .select("id,status")
    .in("id", ids);

  if (beforeError) throw new Error(beforeError.message);
  const beforeStatusById = new Map((beforeRows || []).map((invoice) => [invoice.id, invoice.status]));

  const { data, error } = await supabase
    .from("opps_invoices")
    .update({
      status: "exported",
      zoho_exported_at: new Date().toISOString(),
      updated_by: await getAuthUserId(),
    })
    .in("id", ids)
    .select(INVOICE_LIST_COLUMNS);

  if (error) throw new Error(error.message);
  await Promise.all((data || []).map((invoice) => createInvoiceActivity(invoice.id, {
    activity_type: "invoice_exported",
    from_status: beforeStatusById.get(invoice.id),
    to_status: "exported",
    metadata: { exported_at: invoice.zoho_exported_at },
  })));
  return data || [];
}

export async function markInvoiceImportedToZoho(invoiceIds = []) {
  ensureSupabase();
  const ids = Array.isArray(invoiceIds) ? invoiceIds : [invoiceIds];
  const { data: beforeRows, error: beforeError } = await supabase
    .from("opps_invoices")
    .select("id,status")
    .in("id", ids);

  if (beforeError) throw new Error(beforeError.message);
  const beforeStatusById = new Map((beforeRows || []).map((invoice) => [invoice.id, invoice.status]));

  const { data, error } = await supabase
    .from("opps_invoices")
    .update({
      status: "imported_to_zoho",
      zoho_imported_at: new Date().toISOString(),
      updated_by: await getAuthUserId(),
    })
    .in("id", ids)
    .select(INVOICE_LIST_COLUMNS);

  if (error) throw new Error(error.message);
  await Promise.all((data || []).map((invoice) => createInvoiceActivity(invoice.id, {
    activity_type: "invoice_imported_to_zoho",
    from_status: beforeStatusById.get(invoice.id),
    to_status: "imported_to_zoho",
    metadata: { imported_at: invoice.zoho_imported_at },
  })));
  return data || [];
}

export async function createInvoiceExportRecord(input = {}) {
  ensureSupabase();
  const userId = await getAuthUserId();
  const tenantId = await getTenantId();
  const { data, error } = await supabase
    .from("opps_invoice_exports")
    .insert({
      export_type: input.export_type || ZOHO_INVOICE_EXPORT_TYPE,
      exported_by: userId,
      invoice_count: input.invoice_count || 0,
      row_count: input.row_count || 0,
      date_from: input.date_from || null,
      date_to: input.date_to || null,
      status: input.status || "created",
      file_name: input.file_name || null,
      file_path: input.file_path || null,
      checksum: input.checksum || null,
      notes: input.notes || null,
      export_filters: input.export_filters || {},
      template_version: input.template_version || ZOHO_INVOICE_TEMPLATE_VERSION,
      tenant_id: tenantId,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function listInvoiceExports(options = {}) {
  ensureSupabase();
  const tenantId = await getTenantId();
  const limit = Math.min(Math.max(Number(options.limit || 20), 1), 100);
  const { data, error } = await supabase
    .from("opps_invoice_exports")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("exported_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return data || [];
}

export async function getApprovedInvoicesForExport(options = {}) {
  ensureSupabase();
  const tenantId = await getTenantId();
  const limit = Math.min(Math.max(Number(options.limit || 100), 1), 500);
  let query = supabase
    .from("opps_invoices")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("status", "approved")
    .is("zoho_exported_at", null)
    .order("invoice_date", { ascending: true })
    .limit(limit);

  if (options.dateFrom) query = query.gte("invoice_date", options.dateFrom);
  if (options.dateTo) query = query.lte("invoice_date", options.dateTo);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const invoices = data || [];
  if (options.includeItems === false || invoices.length === 0) return invoices;

  const invoiceIds = invoices.map((invoice) => invoice.id);
  const { data: items, error: itemError } = await supabase
    .from("opps_invoice_items")
    .select("*")
    .in("invoice_id", invoiceIds)
    .eq("tenant_id", tenantId)
    .order("line_number", { ascending: true });

  if (itemError) throw new Error(itemError.message);

  const itemsByInvoice = new Map();
  (items || []).forEach((item) => {
    const list = itemsByInvoice.get(item.invoice_id) || [];
    list.push(item);
    itemsByInvoice.set(item.invoice_id, list);
  });

  return invoices.map((invoice) => ({
    ...invoice,
    items: itemsByInvoice.get(invoice.id) || [],
  }));
}

export async function listInvoiceActivity(invoiceId, options = {}) {
  ensureSupabase();
  const tenantId = await getTenantId();
  const limit = Math.min(Math.max(Number(options.limit || 25), 1), 100);
  const { data, error } = await supabase
    .from("opps_invoice_activity")
    .select("*")
    .eq("invoice_id", invoiceId)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return data || [];
}

export async function listSiblingInvoicesForOrder(sourceOrderId, options = {}) {
  if (!sourceOrderId) return [];
  const result = await listInvoices({
    sourceOrderId,
    pageSize: options.pageSize || 25,
    sortBy: "created_at",
    ascending: false,
  });
  return result.data || [];
}

function defaultSettingForKey(settingKey) {
  if (settingKey === INVOICE_SETTING_KEYS.invoiceMapping) return defaultInvoiceMappingSetting();
  if (settingKey === INVOICE_SETTING_KEYS.customerMapping) return defaultCustomerMappingSetting();
  if (settingKey === INVOICE_SETTING_KEYS.clientTemplate) return normalizeClientTemplateSetting();
  if (settingKey === INVOICE_SETTING_KEYS.invoiceDefaults) return normalizeInvoiceDefaultsSetting();
  return {};
}

export async function getInvoiceSetting(settingKey) {
  ensureSupabase();
  const tenantId = await getTenantId();
  const { data, error } = await supabase
    .from("opps_invoice_export_settings")
    .select("setting_key,setting_value,updated_at")
    .eq("setting_key", settingKey)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.setting_value || defaultSettingForKey(settingKey);
}

export async function saveInvoiceSetting(settingKey, settingValue = {}) {
  ensureSupabase();
  const userId = await getAuthUserId();
  const tenantId = await getTenantId();
  const { data, error } = await supabase
    .from("opps_invoice_export_settings")
    .upsert({
      setting_key: settingKey,
      setting_value: settingValue || {},
      tenant_id: tenantId,
      updated_by: userId,
      created_by: userId,
    }, { onConflict: "tenant_id,setting_key" })
    .select("setting_key,setting_value,updated_at")
    .single();

  if (error) throw new Error(error.message);
  return data?.setting_value || settingValue;
}

export async function resetInvoiceSetting(settingKey) {
  return saveInvoiceSetting(settingKey, defaultSettingForKey(settingKey));
}

export async function listInvoiceItemTemplates(options = {}) {
  ensureSupabase();
  const tenantId = await getTenantId();
  const limit = Math.min(Math.max(Number(options.limit || 100), 1), 300);
  let query = supabase
    .from("opps_invoice_item_templates")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order(options.sortBy || "updated_at", { ascending: options.ascending === true })
    .limit(limit);

  if (options.clientId) query = query.or(`client_id.is.null,client_id.eq.${options.clientId}`);
  if (options.search) query = query.ilike("name", `%${options.search}%`);
  if (options.category) query = query.eq("category", options.category);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}
export async function listInvoiceItemVersions(options = {}) {
  ensureSupabase();
  const tenantId = await getTenantId();
  const limit = Math.min(Math.max(Number(options.limit || 100), 1), 300);
  let query = supabase
    .from("opps_invoice_item_versions")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (options.clientId) query = query.eq("client_id", options.clientId);
  if (options.invoiceId) query = query.eq("invoice_id", options.invoiceId);
  if (options.templateId) query = query.eq("invoice_item_template_id", options.templateId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}


export async function saveInvoiceItemTemplate(input = {}) {
  ensureSupabase();
  const userId = await getAuthUserId();
  const tenantId = await getTenantId();
  const record = invoiceItemTemplateRecord(input, userId);

  if (!record.name || !String(record.name).trim()) {
    throw new Error("Template name is required.");
  }

  if (input.id) {
    const { data: current, error: currentError } = await supabase
      .from("opps_invoice_item_templates")
      .select("*")
      .eq("id", input.id)
      .eq("tenant_id", tenantId)
      .single();
    if (currentError) throw new Error(currentError.message);
    const changed = !snapshotsEqual(versionSnapshot(current), versionSnapshot(record));
    if (changed && !String(input.change_reason || "").trim()) {
      throw new Error(`Explain why ${record.name || "this saved item"} changed before saving.`);
    }
    const { data, error } = await supabase
      .from("opps_invoice_item_templates")
      .update({
        ...record,
        current_version: changed ? Number(current.current_version || 1) + 1 : Number(current.current_version || 1),
      })
      .eq("id", input.id)
      .eq("tenant_id", tenantId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    await recordItemVersion({
      tenantId,
      userId,
      clientId: data.client_id,
      templateId: data.id,
      lineKey: `template:${data.id}`,
      item: data,
      reason: input.change_reason,
    });
    return data;
  }

  const { data, error } = await supabase
    .from("opps_invoice_item_templates")
    .insert({
      ...record,
      tenant_id: tenantId,
      created_by: userId,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  await recordItemVersion({
    tenantId,
    userId,
    clientId: data.client_id,
    templateId: data.id,
    lineKey: `template:${data.id}`,
    item: data,
    reason: input.change_reason,
  });
  return data;
}

export async function recordInvoiceItemTemplateUse(templateId) {
  if (!templateId) return null;
  ensureSupabase();
  const tenantId = await getTenantId();
  const { data: current, error: currentError } = await supabase
    .from("opps_invoice_item_templates")
    .select("id,usage_count")
    .eq("id", templateId)
    .eq("tenant_id", tenantId)
    .single();

  if (currentError) throw new Error(currentError.message);

  const { data, error } = await supabase
    .from("opps_invoice_item_templates")
    .update({
      usage_count: Number(current?.usage_count || 0) + 1,
      last_used_at: new Date().toISOString(),
      updated_by: await getAuthUserId(),
    })
    .eq("id", templateId)
    .eq("tenant_id", tenantId)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function archiveInvoiceItemTemplate(templateId) {
  ensureSupabase();
  const tenantId = await getTenantId();
  const { data, error } = await supabase
    .from("opps_invoice_item_templates")
    .update({ is_active: false, updated_by: await getAuthUserId() })
    .eq("id", templateId)
    .eq("tenant_id", tenantId)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data;
}
