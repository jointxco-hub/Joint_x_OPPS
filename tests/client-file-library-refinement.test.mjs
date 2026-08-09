import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  resolveOrderAssetCategory,
  resolveOrderFolderIdForCategory,
  ORDER_ASSET_CATEGORIES,
  INVOICE_FOLDER_ID,
} from "../src/lib/orderAssetFolders.js";
import {
  resolveClientCategoryFromFolder,
  dedupeSelectedAssets,
  determineAlreadyLinkedState,
  buildBulkOrderFileLinkPatch,
} from "../src/lib/clientAssetOrderLink.js";

async function readSource(relativePath) {
  const raw = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  // Some files in this repo are checked out with CRLF line endings; every
  // source-pattern test below matches against \n-based substrings, so
  // normalize once here rather than special-case each test.
  return raw.replace(/\r\n/g, "\n");
}

// ─────────────────────────────────────────────────────────────────────
// 8/9. Category mapping — Brand Assets, References, QC / Finished,
// Delivery, General, and the full reverse mapping.
// ─────────────────────────────────────────────────────────────────────

test("Brand Assets and References map correctly (new in Phase 1A.1)", () => {
  assert.equal(resolveOrderAssetCategory("brand_assets"), "Brand Assets");
  assert.equal(resolveOrderAssetCategory("references"), "References");
});

test("QC / Finished, Delivery, and General map correctly", () => {
  assert.equal(resolveOrderAssetCategory("qc_finished"), "QC / Finished");
  assert.equal(resolveOrderAssetCategory("delivery"), "Delivery");
  assert.equal(resolveOrderAssetCategory("general"), "General");
});

test("reverse mapping (client category -> order folder id) round-trips every non-invoice category", () => {
  for (const category of ORDER_ASSET_CATEGORIES) {
    if (category === "Invoices & Quotes") continue;
    const orderFolderId = resolveOrderFolderIdForCategory(category);
    assert.equal(resolveOrderAssetCategory(orderFolderId), category, `category "${category}" must round-trip through its order folder id`);
  }
});

test("an unrecognized category name reverse-maps to the general order folder id, not an invented one", () => {
  assert.equal(resolveOrderFolderIdForCategory("Some Made Up Category"), "general");
  assert.equal(resolveOrderFolderIdForCategory(undefined), "general");
});

// ─────────────────────────────────────────────────────────────────────
// 10. Invoices & Quotes stays excluded from the reverse mapping used by
// the generic writable reuse flow — it must never be a valid link target
// for buildBulkOrderFileLinkPatch.
// ─────────────────────────────────────────────────────────────────────

test("Invoices & Quotes has no reverse-mapped order folder id — it cannot be a bulk-link target", () => {
  assert.equal(resolveOrderFolderIdForCategory("Invoices & Quotes"), "general");
});

// ─────────────────────────────────────────────────────────────────────
// resolveClientCategoryFromFolder
// ─────────────────────────────────────────────────────────────────────

test("resolveClientCategoryFromFolder reads the category name only from a real client_category folder", () => {
  assert.equal(resolveClientCategoryFromFolder({ folder_kind: "client_category", name: "Mockups" }), "Mockups");
  assert.equal(resolveClientCategoryFromFolder({ folder_kind: "client_root", name: "Lazi" }), "General");
  assert.equal(resolveClientCategoryFromFolder({ folder_kind: "clients_root", name: "Clients" }), "General");
  assert.equal(resolveClientCategoryFromFolder(null), "General");
  assert.equal(resolveClientCategoryFromFolder(undefined), "General");
});

// ─────────────────────────────────────────────────────────────────────
// dedupeSelectedAssets / determineAlreadyLinkedState
// ─────────────────────────────────────────────────────────────────────

test("dedupeSelectedAssets removes repeats by file_url, preserving first-seen order", () => {
  const assets = [
    { id: "a", file_url: "https://x/1.png" },
    { id: "b", file_url: "https://x/2.png" },
    { id: "c", file_url: "https://x/1.png" },
  ];
  const result = dedupeSelectedAssets(assets);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((a) => a.id), ["a", "b"]);
});

test("determineAlreadyLinkedState flags assets whose file_url is already on the order, without mutating originals", () => {
  const assets = [{ id: "a", file_url: "https://x/1.png" }, { id: "b", file_url: "https://x/2.png" }];
  const result = determineAlreadyLinkedState(assets, ["https://x/1.png"]);
  assert.equal(result[0].alreadyLinkedToOrder, true);
  assert.equal(result[1].alreadyLinkedToOrder, false);
  assert.equal(assets[0].alreadyLinkedToOrder, undefined, "must not mutate the input objects");
});

