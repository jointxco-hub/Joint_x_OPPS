// Pure mapping between the OPPS product/client-product catalogue and a
// QUOTE line item. No network, no React — unit-tested in
// tests/quotes-product-picker.test.mjs.
//
// Rules (from JOINT X — QUOTES PRODUCT PICKER INTEGRATION):
//   * Reuse the canonical catalogue. No new catalogue / pricing engine.
//   * Populate item_name, item_description, unit, rate, image from the
//     canonical configuration.
//   * NEVER invent a price. A missing / requires-quote price yields
//     rate 0 + needs_price_review so the editor can force staff review.
//   * NEVER carry supplier cost, margin, or internal-only fields into a
//     line's source_metadata (the customer-safe quote snapshot is built
//     from these lines).
//   * The picked data is copied onto the line; save_opps_quote_with_items
//     then freezes it into the immutable revision snapshot.

import { numberOrZero } from "@/features/invoices/invoiceCalculations";

// client_products.status values that count as "approved for the client".
// draft / ready_for_client_review / client_changes_requested are pickable
// but flagged as not-yet-approved. archived is hidden by the picker.
export const CLIENT_PRODUCT_APPROVED_STATUSES = ["client_approved", "ready_to_order", "active"];

export function isClientProductApproved(clientProduct = {}) {
  return CLIENT_PRODUCT_APPROVED_STATUSES.includes(String(clientProduct.status || ""));
}

export function isClientProductArchived(clientProduct = {}) {
  return String(clientProduct.status || "") === "archived";
}

// ── price-review resolution (persisted, internal) ──────────────────────
// A line is "review eligible" when it came from the picker (has a
// client-product link, or a catalogue/client-product source). A purely
// manual line is never auto-flagged for review.
export const REVIEW_ELIGIBLE_SOURCE_PREFIXES = ["catalog", "client_product"];

export function lineIsReviewEligible(item = {}) {
  if (item && item.source_client_product_id) return true;
  const s = String(item?.source_metadata?.source || "");
  return REVIEW_ELIGIBLE_SOURCE_PREFIXES.some((p) => s.startsWith(p));
}

// The review state to show when a SAVED quote is re-opened. A positive
// rate alone is not "approved" — a requires_quote / missing-price line
// stays flagged until a staff member has explicitly resolved it, which is
// recorded as source_metadata.price_reviewed. Resetting the rate to 0
// always requires review again.
export function resolveNeedsPriceReviewOnLoad(item = {}) {
  if (!lineIsReviewEligible(item)) return false;
  if (numberOrZero(item.rate) <= 0) return true;
  if (item?.source_metadata?.price_reviewed === true) return false;
  if (item?.source_metadata?.requires_quote) return true;
  return false;
}

// Given an editor line about to be saved (plus its already-sanitised
// source_metadata), return the source_metadata to persist. Stamps
// price_reviewed:true once staff have resolved a positive rate on an
// eligible line; drops it whenever the line is (still / again) unresolved
// so a later re-open re-requires review. price_reviewed is internal only
// and, like the rest of source_metadata, never enters a quote snapshot.
export function stampReviewResolution(item = {}, sanitizedMetadata = {}) {
  const { price_reviewed: _drop, ...rest } = sanitizedMetadata || {};
  if (!lineIsReviewEligible(item)) return rest;
  const resolved = numberOrZero(item.rate) > 0 && !item._needs_price_review;
  return resolved ? { ...rest, price_reviewed: true } : rest;
}

function positiveNumberOrNull(value) {
  const n = numberOrZero(value);
  return n > 0 ? n : null;
}

// Resolve the sell rate for a picked product. Returns { rate, needsPriceReview }.
// A missing configured price, a zero/negative price, or requires_quote all
// produce rate 0 + needsPriceReview: true — the price is never guessed.
export function resolveLineRate({ price, requiresQuote = false } = {}) {
  const configured = positiveNumberOrNull(price);
  if (requiresQuote || configured === null) {
    return { rate: 0, needsPriceReview: true };
  }
  return { rate: configured, needsPriceReview: false };
}

