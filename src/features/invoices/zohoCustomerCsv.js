import { escapeCsvValue } from "./zohoInvoiceCsv";
import {
  ZOHO_CUSTOMER_CSV_COLUMNS,
  ZOHO_CUSTOMER_TEMPLATE_VERSION,
  getZohoCustomerCsvHeaders,
} from "./zohoCustomerExportConfig";

function customerKey(invoice = {}) {
  const email = String(invoice.customer_email || "").trim().toLowerCase();
  if (email) return `email:${email}`;
  return `name:${String(invoice.customer_name || "").trim().toLowerCase()}`;
}

export function rowsToCustomerCsv(rows = [], columns = ZOHO_CUSTOMER_CSV_COLUMNS) {
  const headers = getZohoCustomerCsvHeaders(columns);
  const lines = rows.map((row) =>
    columns.map((column) => escapeCsvValue(row[column.key])).join(",")
  );
  return [headers.map(escapeCsvValue).join(","), ...lines].join("\r\n");
}

export function buildZohoCustomerRows(invoices = []) {
  const seen = new Set();
  const rows = [];

  invoices.forEach((invoice) => {
    const key = customerKey(invoice);
    if (!invoice.customer_name || seen.has(key)) return;
    seen.add(key);
    rows.push({
      customer_name: invoice.customer_name || "",
      company_name: invoice.customer_name || "",
      email: invoice.customer_email || "",
      phone: invoice.customer_phone || "",
      billing_address: invoice.customer_billing_address || "",
      currency_code: invoice.currency_code || "ZAR",
      payment_terms: invoice.payment_terms || "",
      opps_customer_id: invoice.customer_id || "",
    });
  });

  return rows;
}

export function buildZohoCustomerCsv(invoices = [], options = {}) {
  const columns = options.columns || ZOHO_CUSTOMER_CSV_COLUMNS;
  const rows = buildZohoCustomerRows(invoices);
  return {
    csv: rowsToCustomerCsv(rows, columns),
    rows,
    rowCount: rows.length,
    templateVersion: options.templateVersion || ZOHO_CUSTOMER_TEMPLATE_VERSION,
  };
}

export function getZohoCustomerExportFileName(date = new Date()) {
  const isoDate = date.toISOString().slice(0, 10);
  return `opps-zoho-customers-${isoDate}.csv`;
}
