import assert from "node:assert/strict";
import test from "node:test";
import { invoiceFromOrder } from "../src/features/invoices/orderToInvoiceItems.js";

// Regression coverage for the global Order -> Invoice shipping bug:
// invoiceFromOrder() used to read order.shipping_charge / delivery_fee /
// delivery_cost / courier_fee — none of which exist on public.orders (the
// real columns are apply_shipping_fee + shipping_fee, confirmed against the
// live staging schema) — so every one of those checks fell through to
// invoiceSettings.js's DEFAULT_INVOICE_DEFAULTS.shippingCharge (R120),
// regardless of the order's actual shipping state. This is a field-name
// mismatch, not a `||` truthiness bug — the old code already used `??`.

const defaults = { paymentTerms: "Due on receipt", dueDays: 0, shippingMethod: "PAXI", shippingCharge: 120, terms: "" };

function baseOrder(overrides = {}) {
  return {
    id: "order-1",
    order_number: "ORD-1",
    client_name: "Test Client",
    products: [{ line_id: "a", name: "Tee", quantity: 2, price: 100 }],
    ...overrides,
  };
}

test("order shipping 0 (apply_shipping_fee true, shipping_fee 0) -> invoice shipping_charge 0, not R120", () => {
  const order = baseOrder({ apply_shipping_fee: true, shipping_fee: 0 });
  const invoice = invoiceFromOrder(order, 0, defaults);
  assert.equal(invoice.shipping_charge, 0);
});

test("order shipping 120 (apply_shipping_fee true, shipping_fee 120) -> invoice shipping_charge exactly 120", () => {
  const order = baseOrder({ apply_shipping_fee: true, shipping_fee: 120 });
  const invoice = invoiceFromOrder(order, 0, defaults);
  assert.equal(invoice.shipping_charge, 120);
});

test("no courier selected (apply_shipping_fee false, shipping_fee null) -> invoice shipping_charge 0, never the R120 default", () => {
  const order = baseOrder({ apply_shipping_fee: false, shipping_fee: null });
  const invoice = invoiceFromOrder(order, 0, defaults);
  assert.equal(invoice.shipping_charge, 0);
});

test("quote-derived order with neither field explicitly set (column defaults: apply_shipping_fee=true, shipping_fee=null) -> invoice shipping_charge 0, invoice total equals order total", () => {
  // Mirrors ORD-Q-* orders from convert_quote_to_order — its INSERT never
  // lists apply_shipping_fee/shipping_fee, so both take the orders table's
  // own column defaults (apply_shipping_fee defaults true, shipping_fee
  // defaults null — confirmed in 202608220007_order_shipping_fee_control.sql
  // and the live schema). A missing amount must never become R120.
  const order = baseOrder({
    apply_shipping_fee: true, // orders.apply_shipping_fee's own column default
    shipping_fee: null,       // no explicit amount was ever set
    total_amount: 378,
    products: [{ line_id: "a", name: "Tee", quantity: 2, price: 150 }, { line_id: "b", name: "Cap", quantity: 1, price: 78 }],
  });
  const invoice = invoiceFromOrder(order, 0, defaults);
  assert.equal(invoice.shipping_charge, 0);
  const subtotal = invoice.items.reduce((sum, item) => sum + item.rate * item.quantity, 0);
  assert.equal(subtotal, 378);
  assert.equal(subtotal + invoice.shipping_charge, order.total_amount, "invoice total (subtotal + shipping) must equal the accepted order total, not order total + R120");
});

test("apply_shipping_fee true but shipping_fee negative or non-numeric -> treated as 0, not invented", () => {
  assert.equal(invoiceFromOrder(baseOrder({ apply_shipping_fee: true, shipping_fee: -5 }), 0, defaults).shipping_charge, 0);
  assert.equal(invoiceFromOrder(baseOrder({ apply_shipping_fee: true, shipping_fee: undefined }), 0, defaults).shipping_charge, 0);
});

test("apply_shipping_fee true with a real positive shipping_fee is unaffected by defaults.shippingCharge, whatever it is set to", () => {
  const order = baseOrder({ apply_shipping_fee: true, shipping_fee: 65 });
  const invoice = invoiceFromOrder(order, 0, { ...defaults, shippingCharge: 999 });
  assert.equal(invoice.shipping_charge, 65, "the manual-invoice-creation default must never leak into an order-derived invoice");
});

test("normal existing order behavior: explicit courier fee flows through unchanged (non-regression)", () => {
  const order = baseOrder({ apply_shipping_fee: true, shipping_fee: 85, courier: "The Courier Guy" });
  const invoice = invoiceFromOrder(order, 0, defaults);
  assert.equal(invoice.shipping_charge, 85);
});
