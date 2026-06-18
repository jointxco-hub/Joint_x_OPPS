import { numberOrZero } from "./invoiceCalculations";

function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === "";
}

export function validateInvoice(invoice = {}, items = [], context = {}) {
  const errors = [];
  const warnings = [];
  const invoiceItems = Array.isArray(items) ? items : [];

  if (isBlank(invoice.invoice_number)) {
    errors.push({ field: "invoice_number", message: "Invoice number is required." });
  }

  if (isBlank(invoice.customer_name)) {
    errors.push({ field: "customer_name", message: "Customer name is required." });
  }

  if (isBlank(invoice.invoice_date)) {
    errors.push({ field: "invoice_date", message: "Invoice date is required." });
  }

  if (invoiceItems.length === 0) {
    errors.push({ field: "items", message: "Add at least one line item." });
  }

  invoiceItems.forEach((item, index) => {
    if (isBlank(item.item_name)) {
      errors.push({ field: `items.${index}.item_name`, message: "Item name is required." });
    }

    if (numberOrZero(item.quantity) <= 0) {
      errors.push({ field: `items.${index}.quantity`, message: "Quantity must be greater than 0." });
    }

    if (numberOrZero(item.rate) < 0) {
      errors.push({ field: `items.${index}.rate`, message: "Rate must be 0 or more." });
    }

    if (numberOrZero(item.tax_percentage) > 0 && isBlank(item.tax_name)) {
      warnings.push({
        field: `items.${index}.tax_name`,
        message: "Tax name is missing for a taxable line item.",
      });
    }

    if (item.existsInZoho === false || item.zoho_item_exists === false) {
      warnings.push({
        field: `items.${index}.item_name`,
        message: "Item may not exist in Zoho Books.",
      });
    }
  });

  if (isBlank(invoice.customer_email)) {
    warnings.push({ field: "customer_email", message: "Customer email is missing." });
  }

  if (isBlank(invoice.due_date)) {
    warnings.push({ field: "due_date", message: "Due date is missing." });
  }

  if (invoice.payment_data_warning) {
    warnings.push({
      field: "amount_paid",
      message: "Payment amount was adjusted because the source value was below 0 or above the invoice total.",
    });
  }

  if (invoice.zoho_exported_at || ["exported", "imported_to_zoho"].includes(invoice.status)) {
    warnings.push({ field: "status", message: "Invoice was already exported." });
  }

  if (
    context.customerExistsInZoho === false ||
    invoice.customer_exists_in_zoho === false ||
    invoice.zoho_customer_exists === false
  ) {
    warnings.push({ field: "customer_name", message: "Customer may not exist in Zoho Books." });
  }

  return {
    errors,
    warnings,
    isValid: errors.length === 0,
  };
}
