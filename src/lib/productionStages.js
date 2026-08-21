// Shared production method/stage vocabulary - moved out of OrderDrawer.jsx
// so ProductsEditor.jsx's per-line production tracking (Product
// Composition & Production Components) can use the exact same options
// as the existing per-order fields, rather than a second, driftable copy.
// Values match the DB CHECK constraints on orders.production_method /
// orders.production_detail_stage exactly (verified directly against
// production), and order_line_production_tracking's own CHECK
// constraints (see the migration) intentionally mirror the same lists.

export const PRODUCTION_METHODS = [
  { value: "__none", label: "Not set" },
  { value: "dtf", label: "DTF printing" },
  { value: "vinyl", label: "Vinyl cutting" },
  { value: "screen", label: "Screen printing" },
  { value: "embroidery", label: "Embroidery" },
  { value: "pressing", label: "Heat pressing" },
  { value: "tailoring", label: "Tailoring" },
  { value: "cropping", label: "Cropping / alterations" },
  { value: "labeling", label: "Labeling / tagging" },
  { value: "mixed", label: "Mixed production" },
  { value: "custom", label: "Custom" },
];

export const PRODUCTION_DETAIL_STAGES = [
  { value: "__none", label: "Not set" },
  { value: "waiting_design_assets", label: "Waiting for design assets" },
  { value: "artwork_check", label: "Artwork check" },
  { value: "artwork_setup", label: "Artwork setup" },
  { value: "awaiting_client_approval", label: "Awaiting client approval" },
  { value: "print_setup", label: "Print setup" },
  { value: "queued_pressing", label: "Queued for pressing" },
  { value: "pressing", label: "Pressing" },
  { value: "queued_embroidery", label: "Queued for embroidery" },
  { value: "embroidering", label: "Embroidering" },
  { value: "queued_tailor", label: "Queued for tailor" },
  { value: "at_tailor", label: "At tailor" },
  { value: "cropping_alterations", label: "Cropping / alterations" },
  { value: "finishing", label: "Finishing" },
  { value: "quality_check", label: "Quality check" },
  { value: "rework", label: "Rework / correction" },
  { value: "waiting_stock", label: "Waiting on stock / blanks" },
  { value: "packing", label: "Packing" },
  { value: "custom", label: "Custom" },
];
