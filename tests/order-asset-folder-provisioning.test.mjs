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
  assert.equal(resolveOrderAssetCategory(INVOICE_FOLDER_ID), "Invoices & Quotes");
});

test("unrecognized or absent folders fall back to General, not an invented category", () => {
  assert.equal(resolveOrderAssetCategory("brand_assets"), "General");
  assert.equal(resolveOrderAssetCategory("references"), "General");
  assert.equal(resolveOrderAssetCategory("folder-abc123"), "General");
  assert.equal(resolveOrderAssetCategory(""), "General");
  assert.equal(resolveOrderAssetCategory(undefined), "General");
});

test("ORDER_ASSET_CATEGORIES lists exactly the 7 standard subfolders the DB RPC provisions", () => {
  assert.deepEqual(ORDER_ASSET_CATEGORIES, [
    "Mockups",
    "Artwork",
    "Production",
    "QC / Finished",
    "Invoices & Quotes",
    "Delivery",
    "General",
  ]);
});

test("isAlreadyMirroredAssetError recognizes the unique-constraint message, nothing else", () => {
  assert.equal(
    isAlreadyMirroredAssetError(new Error('duplicate key value violates unique constraint "idx_client_assets_order_file_url_unique"')),
    true
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
