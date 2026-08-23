import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(relativePath) {
  const raw = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  return raw.replace(/\r\n/g, "\n");
}

// ─────────────────────────────────────────────────────────────────────
// QuickImagePreview (Phase 5-12): a deliberately minimal, view-only
// image preview for the "team member opens an order, clicks a product
// thumbnail, inspects artwork/mockup, closes, keeps working" flow.
// Distinct from FileLightbox (the existing full-featured file viewer,
// which has comments/tagging/its own custom z-[1000] portal) - these
// tests guard that this component stays minimal and structurally
// mutation-free, not that it reimplements FileLightbox.
// ─────────────────────────────────────────────────────────────────────

test("QuickImagePreview uses the shared Dialog/DialogContent primitive, not a custom portal or z-index", async () => {
  const source = await readSource("src/components/common/QuickImagePreview.jsx");
  assert.ok(source.includes('import { Dialog, DialogContent } from "@/components/ui/dialog";'), "must reuse the shared Dialog primitive (already fixed to z-[90] above the Order Drawer)");
  // Strip comments before checking - the file's own explanatory comments
  // legitimately mention createPortal/z-[...] as *contrast* against
  // FileLightbox's approach, not as something this file itself does.
  const codeOnly = source.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
  assert.ok(!/createPortal|z-\[\d+\]/.test(codeOnly), "must not introduce a second, competing portal/z-index convention in actual code");
});

test("QuickImagePreview resolves via the existing useSignedFileUrl resolver, not a new one", async () => {
  const source = await readSource("src/components/common/QuickImagePreview.jsx");
  assert.ok(source.includes('import { useSignedFileUrl } from "@/lib/privateFiles";'), "must reuse the existing private-file resolver");
});

test("QuickImagePreview is structurally read-only: no entity writes, no order/asset mutation imports at all", async () => {
  const source = await readSource("src/components/common/QuickImagePreview.jsx");
  assert.ok(!/dataClient\.entities|useMutation|supabase\.from\(|applyToLine|onUpdate/.test(source), "opening/closing the preview must never be able to write anything - no mutation machinery imported at all");
});

test("QuickImagePreview only resolves a signed URL while actually open - never signs an off-screen/closed preview", async () => {
  const source = await readSource("src/components/common/QuickImagePreview.jsx");
  assert.ok(source.includes("useSignedFileUrl(open ? value : \"\")"), "must gate resolution on `open`, not resolve unconditionally");
});

test("QuickImagePreview never persists a signed URL - only ever local hook state, and 'Open full size' links the resolved url directly (view-only, no download machinery)", async () => {
  const source = await readSource("src/components/common/QuickImagePreview.jsx");
  assert.ok(!/localStorage|orders\.products|image_url\s*[:=]/.test(source), "must never write the resolved url back into any persisted field");
  assert.ok(source.includes('target="_blank"') && source.includes('rel="noopener noreferrer"'), "the full-size link must be a plain safe external link, not a download/public-URL mechanism");
});

// ─────────────────────────────────────────────────────────────────────
// ProductsEditor.jsx wiring
// ─────────────────────────────────────────────────────────────────────

test("the order-line thumbnail is only clickable (opens the preview) when a real, resolvable image reference exists", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  assert.ok(source.includes("const isRealImage = Boolean(resolvedThumb) && isImageReference(resolvedThumb);"), "clickability must be gated on an actual image reference, not just any truthy value");
  const gateIndex = source.indexOf("const isRealImage = Boolean(resolvedThumb)");
  const block = source.slice(gateIndex, gateIndex + 1400);
  assert.ok(block.includes("isRealImage ? ("), "the clickable <button> wrapper must be conditional on isRealImage");
  assert.ok(block.includes("<Package className=\"m-3 h-6 w-6 text-muted-foreground/50\" />"), "a line with no real image must still show the plain, non-interactive placeholder icon");
});

test("clicking the order-line thumbnail opens QuickImagePreview via local state, not a new mutation or a reused unrelated dialog", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  assert.ok(source.includes('import QuickImagePreview from "@/components/common/QuickImagePreview";'));
  assert.ok(source.includes("const [quickPreview, setQuickPreview] = useState(null);"));
  assert.ok(source.includes("setQuickPreview({ value: resolvedThumb, title: p.name, subtitle: \"Product image\" })"));
  assert.ok(source.includes("<QuickImagePreview"), "the preview must actually be rendered somewhere in the tree");
});

test("Set/Change thumbnail remains a fully separate action from the quick preview - different state, different trigger, different component", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  assert.ok(source.includes("const [thumbnailPickerLineId, setThumbnailPickerLineId] = useState"), "the existing Set/Change thumbnail state must be untouched");
  assert.ok(source.includes("const applyThumbnail = (pickedAssets) => {"), "the existing explicit-overwrite mutation path must be untouched");
  assert.notEqual(source.indexOf("setThumbnailPickerLineId"), source.indexOf("setQuickPreview"), "these must be two distinct state setters, never conflated");
});

test("the quick preview is available even when the order is locked - viewing is never a mutation and must not be gated by the product-edit lock", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  const previewRenderIndex = source.indexOf("<QuickImagePreview");
  const before = source.slice(Math.max(0, previewRenderIndex - 200), previewRenderIndex);
  assert.ok(!/\{!locked\s*&&\s*$/.test(before.trim()), "QuickImagePreview's render must not be gated behind !locked the way mutating controls are");
});
