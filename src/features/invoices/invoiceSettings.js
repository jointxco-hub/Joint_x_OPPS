import { ZOHO_INVOICE_CSV_COLUMNS } from "./zohoInvoiceExportConfig";
import { ZOHO_CUSTOMER_CSV_COLUMNS } from "./zohoCustomerExportConfig";

export const INVOICE_SETTING_KEYS = {
  invoiceMapping: "zoho_invoice_header_mapping",
  customerMapping: "zoho_customer_header_mapping",
  clientTemplate: "client_invoice_template",
};

export const DEFAULT_CLIENT_INVOICE_TEMPLATE = {
  businessDisplayName: "JointX",
  logoUrl: "/icons/jointx-logo.png",
  footerNote: "More order, delivery, and product information is available at xlab.jointx.co.za.",
  paymentInstructions: "",
  contactEmail: "jointx.co@gmail.com",
  contactPhone: "+27 7453 4646",
  contactWhatsapp: "+27 7453 4646",
  primarySite: "xlab.jointx.co.za",
  samplePacksSite: "x1.jointx.co.za",
  showProductThumbnails: true,
  showPaidBalanceBlock: true,
  thankYouMessage: "Thank you for choosing JointX. Made for real use, handled with care.",
};

export function normalizeColumns(savedColumns, defaultColumns) {
  const savedByKey = new Map(
    (Array.isArray(savedColumns) ? savedColumns : [])
      .filter((column) => column?.key)
      .map((column) => [column.key, column])
  );

  return defaultColumns.map((column) => ({
    ...column,
    header: String(savedByKey.get(column.key)?.header || column.header),
  }));
}

export function defaultInvoiceMappingSetting() {
  return { columns: ZOHO_INVOICE_CSV_COLUMNS };
}

export function defaultCustomerMappingSetting() {
  return { columns: ZOHO_CUSTOMER_CSV_COLUMNS };
}

export function normalizeClientTemplateSetting(setting = {}) {
  return {
    ...DEFAULT_CLIENT_INVOICE_TEMPLATE,
    ...(setting || {}),
    showProductThumbnails: setting?.showProductThumbnails !== false,
    showPaidBalanceBlock: setting?.showPaidBalanceBlock !== false,
  };
}
