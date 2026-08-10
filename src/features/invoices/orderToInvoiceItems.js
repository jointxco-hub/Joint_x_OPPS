// Shared mapping between an order's products and OPPS invoice line items.
// Used both when creating an invoice from an order (one-time snapshot) and
// when linking/syncing an existing invoice to an order (ongoing reconciliation).
//
// Matching identity: order products have no stable id of their own (custom,
// hand-typed items in particular never had one), so ProductsEditor assigns a
// `line_id` to every row. An invoice line's `source_order_item_id` stores that
// `line_id`. A line with no `source_order_item_id` was added directly on the
// invoice (e.g. a shipping/rush fee) and sync never touches it.

// Relative import (not the "@/" alias) so this module stays directly
// executable under plain `node --test`, same as every other pure module in
// this file's test suite (tests/order-invoice-sync.test.mjs imports and
// runs this file's exports directly, no bundler available).
import { createOrderProductLineId } from "../../lib/orderProductIdentity.js";

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

export function itemFromProduct(product = {}, index = 0) {
  const name = product.name || product.product_name || product.title || "Custom item";
  const quantity = numberOrZero(product.quantity) > 0 ? numberOrZero(product.quantity) : 1;
  const unitRate = product.price ?? product.rate ?? product.unit_price;
  const rate = unitRate !== undefined && unitRate !== null && unitRate !== ""
    ? numberOrZero(unitRate)
    : numberOrZero(product.line_total) / quantity;

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
    source_metadata: {
      source: product.source || "order",
      category: product.category || product.product_category || "",
      image_url: product.image_url || product.thumbnail_url || product.cover_image_url || "",
      size: product.size || product.variant_size || "",
      color: product.color || product.colour || product.variant_color || "",
      selected_print_options: Array.isArray(product.selected_print_options) ? product.selected_print_options : [],
      selected_addons: Array.isArray(product.selected_addons) ? product.selected_addons : [],
    },
  };
}

export function invoiceFromOrder(order = {}, totalPaid = 0, defaults = {}) {
  const products = Array.isArray(order.products) && order.products.length
    ? order.products
    : [{ name: order.blank_type || order.product_name || "Custom item", quantity: order.quantity || 1, price: order.total_amount || 0 }];
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

// Reconciles an order's current products against an invoice's current line
// items. Order-sourced lines (matched by orderProductKey) are refreshed from
// the order; lines with no source_order_item_id were added directly on the
// invoice and are always preserved untouched; order lines with no invoice
// counterpart are added; invoice lines whose order product no longer exists
// are dropped, reported in diff.removedFromOrder so the caller can warn
// before applying.
export function buildOrderInvoiceSyncPlan(orderProducts = [], currentItems = []) {
  const products = Array.isArray(orderProducts) ? orderProducts : [];
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

  return {
    items: merged.map((item, index) => ({ ...item, line_number: index + 1 })),
    diff,
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
      return { ...product, line_id: createOrderProductLineId() };
    }
    return product;
  });
  return changed ? next : null;
}
