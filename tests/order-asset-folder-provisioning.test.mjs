import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ORDER_ASSET_CATEGORIES,
  INVOICE_FOLDER_ID,
  resolveOrderAssetCategory,
  isAlreadyMirroredAssetError,
} from "../src/lib/orderAssetFolders.js";

// src/components/orders/drawer/OrderDrawerShared.jsx and the pages/components
// that call into it talk to Supabase directly through the @/ alias (no test
// double exists for dataClient anywhere in this repo — the same constraint
// documented in tests/order-invoice-sync.test.mjs and
// tests/invoice-reliability.test.mjs), so the wiring-coverage tests below
// pin the exact call sites in source rather than executing them. The pure
// mapping/predicate logic in src/lib/orderAssetFolders.js is dependency-free
// and gets real, executed coverage.

test("known built-in order folders map to their canonical category", () => {
  assert.equal(resolveOrderAssetCategory("mockups"), "Mockups");
  assert.equal(resolveOrderAssetCategory("artwork"), "Artwork");
  assert.equal(resolveOrderAssetCategory("production"), "Production");
});

// A. The INVOICE_FOLDER_ID -> "Invoices & Quotes" mapping primitive exists
// and is exercised here purely as a pure-function fact, for later invoice
// integration work. It is NOT evidence that anything today actually
// routes a file into it — see "B" below and the OrderFilesTab.jsx tests
// further down, which confirm the opposite: every add-file entry point is
// disabled while viewing that folder, specifically so this mapping can't
// silently be reached by accident.
test("INVOICE_FOLDER_ID maps to 'Invoices & Quotes' as a mapping primitive only — not a wired attachment path", () => {
  assert.equal(resolveOrderAssetCategory(INVOICE_FOLDER_ID), "Invoices & Quotes");
});

test("unrecognized or absent folders fall back to General, not an invented category", () => {
  // brand_assets/references gained real mappings in Phase 1A.1 — see
  // tests/client-file-library-refinement.test.mjs — so they're no longer
  // examples of the General fallback; only genuinely unknown/absent ids
  // are, exercised here.
  assert.equal(resolveOrderAssetCategory("folder-abc123"), "General");
  assert.equal(resolveOrderAssetCategory(""), "General");
  assert.equal(resolveOrderAssetCategory(undefined), "General");
});

