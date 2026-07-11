import { ZOHO_INVOICE_CSV_COLUMNS } from "./zohoInvoiceExportConfig";
import { ZOHO_CUSTOMER_CSV_COLUMNS } from "./zohoCustomerExportConfig";

export const INVOICE_SETTING_KEYS = {
  invoiceMapping: "zoho_invoice_header_mapping",
  customerMapping: "zoho_customer_header_mapping",
  clientTemplate: "client_invoice_template",
  invoiceDefaults: "invoice_defaults",
};

export const DEFAULT_INVOICE_DEFAULTS = {
  paymentTerms: "Due on receipt",
  dueDays: 0,
  shippingMethod: "PAXI",
  shippingCharge: 0,
  terms: "Prices are valid for the listed items and quantities. Production starts after approval and required assets are received.",
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


export function normalizeInvoiceDefaultsSetting(setting = {}) {
  const dueDays = Number(setting?.dueDays);
  return {
    ...DEFAULT_INVOICE_DEFAULTS,
    ...(setting || {}),
    paymentTerms: String(setting?.paymentTerms || DEFAULT_INVOICE_DEFAULTS.paymentTerms),
    dueDays: Number.isFinite(dueDays) && dueDays >= 0 ? Math.round(dueDays) : DEFAULT_INVOICE_DEFAULTS.dueDays,
    shippingMethod: String(setting?.shippingMethod || DEFAULT_INVOICE_DEFAULTS.shippingMethod),
    shippingCharge: Number.isFinite(Number(setting?.shippingCharge)) && Number(setting?.shippingCharge) >= 0 ? Number(setting.shippingCharge) : DEFAULT_INVOICE_DEFAULTS.shippingCharge,
    terms: String(setting?.terms || DEFAULT_INVOICE_DEFAULTS.terms),
  };
}
