import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(relativePath) {
  const raw = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  return raw.replace(/\r\n/g, "\n");
}

// ─────────────────────────────────────────────────────────────────────
// Order Line Coherence Phase 1B - ClientAssetPickerModal "Upload New".
// One shared implementation reused by both real consumers (artwork
// linking, line thumbnail); canonical ClientAsset first, reference
// second; explicit per-consumer category; auto-select in single mode;
// family/treatment artwork scope protections untouched.
// ─────────────────────────────────────────────────────────────────────

test("Upload New reuses the canonical upload primitive - UploadFile appears exactly once in the picker, never a second upload implementation", async () => {
  const source = await readSource("src/components/files/ClientAssetPickerModal.jsx");
  const calls = source.match(/UploadFile\(/g) || [];
  assert.equal(calls.length, 1);
  assert.ok(source.includes("dataClient.integrations.Core.UploadFile({ file })"), "must call the same canonical primitive OrderDrawer.jsx/FileManager.jsx already use");
});

test("a successful upload creates or reuses a real canonical ClientAsset - never a second/order-only reference table or blob", async () => {
  const source = await readSource("src/components/files/ClientAssetPickerModal.jsx");
  const mutationStart = source.indexOf("const uploadMutation = useMutation({");
  assert.notEqual(mutationStart, -1);
  const mutationEnd = source.indexOf("const handleFileChosen", mutationStart);
  const body = source.slice(mutationStart, mutationEnd);
  assert.ok(body.includes("clientAssetEntity.filter({ client_id: clientId, file_url }"), "must check for an existing ClientAsset by (client_id, file_url) before creating a second one");
  assert.ok(body.includes("if (existingAsset) return existingAsset;"), "an existing row for the same file_url must be reused, not duplicated");
  assert.ok(body.includes("clientAssetEntity.create({"), "a genuinely new file must create a real ClientAsset row");
  assert.ok(!/orders\.file_urls|order\.file_urls|dataClient\.entities\.Order\.update/.test(body), "the upload path itself must never write directly to an order - only the canonical asset");
});

test("category/folder is explicitly required from the consumer via uploadCategory - the Upload New control does not render when it is missing, and is never guessed/defaulted", async () => {
  const source = await readSource("src/components/files/ClientAssetPickerModal.jsx");
  assert.ok(source.includes("uploadCategory = \"\","), "uploadCategory must default to empty (opt-in), never a guessed category");
  assert.ok(source.includes("{uploadCategory && Boolean(clientId) && ("), "the Upload New button/input must only render when the consumer explicitly supplied a category and a client is linked");
  const mutationStart = source.indexOf("const uploadMutation = useMutation({");
  const mutationEnd = source.indexOf("const handleFileChosen", mutationStart);
  const body = source.slice(mutationStart, mutationEnd);
  assert.ok(body.includes('if (!uploadCategory) throw new Error("Upload category not configured for this picker.");'), "the mutation itself must also refuse to run without a category, defense in depth beyond the render gate");
});

test("the destination folder_id is resolved from the client's own already-fetched folders for uploadCategory, falling back to null (uncategorized) rather than inventing a new get-or-create-folder RPC", async () => {
  const source = await readSource("src/components/files/ClientAssetPickerModal.jsx");
  assert.ok(source.includes("const targetFolder = clientFolders.find((folder) => resolveClientCategoryFromFolder(folder) === uploadCategory);"));
  assert.ok(source.includes("folder_id: targetFolder?.id ?? null,"));
  assert.ok(!/get_or_create|getOrCreateOrderAssetFolder/.test(source), "must not call the order-scoped get-or-create-folder RPC, which requires an order_id this picker does not always have");
});

test("selectionMode single: a successful upload auto-selects the new asset and continues through the exact same onConfirm path a click on an existing tile would take", async () => {
  const source = await readSource("src/components/files/ClientAssetPickerModal.jsx");
  const onSuccessStart = source.indexOf("onSuccess: (asset) => {");
  assert.notEqual(onSuccessStart, -1);
  const onSuccessEnd = source.indexOf("onError:", onSuccessStart);
  const body = source.slice(onSuccessStart, onSuccessEnd);
  assert.ok(body.includes('if (selectionMode === "single") {'));
  assert.ok(body.includes("onConfirm([asset], categoryByFolderId);"), "single mode must call onConfirm exactly like the existing tile-click path (toggleSelected) does");
});

test("selectionMode multi: a successful upload pre-selects the asset for the explicit Link N files action rather than auto-confirming", async () => {
  const source = await readSource("src/components/files/ClientAssetPickerModal.jsx");
  const onSuccessStart = source.indexOf("onSuccess: (asset) => {");
  const onSuccessEnd = source.indexOf("onError:", onSuccessStart);
  const body = source.slice(onSuccessStart, onSuccessEnd);
  assert.ok(body.includes("setSelectedIds((current) => new Set(current).add(asset.id));"));
  assert.ok(body.includes('toast.success("File uploaded")'));
});

test("error states surface via toast.error and never crash the picker - upload failure, ClientAsset creation failure (propagates the same way), and missing category are all covered", async () => {
  const source = await readSource("src/components/files/ClientAssetPickerModal.jsx");
  assert.ok(source.includes('if (!file_url) throw new Error("Upload failed - no file was stored.");'));
  assert.ok(source.includes('onError: (error) => toast.error(error?.message || "Upload failed"),'));
  // ClientAsset.create rejecting is not separately caught inside mutationFn -
  // it propagates to the same onError handler as an upload failure, so
  // there is exactly one error path for the whole operation, not two.
  const mutationStart = source.indexOf("const uploadMutation = useMutation({");
  const mutationEnd = source.indexOf("const handleFileChosen", mutationStart);
  const body = source.slice(mutationStart, mutationEnd);
  assert.ok(!/catch/.test(body), "mutationFn must not swallow a ClientAsset.create rejection - it should propagate to the mutation's own onError");
});

test("retry is safe: choosing a file again after a failed attempt clears the file input value first, so selecting the SAME file twice in a row still fires a fresh upload attempt", async () => {
  const source = await readSource("src/components/files/ClientAssetPickerModal.jsx");
  const start = source.indexOf("const handleFileChosen = (event) => {");
  assert.notEqual(start, -1);
  const body = source.slice(start, start + 200);
  assert.ok(body.includes('event.target.value = "";'));
  assert.ok(body.includes("uploadMutation.mutate(file)"));
});

test("the Upload button is disabled and shows an in-progress label while a previous upload is still pending, preventing a double-submit", async () => {
  const source = await readSource("src/components/files/ClientAssetPickerModal.jsx");
  assert.ok(source.includes("disabled={uploadMutation.isPending}"));
  assert.ok(source.includes('{uploadMutation.isPending ? "Uploading..." : "Upload new"}'));
});

test("a successful upload invalidates both the client asset and client folder queries, so the picker's own list reflects the new file immediately without a manual refresh", async () => {
  const source = await readSource("src/components/files/ClientAssetPickerModal.jsx");
  const onSuccessStart = source.indexOf("onSuccess: (asset) => {");
  const onSuccessEnd = source.indexOf("onError:", onSuccessStart);
  const body = source.slice(onSuccessStart, onSuccessEnd);
  assert.ok(body.includes('queryClient.invalidateQueries({ queryKey: ["clientLibraryAssets", clientId] });'));
  assert.ok(body.includes('queryClient.invalidateQueries({ queryKey: ["clientLibraryFolders", clientId] });'));
});

// ─────────────────────────────────────────────────────────────────────
// Real consumer wiring
// ─────────────────────────────────────────────────────────────────────

test("artwork linking (ComponentFieldsForm) explicitly supplies uploadCategory=\"Artwork\" - never relies on a default", async () => {
  const source = await readSource("src/components/composition/ComponentFieldsForm.jsx");
  const start = source.indexOf("<ClientAssetPickerModal");
  const end = source.indexOf("/>", start);
  const body = source.slice(start, end);
  assert.ok(body.includes('uploadCategory="Artwork"'));
  // defaultCategory was removed app-wide: it pre-restricted the picker to a
  // category the client often had no files in, so the list opened empty
  // under a control still reading "All categories". The picker now always
  // opens unrestricted. See client-asset-picker-category-filter.test.mjs.
  assert.ok(!body.includes('defaultCategory'));
});

test("family/treatment artwork scope protection is untouched by this change - allowArtworkLinking still gates the ENTIRE ClientAssetPickerModal block (upload included), not just the existing-file selection", async () => {
  const source = await readSource("src/components/composition/ComponentFieldsForm.jsx");
  const gateStart = source.indexOf("{allowArtworkLinking && showArtworkPicker && (");
  assert.notEqual(gateStart, -1);
  const gateEnd = source.indexOf("\n      )}", gateStart);
  const gatedBlock = source.slice(gateStart, gateEnd);
  assert.ok(gatedBlock.includes("<ClientAssetPickerModal"), "the whole picker, upload control included, sits inside the allowArtworkLinking gate - a treatment-scoped instance (allowArtworkLinking=false) never mounts this component at all, so it can never gain the upload control either");
});

test("line thumbnail (ProductsEditor) explicitly supplies uploadCategory=\"Mockups\" - its own intended context, distinct from artwork's category", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  const start = source.indexOf("<ClientAssetPickerModal");
  const end = source.indexOf("/>", start);
  const body = source.slice(start, end);
  assert.ok(body.includes('uploadCategory="Mockups"'));
  assert.ok(!body.includes('defaultCategory'));
});

test("both real consumers pass a DIFFERENT explicit uploadCategory - proves the category is genuinely consumer-supplied, not a shared hardcoded default inside the picker itself", async () => {
  const artworkSource = await readSource("src/components/composition/ComponentFieldsForm.jsx");
  const thumbnailSource = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  assert.ok(artworkSource.includes('uploadCategory="Artwork"'));
  assert.ok(thumbnailSource.includes('uploadCategory="Mockups"'));
  const pickerSource = await readSource("src/components/files/ClientAssetPickerModal.jsx");
  assert.ok(!/uploadCategory = "Artwork"|uploadCategory = "Mockups"/.test(pickerSource), "the picker component itself must not hardcode either consumer's category as its own default");
});

test("the thumbnail write path (applyThumbnail) is unaffected by the upload addition - it still only ever needs asset.file_url, whether the asset was picked or freshly uploaded", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  const start = source.indexOf("const applyThumbnail = (pickedAssets) => {");
  assert.notEqual(start, -1);
  const end = source.indexOf("\n  };", start);
  const body = source.slice(start, end);
  assert.ok(body.includes("asset?.file_url"));
  assert.ok(body.includes("image_url: asset.file_url"));
});