// As of Phase 1A.1 (202608080002), this is the canonical CLIENT category
// set — 9 categories, up from Phase 1A's 7 (added Brand Assets and
// References). See tests/client-file-library-refinement.test.mjs for the
// Phase 1A.1-specific coverage (client-first hierarchy, canonical
// same-client-file dedup, bulk reuse).
test("ORDER_ASSET_CATEGORIES lists exactly the 9 standard client categories the DB RPC provisions", () => {
  assert.deepEqual(ORDER_ASSET_CATEGORIES, [
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
});

test("isAlreadyMirroredAssetError recognizes either unique-constraint message, nothing else", () => {
  assert.equal(
    isAlreadyMirroredAssetError(new Error('duplicate key value violates unique constraint "idx_client_assets_order_file_url_unique"')),
    true,
    "the Phase 1A order/file signal, kept for backward compatibility"
  );
  assert.equal(
    isAlreadyMirroredAssetError(new Error('duplicate key value violates unique constraint "idx_client_assets_client_file_url_unique"')),
    true,
    "the Phase 1A.1 canonical client/file signal"
  );
  assert.equal(isAlreadyMirroredAssetError(new Error("network timeout")), false);
  assert.equal(isAlreadyMirroredAssetError(null), false);
  assert.equal(isAlreadyMirroredAssetError(undefined), false);
});

async function readSource(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("mirrorOrderFileToClientAssetFolder never re-uploads a binary — it only ever reuses fileUrl", async () => {
  const source = await readSource("src/components/orders/drawer/OrderDrawerShared.jsx");
  const start = source.indexOf("export async function mirrorOrderFileToClientAssetFolder");
  assert.notEqual(start, -1, "mirrorOrderFileToClientAssetFolder must exist in OrderDrawerShared.jsx");
  const end = source.indexOf("\n}", start);
  const body = source.slice(start, end);
  assert.ok(!body.includes("UploadFile"), "the mirror helper must never call the upload integration");
  assert.ok(body.includes("file_url: fileUrl"), "the mirror helper must reuse the caller's fileUrl as the storage reference");
});

test("mirrorOrderFileToClientAssetFolder swallows every failure so it can never fail the caller's save", async () => {
  const source = await readSource("src/components/orders/drawer/OrderDrawerShared.jsx");
  const start = source.indexOf("export async function mirrorOrderFileToClientAssetFolder");
  const end = source.indexOf("\n}", start);
  const body = source.slice(start, end);
  assert.ok(/try\s*{/.test(body), "must wrap its Supabase calls in try/catch");
  assert.ok(/catch\s*\(error\)\s*{/.test(body), "must catch errors rather than let them propagate");
  const catchBlock = body.slice(body.indexOf("catch (error)"));
  assert.ok(!/\bthrow\b/.test(catchBlock), "the catch block must not re-throw — a mirror failure must stay non-blocking");
});

test("normal drag/drop order upload (OrderDrawer.jsx) calls the common mirror helper for every uploaded file", async () => {
  const source = await readSource("src/components/orders/OrderDrawer.jsx");
  assert.ok(
    source.includes('import { normalizeOrderFileFolders, mirrorOrderFileToClientAssetFolder } from "@/components/orders/drawer/OrderDrawerShared"'),
    "OrderDrawer.jsx must import the shared mirror helper"
  );
  const uploadStart = source.indexOf("const uploadFile = async");
  assert.notEqual(uploadStart, -1);
  const uploadEnd = source.indexOf("\n  };", uploadStart);
  const uploadBody = source.slice(uploadStart, uploadEnd);
  assert.ok(uploadBody.includes("mirrorOrderFileToClientAssetFolder("), "uploadFile must call the mirror helper per uploaded file");
});

test("pasted file link (OrderFilesTab.jsx pasteFileLinkUrl) calls the common mirror helper for new attachments", async () => {
  const source = await readSource("src/components/orders/drawer/OrderFilesTab.jsx");
  assert.ok(
    source.includes('mirrorOrderFileToClientAssetFolder } from "./OrderDrawerShared"') ||
    source.includes("mirrorOrderFileToClientAssetFolder"),
    "OrderFilesTab.jsx must import the shared mirror helper"
  );
  const start = source.indexOf("const pasteFileLinkUrl = async");
  assert.notEqual(start, -1);
  const end = source.indexOf("\n  };", start);
  const body = source.slice(start, end);
  assert.ok(body.includes("mirrorOrderFileToClientAssetFolder("), "pasteFileLinkUrl must call the mirror helper");
  assert.ok(body.includes("if (!existing)"), "the mirror call must be gated to genuinely new file attachments, not every folder-copy operation");
});

test("linking an existing client-library file into an order (linkClientFileToOrder) calls the common mirror helper", async () => {
  const source = await readSource("src/components/orders/drawer/OrderFilesTab.jsx");
  const start = source.indexOf("const linkClientFileToOrder = (file)");
  assert.notEqual(start, -1);
  const end = source.indexOf("\n  };", start);
  const body = source.slice(start, end);
  assert.ok(body.includes("mirrorOrderFileToClientAssetFolder("), "linkClientFileToOrder must call the mirror helper");
  assert.ok(body.includes("if (!exists)"), "the mirror call must be gated to genuinely new order attachments");
});

test("order creation (Orders.jsx) provisions the standard folder structure even with zero files", async () => {
  const source = await readSource("src/pages/Orders.jsx");
  assert.ok(source.includes("provisionOrderAssetFolders"), "Orders.jsx must call provisionOrderAssetFolders on order creation");
  const start = source.indexOf("onCreate={async (orderData)");
  assert.notEqual(start, -1);
  const end = source.indexOf("}}\n          />", start);
  const body = source.slice(start, end);
  assert.ok(body.includes("provisionOrderAssetFolders(createdOrder)"), "provisioning must run for every created order, independent of whether it has files");
  assert.ok(body.includes("mirrorOrderFileToClientAssetFolder("), "any files present at creation time (e.g. repeat-order) must also be mirrored, not silently skipped");
});

test("no call site bypasses the shared mirror helper with an ad hoc client_assets insert", async () => {
  const files = [
    "src/components/orders/OrderDrawer.jsx",
    "src/components/orders/drawer/OrderFilesTab.jsx",
    "src/pages/Orders.jsx",
  ];
  for (const file of files) {
    const source = await readSource(file);
    assert.ok(
      !source.includes("entities.ClientAsset.create"),
      `${file} must go through mirrorOrderFileToClientAssetFolder, not call ClientAsset.create directly`
    );
  }
});

// B. The Invoices & Quotes folder view is backed by order.invoice_files, not
// order.file_urls/fileFolders — it is a read-only summary of a workflow this
// PR does not touch. These tests confirm every add-file entry point
// (upload, paste-link, client-library-to-order link) is disabled while
// viewing it, so a staff member can never be shown a "success" state for a
// file that actually landed as a plain General-category order file instead
// of in Invoices & Quotes.
test("Invoices & Quotes folder view hides every add-file action and shows a read-only explanation", async () => {
  const source = await readSource("src/components/orders/drawer/OrderFilesTab.jsx");
  const returnStart = source.indexOf('<div className="space-y-4">');
  assert.notEqual(returnStart, -1, "component render body must exist");
  const gateStart = source.indexOf("isInvoiceFolder ? (", returnStart);
  assert.notEqual(gateStart, -1, "the top action row must branch on isInvoiceFolder");
  const gateEnd = source.indexOf("{!openFolderId ? (", gateStart);
  const gateBlock = source.slice(gateStart, gateEnd);
  // The ternary's source necessarily contains both branches' text; what
  // matters is that the add-file actions live strictly in the ") : (" arm
  // (rendered when isInvoiceFolder is false), not the "isInvoiceFolder ? ("
  // arm (rendered when true).
  const branchSplit = gateBlock.indexOf(") : (");
  assert.notEqual(branchSplit, -1, "must be a genuine if/else ternary, not a single unconditional block");
  const invoiceFolderBranch = gateBlock.slice(0, branchSplit);
  const otherFoldersBranch = gateBlock.slice(branchSplit);
  assert.ok(
    /managed from the invoice\/quote workflow/i.test(invoiceFolderBranch),
    "the isInvoiceFolder-true branch must explain that invoice/quote files are managed elsewhere, not added here"
  );
  assert.ok(!invoiceFolderBranch.includes("Upload files"), "upload must not be offered while viewing Invoices & Quotes");
  assert.ok(!invoiceFolderBranch.includes("Paste file link"), "paste-link must not be offered while viewing Invoices & Quotes");
  assert.ok(!invoiceFolderBranch.includes("<ClientAccountFilesPanel"), "client-library-to-order linking must not be offered while viewing Invoices & Quotes");
  assert.ok(otherFoldersBranch.includes("Upload files"), "upload must still be offered for every other folder view");
  assert.ok(otherFoldersBranch.includes("Paste file link"), "paste-link must still be offered for every other folder view");
  assert.ok(otherFoldersBranch.includes("<ClientAccountFilesPanel"), "client-library-to-order linking must still be offered for every other folder view");
});

test("pasteFileLinkUrl's INVOICE_FOLDER_ID exclusion is a defensive fallback, not the primary safeguard — the UI gate above is", async () => {
  const source = await readSource("src/components/orders/drawer/OrderFilesTab.jsx");
  const start = source.indexOf("const pasteFileLinkUrl = async");
  const end = source.indexOf("\n  };", start);
  const body = source.slice(start, end);
  assert.ok(
    body.includes('folderId !== INVOICE_FOLDER_ID'),
    "even if ever reached, pasteFileLinkUrl must still never file a link under the invoice category id"
  );
});
