import { supabase } from "@/lib/supabaseClient";
import { getCurrentTenantId } from "@/lib/tenantContext";
import { applyInvoiceTotals, calculateInvoiceLine } from "@/features/invoices/invoiceCalculations";
import { validateInvoice } from "@/features/invoices/invoiceValidation";
import {
  ZOHO_INVOICE_EXPORT_TYPE,
  ZOHO_INVOICE_TEMPLATE_VERSION,
} from "@/features/invoices/zohoInvoiceExportConfig";
import {
  INVOICE_SETTING_KEYS,
  defaultCustomerMappingSetting,
  defaultInvoiceMappingSetting,
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
  });
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

export async function createInvoice(input = {}) {
  ensureSupabase();
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

  const { data: createdInvoice, error } = await supabase
    .from("opps_invoices")
    .insert({
      ...invoiceRecord(invoice, userId),
      tenant_id: tenantId,
      created_by: userId,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  if (items.length > 0) {
    const itemRows = items.map((item, index) => ({ ...invoiceItemRecord(item, createdInvoice.id, index), tenant_id: tenantId }));
    const { error: itemError } = await supabase.from("opps_invoice_items").insert(itemRows);
    if (itemError) throw new Error(itemError.message);
  }

  await createInvoiceActivity(createdInvoice.id, {
    activity_type: "invoice_created",
    to_status: createdInvoice.status,
  });

  return getInvoice(createdInvoice.id, { includeItems: true });
}

export async function updateInvoice(id, input = {}) {
  ensureSupabase();
  const userId = await getAuthUserId();
  const tenantId = await getTenantId();
  const hasItems = Array.isArray(input.items);
  const rawItems = hasItems ? input.items : [];
  const { invoice, items } = hasItems
    ? applyInvoiceTotals(input, rawItems)
    : { invoice: input, items: [] };
  const { data: currentInvoice, error: currentError } = await supabase
    .from("opps_invoices")
    .select("id,status")
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

  if (hasItems) {
    const { error: deleteError } = await supabase
      .from("opps_invoice_items")
      .delete()
      .eq("invoice_id", id)
      .eq("tenant_id", tenantId);
    if (deleteError) throw new Error(deleteError.message);

    if (items.length > 0) {
      const itemRows = items.map((item, index) => ({ ...invoiceItemRecord(item, id, index), tenant_id: tenantId }));
      const { error: itemError } = await supabase.from("opps_invoice_items").insert(itemRows);
      if (itemError) throw new Error(itemError.message);
    }
  }

  return hasItems ? getInvoice(id, { includeItems: true }) : data;
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

  if (error) throw new Error(error.message);
  if (!options.includeItems) return data;

  const items = await listInvoiceItems(id);
  return { ...data, items };
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

  if (error) throw new Error(error.message);
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
