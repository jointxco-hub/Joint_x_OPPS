const paymentLabels = {
  draft: "Draft",
  approved: "Approved",
  paid: "Paid",
  partially_paid: "Partially paid",
  overdue: "Overdue",
  void: "Void",
};

export function getInvoicePaymentDisplay(invoice = {}) {
  const status = invoice.status || "draft";
  if (paymentLabels[status]) {
    return {
      key: status,
      label: paymentLabels[status],
    };
  }

  return {
    key: "approved",
    label: "Approved",
  };
}

export function getInvoiceZohoDisplay(invoice = {}) {
  if (invoice.zoho_imported_at || invoice.status === "imported_to_zoho") {
    return {
      key: "imported",
      label: "Imported to Zoho",
    };
  }

  if (invoice.zoho_exported_at || invoice.status === "exported") {
    return {
      key: "exported",
      label: "Exported",
    };
  }

  return {
    key: "not_exported",
    label: "Not exported",
  };
}

export function getInvoiceDisplayStates(invoice = {}) {
  return {
    payment: getInvoicePaymentDisplay(invoice),
    zoho: getInvoiceZohoDisplay(invoice),
  };
}
