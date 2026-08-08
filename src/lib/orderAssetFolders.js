// Pure, dependency-free logic for mirroring order files into File Manager's
// "<Client Root>/Orders/<order_number>/<category>" structure
// (folders/client_assets, provisioned by
// supabase/migrations/202608080001_client_order_asset_folder_provisioning.sql).
// Kept import-free (no @/ aliases, no JSX) so it can be unit tested directly
// by this project's plain `node --test` runner — the same reason
// src/lib/orderThumbnail.js exists as its own module rather than living
// inline in a .jsx file.

export const INVOICE_FOLDER_ID = "__invoices";

// The full standard order subfolder set, provisioned up front by
// provision_order_asset_folders() even before any file is attached.
export const ORDER_ASSET_CATEGORIES = Object.freeze([
  "Mockups",
  "Artwork",
  "Production",
  "QC / Finished",
  "Invoices & Quotes",
  "Delivery",
  "General",
]);

// Maps an order's own built-in folder id (stable ids from
// OrderDrawerShared.jsx's DEFAULT_ORDER_FILE_FOLDERS, plus INVOICE_FOLDER_ID)
// to the matching category subfolder under Orders/<order_number>. Anything
// this map doesn't recognize — an ad hoc staff-created folder, or no folder
// at all — falls back to "General" rather than inventing a new category.
const ORDER_ASSET_CATEGORY_MAP = Object.freeze({
  mockups: "Mockups",
  artwork: "Artwork",
  production: "Production",
  [INVOICE_FOLDER_ID]: "Invoices & Quotes",
});

export function resolveOrderAssetCategory(folderId) {
  return ORDER_ASSET_CATEGORY_MAP[folderId] || "General";
}

// The client_assets mirror insert is protected by a unique constraint on
// (order_id, file_url) (idx_client_assets_order_file_url_unique) rather than
// a pre-check-then-insert, so it stays correct under concurrent mirror
// attempts for the same file. This predicate recognizes that specific,
// expected "already mirrored" outcome so it can be swallowed as a no-op
// instead of logged as a real failure.
export function isAlreadyMirroredAssetError(error) {
  const message = String(error?.message || error || "");
  return message.includes("idx_client_assets_order_file_url_unique");
}
