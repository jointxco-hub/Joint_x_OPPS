// ORDER LINE MONEY — one canonical normalizer for an order.products[] line's
// quantity / unit price / line total, reused by every place that reads an
// order line's money fields (ProductsEditor, order->invoice conversion,
// repeat-order prefill - see HOTFIX A).
//
// Three storefront checkout paths write three different, mutually
// incompatible shapes into an order's `products` array:
//   - Native OPPS (manually added, or convert_quote_to_order): `price` is
//     the per-unit price. This is the long-standing convention every
//     native write site already follows - it must never change.
//   - Commerce storefront checkout (create_commerce_checkout_order): never
//     writes `price` at all - only explicit `unit_price` and `line_total`.
//   - Legacy default X LAB storefront: writes the LINE'S TOTAL into `price`
//     (confirmed against live production data: a line with
//     unit_price=95, two print add-ons totalling 134, quantity=2 arrives
//     in orders.products as {price: 458, quantity: 2} - 458 is
//     (95+134)*2, not 95). There is no unit_price/line_total on these
//     lines at all.
//
// Guessing which convention a bare `price` field uses, and getting it
// wrong, is the actual bug (ProductsEditor and orderToInvoiceItems both
// used to multiply/read `price` as if it were always per-unit). This file
// is the one place that decides it - no other call site may re-derive its
// own fallback chain.

function isUsableNumber(value) {
  if (value === null || value === undefined || value === "") return false;
  return Number.isFinite(Number(value));
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

// Missing/invalid quantity defaults to 1, matching every existing read
// site's own long-standing `Number(x || 1)` idiom - this file changes what
// `price` means, never what a missing quantity means.
function readQuantity(line) {
  const n = Number(line && line.quantity);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

// True only for the legacy default X LAB storefront: source === "xlab" and
// no storefront_host. A Commerce-tenant storefront order is also
// source === "xlab" but always carries a storefront_host AND writes
// unit_price/line_total explicitly, so it is resolved by the canonical
// branch below and never reaches this check at all.
function isLegacyXlabOrder(order) {
  return Boolean(order) && order.source === "xlab" && !order.storefront_host;
}

// HOTFIX A AUDIT — traced ProductsEditor's actual add/edit/save path
// (addRow/addSizeRun/saveRow, all built from `emptyRow`): EVERY line added
// or edited through the OPPS UI - including a fully custom, non-catalog
// item with no picker selection at all - always carries these keys as
// explicit own properties (empty string/array when unused, never absent).
// Confirmed against live production data that a genuine, never-touched
// legacy X LAB bridge line carries NONE of them (its real shape is exactly
// {color, image_url, line_id, name, price, quantity, size} - nothing
// else). So a *truthy* id check is not enough evidence: a staff-typed
// custom line with a genuine per-unit price and no catalog pick has
// catalog_item_id === "" (falsy) but the KEY is still present - exactly
// the same bare-{price,quantity} shape a real bridge line has, which is
// why checking truthiness let that case slip through as "legacy total"
// and silently divided a real unit price. Checking key PRESENCE instead
// is what actually distinguishes "this line has been through the OPPS
// add/edit form at least once" from "this line has never been touched
// since the bridge created it".
const OPPS_FORM_AUTHORED_KEYS = [
  "catalog_item_id", "inventory_item_id", "client_product_id",
  "notes", "category", "source", "selected_print_options", "selected_addons",
];
function hasOppsFormAuthoredKeys(line) {
  return Boolean(line) && OPPS_FORM_AUTHORED_KEYS.some((key) => key in line);
}

/**
 * Normalizes one order.products[] line to its quantity, unit price, and
 * line total.
 *
 * @param {object} line  one raw entry from order.products
 * @param {object} [order]  the order the line belongs to (supplies the
 *   source/storefront_host evidence needed to resolve a bare `price`)
 * @returns {{quantity:number, unitPrice:number|null, lineTotal:number|null, trusted:boolean, basis:string}}
 *   unitPrice/lineTotal are null when no interpretation can be trusted
 *   (trusted: false) - callers must never fall back to treating null as 0
 *   for anything that writes data (see ProductsEditor's Apply total gate).
 */
export function normalizeOrderLineMoney(line, order) {
  const raw = line || {};
  const quantity = readQuantity(raw);
  const hasUnitPrice = isUsableNumber(raw.unit_price);
  const hasLineTotal = isUsableNumber(raw.line_total);

  // Canonical/native shape: unit_price and/or line_total present. Trust
  // each one that's actually there; derive the other from quantity. Covers
  // the Commerce storefront (always both) and any OPPS-authored line that
  // happens to carry one of these (e.g. convert_quote_to_order's output,
  // which sets both unit_price and line_total alongside price).
  if (hasUnitPrice || hasLineTotal) {
    const unitPrice = hasUnitPrice ? toNumber(raw.unit_price) : toNumber(raw.line_total) / quantity;
    const lineTotal = hasLineTotal ? toNumber(raw.line_total) : unitPrice * quantity;
    return { quantity, unitPrice: round2(unitPrice), lineTotal: round2(lineTotal), trusted: true, basis: "explicit" };
  }

  if (!isUsableNumber(raw.price)) {
    // No usable money field on this line at all - never silently treat as
    // free/zero (that is what caused Commerce-checkout lines, which have
    // no `price`, to display/sum as R0 before this fix).
    return { quantity, unitPrice: null, lineTotal: null, trusted: false, basis: "ambiguous" };
  }

  const priceValue = toNumber(raw.price);

  // The one real ambiguity left: a bare `price`, no unit_price/line_total.
  // Only reinterpret it as a line TOTAL when the order is positively
  // identified as the legacy X LAB storefront AND this specific line
  // shows no evidence of ever having been through the OPPS add/edit form.
  // If the order is legacy X LAB but the line DOES carry one of those
  // form-authored keys, we no longer know whether `price` is the original
  // bridge total or a staff-typed unit price - guessing either way can
  // corrupt a total, so this resolves to untrusted rather than assuming
  // either convention. Every other order (native OPPS, quick_solution, or
  // a Commerce order that unexpectedly has neither unit_price nor
  // line_total) keeps the long-standing native meaning: price = unit
  // price. That default is never broadened beyond this one narrow,
  // positively-identified legacy case.
  if (isLegacyXlabOrder(order)) {
    if (hasOppsFormAuthoredKeys(raw)) {
      return { quantity, unitPrice: null, lineTotal: null, trusted: false, basis: "legacy_xlab_ambiguous_shape" };
    }
    const quantityIsReal = isUsableNumber(raw.quantity) && Number(raw.quantity) > 0;
    if (!quantityIsReal) {
      // Dividing an unknown total by a guessed quantity is not
      // trustworthy, unlike the native branch below where `price` is
      // already the correct unit regardless of quantity.
      return { quantity, unitPrice: null, lineTotal: round2(priceValue), trusted: false, basis: "legacy_xlab_total_unresolved_quantity" };
    }
    return { quantity, unitPrice: round2(priceValue / quantity), lineTotal: round2(priceValue), trusted: true, basis: "legacy_xlab_total" };
  }

  return { quantity, unitPrice: round2(priceValue), lineTotal: round2(priceValue * quantity), trusted: true, basis: "native_unit_price" };
}