// ─────────────────────────────────────────────────────────────────────
// 7. buildBulkOrderFileLinkPatch — the core Order Drawer "Add from client
// library" pure logic.
// ─────────────────────────────────────────────────────────────────────

test("buildBulkOrderFileLinkPatch preserves every existing file_urls entry", () => {
  const { patch } = buildBulkOrderFileLinkPatch({
    fileUrls: ["https://x/existing.png"],
    orderFileFolders: { fileFolders: {}, fileLabels: {}, fileCopies: [] },
    selectedAssets: [{ id: "new1", file_url: "https://x/new1.png", title: "New 1", folder_id: "f1" }],
    categoryByFolderId: { f1: "Mockups" },
  });
  assert.deepEqual(patch.file_urls, ["https://x/existing.png", "https://x/new1.png"]);
});

test("buildBulkOrderFileLinkPatch dedupes selections against each other and against what's already on the order", () => {
  const { patch, newlyLinkedCount, totalSelected } = buildBulkOrderFileLinkPatch({
    fileUrls: ["https://x/already.png"],
    orderFileFolders: { fileFolders: {}, fileLabels: {}, fileCopies: [] },
    selectedAssets: [
      { id: "a", file_url: "https://x/already.png", title: "Already", folder_id: "f1" },
      { id: "b", file_url: "https://x/new.png", title: "New", folder_id: "f1" },
      { id: "c", file_url: "https://x/new.png", title: "New dup", folder_id: "f1" },
    ],
    categoryByFolderId: { f1: "Mockups" },
  });
  assert.deepEqual(patch.file_urls, ["https://x/already.png", "https://x/new.png"]);
  assert.equal(totalSelected, 2, "the exact-duplicate selection collapses to one");
  assert.equal(newlyLinkedCount, 1, "only the genuinely new file counts as newly linked");
});

test("buildBulkOrderFileLinkPatch links multiple selected assets in one patch", () => {
  const { patch, newlyLinkedCount } = buildBulkOrderFileLinkPatch({
    fileUrls: [],
    orderFileFolders: { fileFolders: {}, fileLabels: {}, fileCopies: [] },
    selectedAssets: [
      { id: "a", file_url: "https://x/1.png", title: "One", folder_id: "f1" },
      { id: "b", file_url: "https://x/2.png", title: "Two", folder_id: "f2" },
      { id: "c", file_url: "https://x/3.png", title: "Three", folder_id: "f3" },
    ],
    categoryByFolderId: { f1: "Mockups", f2: "Artwork", f3: "Delivery" },
  });
  assert.equal(newlyLinkedCount, 3);
  assert.deepEqual(patch.file_urls, ["https://x/1.png", "https://x/2.png", "https://x/3.png"]);
});

test("buildBulkOrderFileLinkPatch preserves existing fileCopies untouched", () => {
  const existingCopies = [{ id: "copy-1", url: "https://x/existing.png", folderId: "artwork", label: "Existing copy" }];
  const { patch } = buildBulkOrderFileLinkPatch({
    fileUrls: ["https://x/existing.png"],
    orderFileFolders: { fileFolders: {}, fileLabels: {}, fileCopies: existingCopies },
    selectedAssets: [{ id: "new1", file_url: "https://x/new1.png", title: "New", folder_id: "f1" }],
    categoryByFolderId: { f1: "Mockups" },
  });
  assert.deepEqual(patch.order_file_folders.fileCopies, existingCopies);
});

test("buildBulkOrderFileLinkPatch preserves existing fileFolders/fileLabels entries and adds new ones", () => {
  const { patch } = buildBulkOrderFileLinkPatch({
    fileUrls: ["https://x/existing.png"],
    orderFileFolders: {
      fileFolders: { "https://x/existing.png": "production" },
      fileLabels: { "file:https://x/existing.png": "Existing label" },
      fileCopies: [],
    },
    selectedAssets: [{ id: "new1", file_url: "https://x/new1.png", title: "New Mockup", folder_id: "f1" }],
    categoryByFolderId: { f1: "Mockups" },
  });
  assert.equal(patch.order_file_folders.fileFolders["https://x/existing.png"], "production", "unrelated existing entry preserved");
  assert.equal(patch.order_file_folders.fileFolders["https://x/new1.png"], "mockups", "new entry uses the reverse-mapped category");
  assert.equal(patch.order_file_folders.fileLabels["file:https://x/existing.png"], "Existing label", "unrelated existing label preserved");
  assert.equal(patch.order_file_folders.fileLabels["file:https://x/new1.png"], "New Mockup", "new label taken from the asset's title");
});

