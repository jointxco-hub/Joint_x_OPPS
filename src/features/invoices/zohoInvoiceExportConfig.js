export const ZOHO_INVOICE_EXPORT_TYPE = "zoho_books_invoices";
export const ZOHO_INVOICE_TEMPLATE_VERSION = "zoho_books_invoices_v1";

export const ZOHO_INVOICE_CSV_COLUMNS = [
  { header: "Invoice Number", key: "invoice_number" },
  { header: "Reference Number", key: "reference_number" },
  { header: "Invoice Date", key: "invoice_date" },
  { header: "Due Date", key: "due_date" },
  { header: "Payment Terms", key: "payment_terms" },
  { header: "Customer Name", key: "customer_name" },
  { header: "Customer Email", key: "customer_email" },
  { header: "Customer Phone", key: "customer_phone" },
  { header: "Billing Address", key: "customer_billing_address" },
  { header: "Currency Code", key: "currency_code" },
  { header: "Salesperson Name", key: "salesperson_name" },
  { header: "Item Name", key: "item_name" },
  { header: "Item Description", key: "item_description" },
  { header: "Item Type", key: "item_type" },
  { header: "Quantity", key: "quantity" },
  { header: "Unit", key: "unit" },
  { header: "Rate", key: "rate" },
  { header: "Discount", key: "discount" },
  { header: "Tax Name", key: "tax_name" },
  { header: "Tax Percentage", key: "tax_percentage" },
  { header: "Account", key: "account_name" },
  { header: "Shipping Charge", key: "shipping_charge" },
  { header: "Adjustment", key: "adjustment" },
  { header: "Notes", key: "notes" },
  { header: "Terms", key: "terms" },
  { header: "OPPS Invoice ID", key: "opps_invoice_id" },
  { header: "OPPS Order ID", key: "opps_order_id" },
];

export const ZOHO_CUSTOMER_CSV_COLUMNS = [
  { header: "Customer Name", key: "customer_name" },
  { header: "Company Name", key: "company_name" },
  { header: "Email", key: "email" },
  { header: "Phone", key: "phone" },
  { header: "Billing Address", key: "billing_address" },
  { header: "Currency Code", key: "currency_code" },
  { header: "Payment Terms", key: "payment_terms" },
];

export function getZohoInvoiceCsvHeaders(columns = ZOHO_INVOICE_CSV_COLUMNS) {
  return columns.map((column) => column.header);
}
