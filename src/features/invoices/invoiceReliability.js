export const INVOICE_ITEM_LOAD_STATE = Object.freeze({
  NOT_STARTED: "not_started",
  LOADING: "loading",
  LOADED: "loaded",
  FAILED: "failed",
});

export class InvoiceReliabilityError extends Error {
  constructor(code, message, context = {}) {
    super(message);
    this.name = "InvoiceReliabilityError";
    this.code = code;
    this.context = context;
  }
}

export function completeInvoiceDetail(invoice, items) {
  if (!invoice || !Array.isArray(items)) {
    throw new InvoiceReliabilityError(
      "INVOICE_DETAIL_INCOMPLETE",
      "Invoice details are incomplete."
    );
  }

  return {
    ...invoice,
    items,
    items_loaded: true,
    item_load_state: INVOICE_ITEM_LOAD_STATE.LOADED,
    loaded_item_count: items.length,
  };
}

export function isCompleteInvoiceDetail(invoice) {
  return Boolean(
    invoice?.id &&
    invoice.items_loaded === true &&
    invoice.item_load_state === INVOICE_ITEM_LOAD_STATE.LOADED &&
    Array.isArray(invoice.items) &&
    Number(invoice.loaded_item_count) === invoice.items.length
  );
}

export function assertInvoiceItemsReadyForSave(invoice = {}) {
  if (!invoice.id) return;

  const expectedCount = Number(invoice.expected_item_count ?? invoice.loaded_item_count);
  if (
    invoice.items_loaded !== true ||
    invoice.item_load_state !== INVOICE_ITEM_LOAD_STATE.LOADED ||
    !Array.isArray(invoice.items) ||
    !Number.isInteger(expectedCount) ||
    expectedCount < 0
  ) {
    throw new InvoiceReliabilityError(
      "INVOICE_ITEMS_NOT_LOADED",
      "Invoice details could not be loaded. Saving has been disabled to protect the existing invoice.",
      { invoiceId: invoice.id || null }
    );
  }

  if (expectedCount > 0 && invoice.items.length === 0) {
    throw new InvoiceReliabilityError(
      "INVOICE_FALSE_EMPTY_BLOCKED",
      "Saved invoice items are missing from the editor. Reload the invoice before saving.",
      { invoiceId: invoice.id, expectedCount, actualCount: 0 }
    );
  }
}

export function assertConfirmedItemCount(savedInvoice, confirmedInvoice) {
  const savedCount = Array.isArray(savedInvoice?.items) ? savedInvoice.items.length : null;
  const confirmedCount = Array.isArray(confirmedInvoice?.items) ? confirmedInvoice.items.length : null;
  if (savedCount === null || confirmedCount === null || savedCount !== confirmedCount) {
    throw new InvoiceReliabilityError(
      "INVOICE_ITEM_COUNT_MISMATCH",
      "The invoice was saved, but its line items could not be verified. Keep this editor open and retry loading before making further changes.",
      { invoiceId: savedInvoice?.id || confirmedInvoice?.id || null, expectedCount: savedCount, actualCount: confirmedCount }
    );
  }
  return confirmedInvoice;
}

function canonicalJsonValue(value) {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalJsonValue(value[key])])
    );
  }
  return value;
}

export function invoiceJsonValuesEqual(left, right) {
  return JSON.stringify(canonicalJsonValue(left)) === JSON.stringify(canonicalJsonValue(right));
}

export function invoiceDiagnostic(event, context = {}) {
  const safeContext = {
    invoiceId: context.invoiceId || null,
    code: context.code || context.error?.code || null,
    message: context.error?.message || context.message || null,
    expectedCount: Number.isFinite(Number(context.expectedCount)) ? Number(context.expectedCount) : null,
    actualCount: Number.isFinite(Number(context.actualCount)) ? Number(context.actualCount) : null,
  };
  console.error(`[invoice-reliability] ${event}`, safeContext);
}
