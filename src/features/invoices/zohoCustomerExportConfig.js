export const ZOHO_CUSTOMER_TEMPLATE_VERSION = "zoho_books_customers_v1";

export const ZOHO_CUSTOMER_CSV_COLUMNS = [
  { header: "Customer Name", key: "customer_name" },
  { header: "Company Name", key: "company_name" },
  { header: "Email", key: "email" },
  { header: "Phone", key: "phone" },
  { header: "Billing Address", key: "billing_address" },
  { header: "Currency Code", key: "currency_code" },
  { header: "Payment Terms", key: "payment_terms" },
  { header: "OPPS Customer ID", key: "opps_customer_id" },
];

export function getZohoCustomerCsvHeaders(columns = ZOHO_CUSTOMER_CSV_COLUMNS) {
  return columns.map((column) => column.header);
}