test("buildBulkOrderFileLinkPatch category reverse mapping is correct for every category", () => {
  const selectedAssets = [
    { id: "1", file_url: "https://x/mockup.png", title: "Mockup", folder_id: "mockups-folder" },
    { id: "2", file_url: "https://x/artwork.png", title: "Artwork", folder_id: "artwork-folder" },
    { id: "3", file_url: "https://x/brand.png", title: "Brand", folder_id: "brand-folder" },
    { id: "4", file_url: "https://x/ref.png", title: "Ref", folder_id: "ref-folder" },
    { id: "5", file_url: "https://x/prod.png", title: "Prod", folder_id: "prod-folder" },
    { id: "6", file_url: "https://x/qc.png", title: "QC", folder_id: "qc-folder" },
    { id: "7", file_url: "https://x/delivery.png", title: "Delivery", folder_id: "delivery-folder" },
    { id: "8", file_url: "https://x/general.png", title: "General", folder_id: "general-folder" },
  ];
  const categoryByFolderId = {
    "mockups-folder": "Mockups",
    "artwork-folder": "Artwork",
    "brand-folder": "Brand Assets",
    "ref-folder": "References",
    "prod-folder": "Production",
    "qc-folder": "QC / Finished",
    "delivery-folder": "Delivery",
    "general-folder": "General",
  };
  const { patch } = buildBulkOrderFileLinkPatch({
    fileUrls: [],
    orderFileFolders: { fileFolders: {}, fileLabels: {}, fileCopies: [] },
    selectedAssets,
    categoryByFolderId,
  });
  assert.equal(patch.order_file_folders.fileFolders["https://x/mockup.png"], "mockups");
  assert.equal(patch.order_file_folders.fileFolders["https://x/artwork.png"], "artwork");
  assert.equal(patch.order_file_folders.fileFolders["https://x/brand.png"], "brand_assets");
  assert.equal(patch.order_file_folders.fileFolders["https://x/ref.png"], "references");
  assert.equal(patch.order_file_folders.fileFolders["https://x/prod.png"], "production");
  assert.equal(patch.order_file_folders.fileFolders["https://x/qc.png"], "qc_finished");
  assert.equal(patch.order_file_folders.fileFolders["https://x/delivery.png"], "delivery");
  assert.equal(patch.order_file_folders.fileFolders["https://x/general.png"], "general");
});

// ─────────────────────────────────────────────────────────────────────
// 11. private-upload:// refs remain canonical refs through the whole
// pure patch-building path — never rewritten, transformed, or resolved
// to a signed URL.
// ─────────────────────────────────────────────────────────────────────

test("a private-upload:// file_url passes through buildBulkOrderFileLinkPatch unchanged", () => {
  const privateRef = "private-upload://uploads/tenant-a/order-1/mockup-final.png";
  const { patch } = buildBulkOrderFileLinkPatch({
    fileUrls: [],
    orderFileFolders: { fileFolders: {}, fileLabels: {}, fileCopies: [] },
    selectedAssets: [{ id: "1", file_url: privateRef, title: "Mockup", folder_id: "f1" }],
    categoryByFolderId: { f1: "Mockups" },
  });
  assert.deepEqual(patch.file_urls, [privateRef]);
});

// ─────────────────────────────────────────────────────────────────────
// 5/6. Canonical same-client-file dedup and cross-order reuse — pure
// logic lives in mirrorOrderFileToClientAssetFolder itself (Supabase-
// backed, no test double — same constraint as the rest of this file's
// source-pattern tests), so these confirm the dedup-then-create control
// flow and the update-only-if-uncategorized rule exist in source.
// ─────────────────────────────────────────────────────────────────────

test("mirrorOrderFileToClientAssetFolder looks up an existing (client_id, file_url) row before ever creating one", async () => {
  const source = await readSource("src/components/orders/drawer/OrderDrawerShared.jsx");
  const start = source.indexOf("export async function mirrorOrderFileToClientAssetFolder");
  const end = source.indexOf("\n}", start);
  const body = source.slice(start, end);
  assert.ok(body.includes("filter({ client_id: order.client_id, file_url: fileUrl }"), "must dedup-check by (client_id, file_url), not (order_id, file_url)");
  const filterIndex = body.indexOf("assets.filter(");
  const createIndex = body.indexOf("assets.create(");
  assert.ok(filterIndex !== -1 && createIndex !== -1 && filterIndex < createIndex, "the existing-asset lookup must run before create");
});

