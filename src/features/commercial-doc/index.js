// CANONICAL SOURCE: Joint_x_OPPS/src/features/commercial-doc/.
// Synced to X LAB by scripts/sync-commercial-doc.mjs — do not edit the X LAB copy.
export { default as CommercialDocument } from "./CommercialDocument";
export {
  buildInvoiceDocumentModel,
  buildQuoteDocumentModel,
  resolveLineRole,
  normalizePriceBreakdown,
  deriveInvoiceStatuses,
  assertNoInternalLeak,
  LINE_ROLES,
  PAYMENT_STATUS_LABEL,
  LIFECYCLE_STATUS_LABEL,
} from "./commercialDocumentModel";
import "./commercialDocument.css";
