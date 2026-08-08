// Pure, dependency-free logic for mirroring order files into File Manager's
// canonical "All Files -> Clients -> <Client> -> <category>" structure
// (folders/client_assets, provisioned by
// supabase/migrations/202608080001_client_order_asset_folder_provisioning.sql
// and supabase/migrations/202608080002_client_file_library_refinement.sql).
// Kept import-free (no @/ aliases, no JSX) so it can be unit tested directly
// by this project's plain `node --test` runner — the same reason
// src/lib/orderThumbnail.js exists as its own module rather than living
// inline in a .jsx file.
//
// As of Phase 1A.1, orders are NOT physical folders in this structure —
// order_number is metadata/filtering only (orders.file_urls), not a path
// segment. A canonical client asset exists once per (client_id, file_url)
// and is reusable across every order that references it.

export const INVOICE_FOLDER_ID = "__invoices";

// The full standard client category set, provisioned up front by
// provision_order_asset_folders() even before any file is attached.
export const ORDER_ASSET_CATEGORIES = Object.freeze([
  "Mockups",
  "Artwork",
  "Brand Assets",
  "References",
  "Production",
  "QC / Finished",
  "Invoices & Quotes",
  "Delivery",
  "General",
]);

// Maps an order's own built-in folder id (stable ids from
// OrderDrawerShared.jsx's DEFAULT_ORDER_FILE_FOLDERS, plus INVOICE_FOLDER_ID)
// to the matching client category. Anything this map doesn't recognize — an
// ad hoc staff-created folder, or no folder at all — falls back to
// "General" rather than inventing a new category.
const ORDER_ASSET_CATEGORY_MAP = Object.freeze({
  mockups: "Mockups",
  artwork: "Artwork",
  brand_assets: "Brand Assets",
  references: "References",
  production: "Production",
  qc_finished: "QC / Finished",
  delivery: "Delivery",
  general: "General",
  [INVOICE_FOLDER_ID]: "Invoices & Quotes",
});

// Reverse of ORDER_ASSET_CATEGORY_MAP: client category name -> order
// folder id. Used when linking an existing client asset into an order (the
// order side still organizes files by its own local folder ids) and when
// syncing an order-side category move back to the client library.
const CATEGORY_TO_ORDER_FOLDER_ID = Object.freeze(
  Object.fromEntries(
    Object.entries(ORDER_ASSET_CATEGORY_MAP)
      .filter(([folderId]) => folderId !== INVOICE_FOLDER_ID)
      .map(([folderId, category]) => [category, folderId])
  )
);

export function resolveOrderAssetCategory(folderId) {
  return ORDER_ASSET_CATEGORY_MAP[folderId] || "General";
}

// Client category name -> order folder id. Unknown/unrecognized category
// names (defensive — every category client_assets can be filed under comes
// from ORDER_ASSET_CATEGORIES) fall back to "general".
export function resolveOrderFolderIdForCategory(category) {
  return CATEGORY_TO_ORDER_FOLDER_ID[category] || "general";
}

// The client_assets mirror insert can be rejected by either unique
// constraint depending on which identity signal it collided on:
// idx_client_assets_order_file_url_unique (order_id, file_url) — the
// Phase 1A signal, still enforced for backward compatibility — or
// idx_client_assets_client_file_url_unique (client_id, file_url) — the
// Phase 1A.1 canonical signal. Both mean the same thing to the caller:
// "this exact placement already exists, not a real failure."
export function isAlreadyMirroredAssetError(error) {
  const message = String(error?.message || error || "");
  return (
    message.includes("idx_client_assets_order_file_url_unique") ||
    message.includes("idx_client_assets_client_file_url_unique")
  );
}
