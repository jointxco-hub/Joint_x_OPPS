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
  return JSON.stringify(left || {}) === JSON.stringify(right || {});
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

  const linkedItems = await syncClientItemTemplates(items, createdInvoice.customer_id, tenantId, userId);
  if (linkedItems.length > 0) {
    const itemRows = linkedItems.map((item, index) => ({ ...invoiceItemRecord(item, createdInvoice.id, index), tenant_id: tenantId }));
    const { error: itemError } = await supabase.from("opps_invoice_items").insert(itemRows);
    if (itemError) throw new Error(itemError.message);
  }

  await recordInvoiceItemVersions(linkedItems, createdInvoice, tenantId, userId);

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
  if (hasItems) await assertInvoiceItemChangeReasons(items, tenantId);
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
    const linkedItems = await syncClientItemTemplates(items, data.customer_id, tenantId, userId);
    const { error: deleteError } = await supabase
      .from("opps_invoice_items")
      .delete()
      .eq("invoice_id", id)
      .eq("tenant_id", tenantId);
    if (deleteError) throw new Error(deleteError.message);

    if (linkedItems.length > 0) {
      const itemRows = linkedItems.map((item, index) => ({ ...invoiceItemRecord(item, id, index), tenant_id: tenantId }));
      const { error: itemError } = await supabase.from("opps_invoice_items").insert(itemRows);
      if (itemError) throw new Error(itemError.message);
    }

    await recordInvoiceItemVersions(linkedItems, data, tenantId, userId);
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