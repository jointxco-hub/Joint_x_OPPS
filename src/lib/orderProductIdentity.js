// Order-scoped product line identity.
//
// `line_id` identifies ONE LINE INSIDE ONE ORDER - never the catalog
// product itself. The same `catalog_item_id` legitimately appears on
// multiple lines of the same order (e.g. JET / XS / Black and JET / XL /
// White are two different lines of the same catalog product), so `line_id`
// must only be unique WITHIN an order, never globally. The same UUID may
// legitimately recur as line identity across different orders (historical
// invoice-linked compatibility already relies on this), so this module
// never checks or enforces cross-order uniqueness.
//
// `opps_invoice_items.source_order_item_id` is a UUID column - every
// generated id here must be a real UUID, never a string like
// `line-${Date.now()}-...`.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class OrderProductLineIdError extends Error {
  constructor(message) {
    super(message);
    this.name = "OrderProductLineIdError";
  }
}

export function isValidOrderProductLineId(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

export function createOrderProductLineId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // RFC4122 v4 fallback for environments without crypto.randomUUID.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Every non-empty, non-UUID line_id found in `products`, for reporting.
export function findInvalidOrderProductLineIds(products) {
  const list = Array.isArray(products) ? products : [];
  return list
    .map((product) => (product && typeof product === "object" ? product.line_id : undefined))
    .filter((value) => value !== undefined && value !== null && value !== "" && !isValidOrderProductLineId(value));
}

// Any line_id value that appears on more than one line of the SAME order.
// Global (cross-order) recurrence is expected and not checked here.
export function findDuplicateOrderProductLineIds(products) {
  const list = Array.isArray(products) ? products : [];
  const seen = new Set();
  const duplicates = new Set();
  list.forEach((product) => {
    const id = product && typeof product === "object" ? product.line_id : undefined;
    if (!isValidOrderProductLineId(id)) return;
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  });
  return Array.from(duplicates);
}

// Assigns a fresh UUID line_id to every product missing one, and preserves
// every existing valid line_id exactly. Fails closed (throws) rather than
// silently replacing persisted identity when:
//  - an existing non-empty line_id is not a valid UUID
//  - an existing valid line_id is duplicated within this same order
// Editing a row's business fields (quantity/price/size/color/notes) never
// requires calling this again - only add/duplicate/size-run flows and the
// write boundary backstop need to.
export function ensureOrderProductLineIds(products) {
  const list = Array.isArray(products) ? products : [];

  const invalid = findInvalidOrderProductLineIds(list);
  if (invalid.length) {
    throw new OrderProductLineIdError(
      `Order product has an invalid (non-UUID) line_id: ${JSON.stringify(invalid)}`
    );
  }

  const duplicates = findDuplicateOrderProductLineIds(list);
  if (duplicates.length) {
    throw new OrderProductLineIdError(
      `Order has duplicate line_id values within the same order: ${JSON.stringify(duplicates)}`
    );
  }

  const usedIds = new Set(
    list
      .map((product) => (product && typeof product === "object" ? product.line_id : undefined))
      .filter(isValidOrderProductLineId)
  );

  return list.map((product) => {
    if (!product || typeof product !== "object") return product;
    if (isValidOrderProductLineId(product.line_id)) return product;

    let id = createOrderProductLineId();
    while (usedIds.has(id)) id = createOrderProductLineId();
    usedIds.add(id);
    return { ...product, line_id: id };
  });
}

// Validates that every object product line ALREADY carries a valid,
// same-order-unique line_id - never generates one. Used at UPDATE
// boundaries: a persisted order's products should already all have
// identity by the time an update reaches here (either from the historical
// backfill or from having been created after this feature shipped), so a
// missing/invalid id on update most likely means a stale or external
// payload. Inventing a new UUID there would silently replace existing
// identity and could break whatever (e.g. an invoice line) references the
// old one - INSERT may generate; UPDATE must preserve/provide identity.
export function requireOrderProductLineIds(products) {
  const list = Array.isArray(products) ? products : [];

  const invalid = findInvalidOrderProductLineIds(list);
  if (invalid.length) {
    throw new OrderProductLineIdError(
      `Order product has an invalid (non-UUID) line_id: ${JSON.stringify(invalid)}`
    );
  }

  const hasMissing = list.some(
    (product) => product && typeof product === "object" && !isValidOrderProductLineId(product.line_id)
  );
  if (hasMissing) {
    throw new OrderProductLineIdError("ORDER_PRODUCT_LINE_ID_REQUIRED_ON_UPDATE");
  }

  const duplicates = findDuplicateOrderProductLineIds(list);
  if (duplicates.length) {
    throw new OrderProductLineIdError(
      `Order has duplicate line_id values within the same order: ${JSON.stringify(duplicates)}`
    );
  }

  return list;
}
