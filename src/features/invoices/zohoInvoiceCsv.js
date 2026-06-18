import {
  ZOHO_INVOICE_CSV_COLUMNS,
  ZOHO_INVOICE_TEMPLATE_VERSION,
  getZohoInvoiceCsvHeaders,
} from "./zohoInvoiceExportConfig";

function formatDate(value) {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

export function escapeCsvValue(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function rowsToCsv(rows = [], columns = ZOHO_INVOICE_CSV_COLUMNS) {
  const headers = getZohoInvoiceCsvHeaders(columns);
  const lines = rows.map((row) =>
    columns.map((column) => escapeCsvValue(row[column.key])).join(",")
  );
  return [headers.map(escapeCsvValue).join(","), ...lines].join("\r\n");
}

export function isDefaultZohoInvoiceExportCandidate(invoice = {}) {
  return invoice.status === "approved" && !invoice.zoho_exported_at;
}

export function buildZohoInvoiceRows(invoices = [], options = {}) {
  const includeDrafts = options.includeDrafts === true;
  const includeAlreadyExported = options.includeAlreadyExported === true;

  return invoices
    .filter((invoice) => {
      if (!includeDrafts && invoice.status === "draft") return false;
      if (!includeAlreadyExported && invoice.zoho_exported_at) return false;
      return includeDrafts || includeAlreadyExported || isDefaultZohoInvoiceExportCandidate(invoice);
    })
    .flatMap((invoice) => {
      const items = Array.isArray(invoice.items) ? invoice.items : [];
      return items.map((item) => ({
        invoice_number: invoice.invoice_number || "",
        reference_number: invoice.reference_number || "",
        invoice_date: formatDate(invoice.invoice_date),
        due_date: formatDate(invoice.due_date),
        payment_terms: invoice.payment_terms || "",
        customer_name: invoice.customer_name || "",
        customer_email: invoice.customer_email || "",
        customer_phone: invoice.customer_phone || "",
        customer_billing_address: invoice.customer_billing_address || "",
        currency_code: invoice.currency_code || "ZAR",
        salesperson_name: invoice.salesperson_name || "",
        item_name: item.item_name || "",
        item_description: item.item_description || "",
        item_type: item.item_type || "goods",
        quantity: item.quantity ?? "",
        unit: item.unit || "",
        rate: item.rate ?? "",
        discount: item.discount ?? 0,
        tax_name: item.tax_name || "",
        tax_percentage: item.tax_percentage ?? 0,
        account_name: item.account_name || "",
        shipping_charge: invoice.shipping_charge ?? 0,
        adjustment: invoice.adjustment ?? 0,
        notes: invoice.notes || "",
        terms: invoice.terms || "",
        opps_invoice_id: invoice.id || "",
        opps_order_id: invoice.source_order_id || "",
      }));
    });
}

export function buildZohoInvoiceCsv(invoices = [], options = {}) {
  const columns = options.columns || ZOHO_INVOICE_CSV_COLUMNS;
  const rows = buildZohoInvoiceRows(invoices, options);
  return {
    csv: rowsToCsv(rows, columns),
    rows,
    rowCount: rows.length,
    invoiceCount: new Set(rows.map((row) => row.opps_invoice_id).filter(Boolean)).size,
    templateVersion: options.templateVersion || ZOHO_INVOICE_TEMPLATE_VERSION,
  };
}

export function getZohoInvoiceExportFileName(date = new Date()) {
  return `opps-zoho-invoices-${formatDate(date)}.csv`;
}
