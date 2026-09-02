// PHASE 11 lifecycle rule for invoice -> order sync, confirmed not
// assumed: draft invoice -> allowed; approved invoice -> allowed (this
// direction never mutates the invoice itself, so reopen_invoice is not
// required - the UI must still say the order is being aligned to an
// approved financial record); paid/void -> blocked entirely. Order ->
// invoice mutation of an approved invoice is a separate action and still
// requires the existing reopen flow - untouched here. Plain JS (not the
// .jsx component file) so it stays importable from plain node --test.
export function canSyncInvoiceToOrder(invoiceStatus) {
  return invoiceStatus !== "paid" && invoiceStatus !== "void";
}

export function isOrderProductsLocked(order) {
  return Boolean(order && ((order.status && order.status !== "confirmed") || order.products_locked_at));
}

// Shared mapping between an order's products and OPPS invoice line items.
// Used both when creating an invoice from an order (one-time snapshot) and
// when linking/syncing an existing invoice to an order (ongoing reconciliation).
//
// Matching identity: order products have no stable id of their own (custom,
// hand-typed items in particular never had one), so ProductsEditor assigns a
// `line_id` to every row. An invoice line's `source_order_item_id` stores that
// `line_id`. A line with no `source_order_item_id` was added directly on the
// invoice (e.g. a shipping/rush fee) and sync never touches it.

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function positiveMoneyOrNull(value) {
  const parsed = numberOrZero(value);
  return parsed > 0 ? parsed : null;
}

function uuidOrEmpty(value) {
  const text = String(value || "");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : "";
}