test("mirrorOrderFileToClientAssetFolder reuses an existing asset instead of creating a second row for the same client+file", async () => {
  const source = await readSource("src/components/orders/drawer/OrderDrawerShared.jsx");
  const start = source.indexOf("export async function mirrorOrderFileToClientAssetFolder");
  const end = source.indexOf("\n}", start);
  const body = source.slice(start, end);
  const existingBlockStart = body.indexOf("if (existingAsset) {");
  assert.notEqual(existingBlockStart, -1);
  const existingBlockEnd = body.indexOf("await assets.create(");
  const existingBlock = body.slice(existingBlockStart, existingBlockEnd);
  assert.ok(/return;/.test(existingBlock), "when an existing asset is found, the function must return before reaching create — never create a second row");
});

test("mirrorOrderFileToClientAssetFolder never overwrites an existing asset's file_url or order_id when reusing it", async () => {
  const source = await readSource("src/components/orders/drawer/OrderDrawerShared.jsx");
  const start = source.indexOf("export async function mirrorOrderFileToClientAssetFolder");
  const end = source.indexOf("\n}", start);
  const body = source.slice(start, end);
  const existingBlockStart = body.indexOf("if (existingAsset) {");
  const existingBlockEnd = body.indexOf("await assets.create(");
  const existingBlock = body.slice(existingBlockStart, existingBlockEnd);
  assert.ok(!existingBlock.includes("file_url:"), "reuse path must never rewrite file_url");
  assert.ok(!existingBlock.includes("order_id:"), "reuse path must never rewrite order_id — it stays legacy/origin metadata");
});

// ─────────────────────────────────────────────────────────────────────
// order file category move syncs the canonical client-library category
// (only for a real move, never a fileCopies placement)
// ─────────────────────────────────────────────────────────────────────

test("moveFile (OrderFilesTab.jsx) syncs the client asset category only for a real move, not a fileCopies placement", async () => {
  const source = await readSource("src/components/orders/drawer/OrderFilesTab.jsx");
  const start = source.indexOf("const moveFile = (entry, folderId)");
  assert.notEqual(start, -1);
  const end = source.indexOf("\n  };", start);
  const body = source.slice(start, end);
  const copyBranchEnd = body.indexOf("return;\n    }");
  const copyBranch = body.slice(0, copyBranchEnd);
  const realMoveBranch = body.slice(copyBranchEnd);
  assert.ok(copyBranch.includes("entry.isCopy"), "the copy branch must be the early-return one");
  assert.ok(!copyBranch.includes("syncOrderFileCategoryToClientAsset"), "a fileCopies placement must never sync the shared client-library category");
  assert.ok(realMoveBranch.includes("syncOrderFileCategoryToClientAsset("), "a real category move must sync the client-library category");
});

// ─────────────────────────────────────────────────────────────────────
// 12. FileManager direct client-category upload carries client_id
// ─────────────────────────────────────────────────────────────────────

test("FileManager direct upload sets client_id when uploading inside a client root/category, resolved from folder ancestry", async () => {
  const source = await readSource("src/pages/FileManager.jsx");
  assert.ok(source.includes("function resolveClientIdFromFolderAncestry"), "must resolve client_id via ancestry, not just the immediate folder");
  const start = source.indexOf("const uploadFiles = async");
  assert.notEqual(start, -1);
  const end = source.indexOf("\n  };", start);
  const body = source.slice(start, end);
  assert.ok(body.includes("client_id: currentClientId"), "ClientAsset.create during direct upload must carry client_id");
});

test("FileManager does not assign client_id when currentClientId is null (a normal internal folder)", async () => {
  const source = await readSource("src/pages/FileManager.jsx");
  const start = source.indexOf("function resolveClientIdFromFolderAncestry");
  const end = source.indexOf("\n}", start);
  const body = source.slice(start, end);
  assert.ok(/return null;/.test(body), "ancestry resolution must return null for folders outside any client's tree");
});