function line(base) {
  return {
    line_key: globalThis.crypto?.randomUUID?.() || `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: "product",
    item_name: "",
    item_description: "",
    quantity: 1,
    unit: "ea",
    rate: 0,
    discount: 0,
    tax_name: "",
    tax_percentage: 0,
    image_url: "",
    source_client_product_id: null,
    source_metadata: {},
    _needs_price_review: false,
    ...base,
  };
}

// A concise, customer-safe description from a client_products row's
// configured branding. Deliberately excludes internal_notes /
// production_instructions / packaging_instructions / special_instructions.
export function clientProductBrandingSummary(clientProduct = {}) {
  const parts = [
    clientProduct.print_method ? `Print: ${clientProduct.print_method}` : null,
    clientProduct.placement ? `Placement: ${clientProduct.placement}` : null,
    clientProduct.print_size ? `Size: ${clientProduct.print_size}` : null,
    clientProduct.print_locations ? `${clientProduct.print_locations} location(s)` : null,
    clientProduct.garment_color ? `Colour: ${clientProduct.garment_color}` : null,
    clientProduct.garment_material ? clientProduct.garment_material : null,
    clientProduct.garment_gsm ? `${clientProduct.garment_gsm} gsm` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

// ── mappers ─────────────────────────────────────────────────────────────

// Internal catalogue product (public.products via dataClient CatalogItem).
export function catalogItemToQuoteLine(product = {}) {
  const { rate, needsPriceReview } = resolveLineRate({
    price: product.price ?? product.base_price ?? product.selling_price,
  });
  return line({
    role: "product",
    item_name: String(product.name || product.title || "").trim() || "Catalogue item",
    item_description: String(product.description || "").trim(),
    unit: "ea",
    rate,
    image_url: product.image_url || (Array.isArray(product.images) ? (product.images[0]?.src || product.images[0]) : "") || "",
    source_client_product_id: null,
    source_metadata: {
      source: "catalog",
      catalog_item_id: product.id || null,
      category: product.category || null,
      currency: product.currency || null,
    },
    _needs_price_review: needsPriceReview,
  });
}

// Client-specific configured product (public.client_products via dataClient
// ClientProduct — tenant-scoped). Uses the client-facing name + configured
// client_price. requires_quote or an unset price => needs_price_review.
export function clientProductToQuoteLine(clientProduct = {}) {
  const { rate, needsPriceReview } = resolveLineRate({
    price: clientProduct.client_price,
    requiresQuote: Boolean(clientProduct.requires_quote),
  });
  const branding = clientProductBrandingSummary(clientProduct);
  return line({
    role: "product",
    item_name: String(clientProduct.client_facing_name || clientProduct.internal_name || "").trim() || "Client product",
    item_description: branding,
    unit: "ea",
    rate,
    image_url: clientProduct.primary_mockup_url || "",
    source_client_product_id: clientProduct.id || null,
    source_metadata: {
      source: "client_product",
      client_product_id: clientProduct.id || null,
      client_product_status: clientProduct.status || null,
      client_product_approved: isClientProductApproved(clientProduct),
      base_product_id: clientProduct.opps_product_id || null,
      currency: clientProduct.currency || null,
      requires_quote: Boolean(clientProduct.requires_quote),
    },
    _needs_price_review: needsPriceReview,
  });
}

// Optional branding / add-on lines a staff member can ADD alongside a
// picked product — never auto-applied. Each is a normal quote line with
// role 'addon' (or 'setup_fee') and its own needs_price_review state.
export function addonLinesFromCatalogItem(product = {}) {
  const addons = Array.isArray(product.addons) ? product.addons : [];
  return addons
    .filter((a) => a && (a.name || a.label))
    .map((a) => {
      const { rate, needsPriceReview } = resolveLineRate({ price: a.price ?? a.amount });
      return line({
        role: "addon",
        item_name: String(a.name || a.label).trim(),
        item_description: String(a.description || "").trim(),
        unit: "ea",
        rate,
        source_metadata: { source: "catalog_addon", catalog_item_id: product.id || null, addon_key: a.key || a.id || null },
        _needs_price_review: needsPriceReview,
      });
    });
}

// A client_products row can imply one branding line (its print config) —
// offered, never auto-added.
export function brandingLineFromClientProduct(clientProduct = {}) {
  const summary = clientProductBrandingSummary(clientProduct);
  if (!summary) return null;
  return line({
    role: "addon",
    item_name: clientProduct.print_method ? `${clientProduct.print_method} branding` : "Branding",
    item_description: summary,
    unit: "ea",
    rate: 0,
    source_client_product_id: clientProduct.id || null,
    source_metadata: { source: "client_product_branding", client_product_id: clientProduct.id || null },
    _needs_price_review: true, // branding is priced per job — always staff-set
  });
}

// Strip a line down to what save_opps_quote_with_items accepts, keeping the
// two source fields it persists. Guarantees no stray internal keys reach
// the payload (defence-in-depth; the snapshot builder is also allowlisted).
const SAFE_METADATA_KEYS = new Set([
  "source", "catalog_item_id", "client_product_id", "client_product_status",
  "client_product_approved", "base_product_id", "currency", "requires_quote",
  "addon_key", "price_breakdown", "category",
  // internal, boolean: staff have resolved this line's price review.
  "price_reviewed",
]);

export function sanitizeQuoteLineSourceMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (SAFE_METADATA_KEYS.has(k)) out[k] = v;
  }
  return out;
}