function addDaysIso(dateIso, days = 0) {
  const date = dateIso ? new Date(String(dateIso) + "T00:00:00") : new Date();
  date.setDate(date.getDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function resolveOrderAmountPaid(order = {}, totalPaid = 0) {
  const candidates = [
    totalPaid,
    order.amount_paid,
    order.deposit_paid,
    order.deposit_amount,
    order.paid_amount,
  ];
  const paid = candidates.map(positiveMoneyOrNull).find((value) => value !== null);
  return paid || 0;
}

// The stable key used to match an order product to an invoice line across
// syncs. Prefers the explicit line_id ProductsEditor assigns; falls back to
// catalog/inventory id for products created before line_id existed.
export function orderProductKey(product = {}) {
  return product.line_id || uuidOrEmpty(product.id) || uuidOrEmpty(product.catalog_item_id) || uuidOrEmpty(product.inventory_item_id) || null;
}

// P5 — the render/customer-facing invoice breakdown. Whitelisted from the
// FROZEN order-line price_breakdown: label / role / amount / method /
// placement + the header facts (mode / reconciled / difference /
// unit_price). Internal component_id (the P4 transport identity) and any
// once_per_order_fees (they are separate billable setup_fee lines now)
// are stripped. This is what P6 will later expose to customers.
export function sanitizeInvoicePriceBreakdown(pb) {
  if (!pb || typeof pb !== "object" || pb.mode !== "composed") return null;
  const perUnit = (Array.isArray(pb.per_unit) ? pb.per_unit : []).map((r) => ({
    label: String(r?.label ?? "Item"),
    role: r?.role ?? null,
    amount: numberOrZero(r?.amount),
    production_method: r?.production_method ?? null,
    placement: r?.placement ?? null,
  }));
  return {
    mode: "composed",
    per_unit: perUnit,
    reconciled: pb.reconciled === true ? true : pb.reconciled === false ? false : null,
    difference: typeof pb.difference === "number" ? pb.difference : null,
    unit_price: typeof pb.unit_price === "number" ? pb.unit_price : null,
  };
}

// P5 — a reserved line_role='breakdown' order line is informational only
// and never becomes an invoice item.
export function isBillableOrderLine(product = {}) {
  return (product.line_role || "product") !== "breakdown";
}

export function itemFromProduct(product = {}, index = 0) {
  const lineRole = product.line_role || "product";
  const name = product.name || product.product_name || product.title || "Custom item";
  const quantity = numberOrZero(product.quantity) > 0 ? numberOrZero(product.quantity) : 1;
  const unitRate = product.price ?? product.rate ?? product.unit_price;
  const rate = unitRate !== undefined && unitRate !== null && unitRate !== ""
    ? numberOrZero(unitRate)
    : numberOrZero(product.line_total) / quantity;

  const baseMeta = {
    source: product.source || "order",
    category: product.category || product.product_category || "",
    image_url: product.image_url || product.thumbnail_url || product.cover_image_url || "",
    size: product.size || product.variant_size || "",
    color: product.color || product.colour || product.variant_color || "",
    selected_print_options: Array.isArray(product.selected_print_options) ? product.selected_print_options : [],
    selected_addons: Array.isArray(product.selected_addons) ? product.selected_addons : [],
  };

  // P5 §6/§7 — a setup_fee companion is a NORMAL billable invoice item
  // (qty 1, rate = fee amount, billed once) whose subtype (setup vs
  // once-off add-on) and parent are preserved for UI grouping + sync.
  if (lineRole === "setup_fee") {
    return {
      line_number: index + 1,
      item_name: name,
      item_description: "Once-off",
      item_type: "services",
      quantity: 1,
      unit: product.unit || "",
      rate,
      discount: numberOrZero(product.discount),
      tax_name: "",
      tax_percentage: 0,
      account_name: "",
      source_order_item_id: orderProductKey(product),
      catalog_item_id: "",
      inventory_item_id: "",
      source_metadata: {
        ...baseMeta,
        line_role: "setup_fee",
        fee_role: product.breakdown_role === "addon" ? "addon" : "setup",
        parent_order_line_id: product.parent_line_id || null,
      },
    };
  }

  // P5 §4/§5 — a composed product line's per-unit breakdown rides along
  // as INFORMATIONAL metadata; the parent still bills the single agreed
  // per-unit price (never a billable row per component — that would
  // double-count).
  const priceBreakdown = sanitizeInvoicePriceBreakdown(product.price_breakdown);

  return {
    line_number: index + 1,
    item_name: name,
    item_description: product.notes || product.description || product.size || product.color || "",
    item_type: "goods",
    quantity,
    unit: product.unit || "",
    rate,
    discount: numberOrZero(product.discount),
    tax_name: "",
    tax_percentage: 0,
    account_name: "",
    source_order_item_id: orderProductKey(product),
    catalog_item_id: uuidOrEmpty(product.catalog_item_id || product.product_id),
    inventory_item_id: uuidOrEmpty(product.inventory_item_id),
    source_metadata: priceBreakdown ? { ...baseMeta, price_breakdown: priceBreakdown } : baseMeta,
  };
}

export function invoiceFromOrder(order = {}, totalPaid = 0, defaults = {}) {
  const products = (Array.isArray(order.products) && order.products.length
    ? order.products
    : [{ name: order.blank_type || order.product_name || "Custom item", quantity: order.quantity || 1, price: order.total_amount || 0 }]
  ).filter(isBillableOrderLine);
  const items = products.map(itemFromProduct);
  const shippingCharge = numberOrZero(order.shipping_charge ?? order.delivery_fee ?? order.delivery_cost ?? order.courier_fee ?? defaults.shippingCharge);
  const amountPaid = resolveOrderAmountPaid(order, totalPaid);
  const invoiceDate = new Date().toISOString().slice(0, 10);

  return {
    customer_id: order.client_id || "",
    customer_name: order.client_name || "Customer",
    customer_email: order.client_email || "",
    customer_phone: order.client_phone || "",
    customer_billing_address: order.delivery_note || "",
    source_order_id: order.id,
    invoice_date: invoiceDate,
    due_date: order.due_date || addDaysIso(invoiceDate, defaults.dueDays),
    payment_terms: defaults.paymentTerms,
    currency_code: "ZAR",
    status: "draft",
    reference_number: order.order_number || order.tracking_number || "",
    shipping_charge: shippingCharge,
    adjustment: 0,
    amount_paid: amountPaid,
    payment_data_warning: amountPaid === 0 && [
      totalPaid,
      order.amount_paid,
      order.deposit_paid,
      order.deposit_amount,
      order.paid_amount,
    ].some((value) => numberOrZero(value) < 0),
    notes: order.notes || order.special_instructions || "",
    terms: defaults.terms,
    internal_notes: `Created from OPPS order ${order.order_number || order.id || ""}`.trim(),
    items,
  };
}

// Shared shipping-diff shape for both sync directions (PHASE 10) -
// compares what the order would charge (apply_shipping_fee ? shipping_fee
// : 0) against the invoice's stored shipping_charge. Never alters
// fulfillment_type - a R0/OFF shipping value says nothing about how the
// order is fulfilled, only whether the client is billed for it.
export function buildShippingDiff({ orderApplyShippingFee, orderShippingFee, invoiceShippingCharge } = {}) {
  const orderCharges = Boolean(orderApplyShippingFee) && Number(orderShippingFee) > 0;
  const orderAmount = orderCharges ? Number(orderShippingFee) : 0;
  const invoiceAmount = Number(invoiceShippingCharge) || 0;
  return {
    orderApplyShippingFee: Boolean(orderApplyShippingFee),
    orderAmount,
    invoiceAmount,
    differs: orderAmount !== invoiceAmount,
  };
}

// Reconciles an order's current products against an invoice's current line
// items. Order-sourced lines (matched by orderProductKey) are refreshed from
// the order; lines with no source_order_item_id were added directly on the
// invoice and are always preserved untouched; order lines with no invoice
// counterpart are added; invoice lines whose order product no longer exists
// are dropped, reported in diff.removedFromOrder so the caller can warn
// before applying.
export function buildOrderInvoiceSyncPlan(orderProducts = [], currentItems = [], shipping) {
  // P5 — reserved 'breakdown' lines are informational, never invoice
  // items; product + setup_fee lines both reconcile by line_id <->
  // source_order_item_id, independently.
  const products = (Array.isArray(orderProducts) ? orderProducts : []).filter(isBillableOrderLine);
  const items = Array.isArray(currentItems) ? currentItems : [];

  const itemsByKey = new Map();
  items.forEach((item) => {
    if (item.source_order_item_id) itemsByKey.set(item.source_order_item_id, item);
  });

  const matchedKeys = new Set();
  const merged = [];
  const diff = { added: [], updated: [], removedFromOrder: [], keptInvoiceOnly: [] };

  products.forEach((product, index) => {
    const key = orderProductKey(product);
    const mapped = itemFromProduct(product, index);
    const existing = key ? itemsByKey.get(key) : undefined;

    if (existing) {
      matchedKeys.add(key);
      const changed = existing.item_name !== mapped.item_name
        || Number(existing.quantity) !== Number(mapped.quantity)
        || Number(existing.rate) !== Number(mapped.rate);
      merged.push({
        ...existing,
        item_name: mapped.item_name,
        item_description: mapped.item_description,
        quantity: mapped.quantity,
        rate: mapped.rate,
        source_metadata: mapped.source_metadata,
        source_order_item_id: key,
        catalog_item_id: mapped.catalog_item_id || existing.catalog_item_id,
        inventory_item_id: mapped.inventory_item_id || existing.inventory_item_id,
      });
      if (changed) diff.updated.push(mapped.item_name);
    } else {
      merged.push(mapped);
      diff.added.push(mapped.item_name);
    }
  });

  items.forEach((item) => {
    if (!item.source_order_item_id) {
      merged.push(item);
      diff.keptInvoiceOnly.push(item.item_name);
    } else if (!matchedKeys.has(item.source_order_item_id)) {
      diff.removedFromOrder.push(item.item_name);
    }
  });

  if (shipping) diff.shipping = buildShippingDiff(shipping);

  return {
    items: merged.map((item, index) => ({ ...item, line_number: index + 1 })),
    diff,
  };
}

function newOrderLineId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `line-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Maps one invoice line item to the commercial (never inventory/
// composition) fields of an order product. Deliberately narrow - see
// PHASE 5's explicit "do not fabricate inventory item / variant /
// Product Composition / artwork / supplier mapping" rule. size/color
// come from source_metadata when the invoice line originated from an
// order product that had them (round-trips cleanly); an invoice-authored
// line has no source_metadata, so they stay blank, exactly like a
// manually-typed custom order line today.
function orderProductFromInvoiceItem(item = {}) {
  const metadata = item.source_metadata && typeof item.source_metadata === "object" ? item.source_metadata : {};
  return {
    name: item.item_name || "Custom item",
    quantity: Number(item.quantity) > 0 ? Number(item.quantity) : 1,
    price: Number(item.rate) || 0,
    size: metadata.size || "",
    color: metadata.color || "",
    notes: item.item_description || "",
    category: metadata.category || "",
    image_url: metadata.image_url || "",
    selected_print_options: Array.isArray(metadata.selected_print_options) ? metadata.selected_print_options : [],
    selected_addons: Array.isArray(metadata.selected_addons) ? metadata.selected_addons : [],
  };
}

// Reconciles an order's current products against an already-linked
// invoice's current line items - the mirror image of
// buildOrderInvoiceSyncPlan, using the exact same stable identity
// (line_id <-> source_order_item_id, never description-text matching).
//
// Invoice lines with no source_order_item_id are invoice-authored - they
// become NEW order lines here (a fresh line_id is minted, never reusing
// or guessing one), carrying only the commercial fields above and
// added_from_invoice: true so the UI can flag them ("Added from
// invoice") until production setup (method/placement/artwork/inventory)
// is completed separately. An order product whose line_id has no
// matching invoice line is reported in diff.missingFromInvoice but is
// NEVER removed here - removal is a separate, explicit, confirmed staff
// action (see the removal/conflict flow), never an implicit side effect
// of applying this plan.
export function buildInvoiceOrderSyncPlan(invoiceItems = [], orderProducts = [], shipping) {
  const items = Array.isArray(invoiceItems) ? invoiceItems : [];
  const products = Array.isArray(orderProducts) ? orderProducts : [];

  const productsByLineId = new Map();
  products.forEach((product) => {
    const key = orderProductKey(product);
    if (key) productsByLineId.set(key, product);
  });

  const matchedKeys = new Set();
  const merged = [];
  const diff = { added: [], updated: [], missingFromInvoice: [] };
  // Every newly-minted line_id must be written back onto the invoice item
  // it came from (source_order_item_id) so a later sync recognizes it as
  // already-matched instead of minting another duplicate. This function
  // only computes the pairing - persisting it is the caller's job
  // (apply_invoice_order_sync), atomically alongside the order write.
  const linePairings = [];

  items.forEach((item) => {
    const key = item.source_order_item_id || null;
    const mapped = orderProductFromInvoiceItem(item);
    const existing = key ? productsByLineId.get(key) : undefined;

    if (existing) {
      matchedKeys.add(key);
      const changed = existing.name !== mapped.name
        || Number(existing.quantity) !== Number(mapped.quantity)
        || Number(existing.price) !== Number(mapped.price)
        || (existing.size || "") !== mapped.size
        || (existing.color || "") !== mapped.color;
      merged.push({
        ...existing,
        name: mapped.name,
        quantity: mapped.quantity,
        price: mapped.price,
        size: mapped.size || existing.size || "",
        color: mapped.color || existing.color || "",
        notes: mapped.notes || existing.notes || "",
      });
      if (changed) {
        diff.updated.push({
          line_id: key,
          name: mapped.name,
          before: { quantity: Number(existing.quantity) || 0, price: Number(existing.price) || 0 },
          after: { quantity: mapped.quantity, price: mapped.price },
        });
      }
    } else {
      const newLineId = newOrderLineId();
      merged.push({
        ...mapped,
        line_id: newLineId,
        catalog_item_id: "",
        inventory_item_id: "",
        source: "custom",
        added_from_invoice: true,
      });
      diff.added.push(mapped.name);
      if (item.id) linePairings.push({ invoiceItemId: item.id, newLineId });
    }
  });

  // Default to Keep (PHASE 9): an order line whose invoice counterpart is
  // gone is flagged in the diff but stays in the returned products array
  // unchanged - it is never dropped by this function. Removal is a
  // separate, explicit, per-line staff decision the caller applies on
  // top of this plan's output after confirmation, never an implicit
  // side effect of building/applying the plan itself.
  products.forEach((product) => {
    const key = orderProductKey(product);
    if (key && !matchedKeys.has(key)) {
      diff.missingFromInvoice.push({ line_id: key, name: product.name || "Item" });
      merged.push(product);
    } else if (!key) {
      // A line with no stable identity at all (pre-line_id legacy row,
      // should not exist after backfillOrderProductLineIds runs, but
      // never silently drop data if it somehow does) is kept as-is too.
      merged.push(product);
    }
  });

  if (shipping) diff.shipping = buildShippingDiff(shipping);

  return { products: merged, diff, linePairings };
}

// PHASE 8: a quantity/price change or a removal candidate on a line that
// already has frozen production data (order_line_component_snapshots,
// inventory_variant_reservations, order_line_production_tracking) must be
// flagged, never silently applied as if it were a plain commercial edit -
// the commercial fields may still update, but reservation
// recalculation/correction is a separate, deliberate follow-up staff
// action (inventory_recalculate_line_reservations), never invoked here.
// Pure annotation only - the caller supplies which line_ids actually have
// production data (a DB lookup this module has no access to).
export function annotateProductionDataConflicts(diff, lineIdsWithProductionData = []) {
  const flagged = new Set(lineIdsWithProductionData);
  return {
    ...diff,
    updated: diff.updated.map((entry) => (
      entry.line_id && flagged.has(entry.line_id)
        ? { ...entry, hasProductionData: true }
        : entry
    )),
    missingFromInvoice: diff.missingFromInvoice.map((entry) => (
      flagged.has(entry.line_id) ? { ...entry, hasProductionData: true } : entry
    )),
  };
}

// Assigns a stable line_id to any order product missing one (rows created
// before this feature existed). Returns null when nothing changed so callers
// can skip an unnecessary order update.
export function backfillOrderProductLineIds(products = []) {
  const list = Array.isArray(products) ? products : [];
  let changed = false;
  const next = list.map((product) => {
    if (product && typeof product === "object" && !product.line_id) {
      changed = true;
      const id = typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `line-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      return { ...product, line_id: id };
    }
    return product;
  });
  return changed ? next : null;
}