// ─────────────────────────────────────────────────────────────────────
// 13. FileManager order filter uses order.file_urls, never
// client_assets.order_id (a canonical asset can be reused across many
// orders, so order_id alone would under-report every order except the
// first one that ever linked it).
// ─────────────────────────────────────────────────────────────────────

test("FileManager order filter reads the selected order's file_urls, not client_assets.order_id", async () => {
  const source = await readSource("src/pages/FileManager.jsx");
  const start = source.indexOf("const visibleFiles = assets.filter(");
  assert.notEqual(start, -1);
  const end = source.indexOf(");", start);
  const body = source.slice(start, end);
  assert.ok(body.includes("selectedOrderUrls"), "must filter by the selected order's own file_urls set");
  assert.ok(!body.includes("a.order_id"), "must never filter by client_assets.order_id — a reused asset would be wrongly excluded from every order but its origin one");
});

test("FileManager order filter dropdown only appears while browsing inside a client's own folders", async () => {
  const source = await readSource("src/pages/FileManager.jsx");
  assert.ok(source.includes("{currentClientId && ("), "the order filter select must be conditionally rendered on currentClientId");
});

// ─────────────────────────────────────────────────────────────────────
// 14. Old X LAB account client panel remains present, unremoved,
// backward compatible.
// ─────────────────────────────────────────────────────────────────────

test("the old email-keyed X LAB account file panel is preserved, not removed", async () => {
  const source = await readSource("src/components/orders/drawer/OrderFilesTab.jsx");
  assert.ok(source.includes("function ClientAccountFilesPanel("), "ClientAccountFilesPanel component must still exist");
  assert.ok(source.includes("<ClientAccountFilesPanel"), "it must still be rendered");
  assert.ok(source.includes("getInternalClientFileLibrary"), "it must still be backed by the email-keyed client_file_links API, not the new canonical one");
});

test("the new canonical picker is a separate action from the old X LAB account panel, not a replacement of it", async () => {
  const source = await readSource("src/components/orders/drawer/OrderFilesTab.jsx");
  assert.ok(source.includes("Add from client library"), "the new bulk-reuse action must exist");
  assert.ok(source.includes("function ClientLibraryPickerModal("), "it must be its own component");
  const pickerStart = source.indexOf("function ClientLibraryPickerModal(");
  const pickerBody = source.slice(pickerStart);
  assert.ok(pickerBody.includes(").ClientAsset;") && pickerBody.includes("clientAssetEntity.filter("), "the new picker must read the canonical ClientAsset table");
  assert.ok(!pickerBody.includes("getInternalClientFileLibrary"), "the new picker must not use the old email-keyed API");
});

// ─────────────────────────────────────────────────────────────────────
// Bulk link toast wording / no UploadFile call anywhere in the picker
// or its link handler.
// ─────────────────────────────────────────────────────────────────────

test("linking existing client assets never calls the upload integration", async () => {
  const source = await readSource("src/components/orders/drawer/OrderFilesTab.jsx");
  const start = source.indexOf("const linkExistingClientAssets = (selectedAssets");
  assert.notEqual(start, -1);
  const end = source.indexOf("\n  };", start);
  const body = source.slice(start, end);
  assert.ok(!body.includes("UploadFile"), "bulk-linking existing assets must never call the upload integration");
  assert.ok(!body.includes("ClientAsset.create"), "bulk-linking must never create a new ClientAsset row — only patch the order");
});

// ─────────────────────────────────────────────────────────────────────
// FileManager copy semantics: a client-owned canonical asset can't be
// copied (would violate (client_id, file_url) uniqueness); an internal
// asset still can.
// ─────────────────────────────────────────────────────────────────────

test("FileManager disables Copy for a client-owned asset (client_id set) but keeps it for internal assets", async () => {
  // Phase 1B.1 routes this through the shared, directly-unit-tested
  // canCopyFileRecord() helper (see tests/file-gallery.test.mjs) instead of
  // an inline Boolean(file.client_id) check — same safety property
  // (client-owned canonical assets can never be duplicated via Copy),
  // now reusable and testable independent of this source-pattern pin.
  const source = await readSource("src/pages/FileManager.jsx");
  const start = source.indexOf("onClick={() => canCopyFileRecord(file) && setFileCopy(file)}");
  assert.notEqual(start, -1, "the Copy button must be gated on canCopyFileRecord(file)");
  const nearby = source.slice(start, start + 400);
  assert.ok(nearby.includes("disabled={!canCopyFileRecord(file)}"), "Copy must be disabled specifically for client-owned assets");
});
