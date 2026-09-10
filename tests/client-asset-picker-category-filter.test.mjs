import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  normalizeCategoryFilter,
  categoryOfAsset,
  filterClientAssetsByCategoryAndSearch,
} from "../src/lib/clientAssetPickerFilter.js";

async function readSource(relativePath) {
  const raw = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  return raw.replace(/\r\n/g, "\n");
}

// ─────────────────────────────────────────────────────────────────────
// ASSET PICKER — "All categories" literally means no category filter.
//
// Regression for the live Phase D finding: a picker opened with a
// preselected category the client had no files in filtered the list to
// zero AND left the native <select> displaying "All categories" (its
// first <option>, because no matching <option> was rendered) — so staff
// saw an empty list under a control reading "All categories" and
// concluded the client had no artwork/files. Toggling the category made
// the files appear.
// ─────────────────────────────────────────────────────────────────────

const categoryByFolderId = {
  fGeneral: "General",
  fArtwork: "Artwork",
  fMockup: "Mockups",
  fBrand: "Brand Assets",
};

// 4 accessible client assets, one per category (the spec fixture).
const assets = [
  { id: "a-general", title: "Brand logo",  folder_id: "fGeneral" },
  { id: "a-artwork", title: "Chest print", folder_id: "fArtwork" },
  { id: "a-mockup",  title: "Tee mockup",  folder_id: "fMockup" },
  { id: "a-other",   title: "Style sheet", folder_id: "fBrand" },
];

const ids = (list) => list.map((a) => a.id).sort();

test("normalizeCategoryFilter: every 'no restriction' spelling collapses to null", () => {
  for (const v of ["", "all", "All", "ALL", "All categories", "all categories", "all_categories", "all-categories", null, undefined, "   "]) {
    assert.equal(normalizeCategoryFilter(v), null, `expected null for ${JSON.stringify(v)}`);
  }
});

test("normalizeCategoryFilter: a real category is preserved (trimmed), 'General' included", () => {
  assert.equal(normalizeCategoryFilter("General"), "General");
  assert.equal(normalizeCategoryFilter("Artwork"), "Artwork");
  assert.equal(normalizeCategoryFilter("  Mockups  "), "Mockups");
});

test("categoryOfAsset: no / unknown folder falls back to 'General'", () => {
  assert.equal(categoryOfAsset({ folder_id: null }, categoryByFolderId), "General");
  assert.equal(categoryOfAsset({ folder_id: "nope" }, categoryByFolderId), "General");
  assert.equal(categoryOfAsset({ folder_id: "fArtwork" }, categoryByFolderId), "Artwork");
});

test("initial open (categoryFilter = null) shows every accessible asset — no toggle required", () => {
  const out = filterClientAssetsByCategoryAndSearch({ assets, categoryByFolderId, categoryFilter: null, search: "" });
  assert.deepEqual(ids(out), ids(assets));
  assert.equal(out.length, 4);
});

test("a stray 'all' / '' filter value behaves exactly like null (not a category named 'all')", () => {
  for (const v of ["", "all", "All categories"]) {
    const out = filterClientAssetsByCategoryAndSearch({ assets, categoryByFolderId, categoryFilter: v, search: "" });
    assert.equal(out.length, 4, `filter ${JSON.stringify(v)} must not restrict`);
  }
});

test("selecting 'General' shows only General files (General is a real category, not a catch-all)", () => {
  const out = filterClientAssetsByCategoryAndSearch({ assets, categoryByFolderId, categoryFilter: "General", search: "" });
  assert.deepEqual(ids(out), ["a-general"]);
});

test("selecting a specific category then returning to All restores the full list", () => {
  const narrowed = filterClientAssetsByCategoryAndSearch({ assets, categoryByFolderId, categoryFilter: "Artwork", search: "" });
  assert.deepEqual(ids(narrowed), ["a-artwork"]);
  const restored = filterClientAssetsByCategoryAndSearch({ assets, categoryByFolderId, categoryFilter: null, search: "" });
  assert.deepEqual(ids(restored), ids(assets));
});

test("search while All composes across every category", () => {
  const out = filterClientAssetsByCategoryAndSearch({ assets, categoryByFolderId, categoryFilter: null, search: "t" });
  // "Chest print", "Tee mockup", "Style sheet" contain "t"; "Brand logo" does not
  assert.deepEqual(ids(out), ["a-artwork", "a-mockup", "a-other"]);
});

test("search while a specific category is selected stays scoped to that category", () => {
  const hit = filterClientAssetsByCategoryAndSearch({ assets, categoryByFolderId, categoryFilter: "Mockups", search: "mockup" });
  assert.deepEqual(ids(hit), ["a-mockup"]);
  const miss = filterClientAssetsByCategoryAndSearch({ assets, categoryByFolderId, categoryFilter: "Mockups", search: "print" });
  assert.deepEqual(miss, []);
});

test("a genuinely zero-result search returns [] (caller then renders 'No files match your search')", () => {
  const out = filterClientAssetsByCategoryAndSearch({ assets, categoryByFolderId, categoryFilter: null, search: "zzzznope" });
  assert.deepEqual(out, []);
});

test("an asset with no folder is visible under All and under 'General', hidden under other categories", () => {
  const orphan = { id: "a-orphan", title: "loose file", folder_id: null };
  const withOrphan = [...assets, orphan];
  assert.ok(filterClientAssetsByCategoryAndSearch({ assets: withOrphan, categoryByFolderId, categoryFilter: null, search: "" }).some((a) => a.id === "a-orphan"));
  assert.ok(filterClientAssetsByCategoryAndSearch({ assets: withOrphan, categoryByFolderId, categoryFilter: "General", search: "" }).some((a) => a.id === "a-orphan"));
  assert.ok(!filterClientAssetsByCategoryAndSearch({ assets: withOrphan, categoryByFolderId, categoryFilter: "Artwork", search: "" }).some((a) => a.id === "a-orphan"));
});

test("empty / null asset list never throws", () => {
  assert.deepEqual(filterClientAssetsByCategoryAndSearch({ assets: null, categoryByFolderId, categoryFilter: null, search: "" }), []);
  assert.deepEqual(filterClientAssetsByCategoryAndSearch({ assets: [], categoryByFolderId, categoryFilter: "Artwork", search: "x" }), []);
});

// ── Component wiring: the shared modal must actually use the contract ──

test("ClientAssetPickerModal opens unrestricted, uses the shared helper, and keeps the <select> value coherent", async () => {
  const source = await readSource("src/components/files/ClientAssetPickerModal.jsx");
  assert.ok(source.includes('from "@/lib/clientAssetPickerFilter"'), "must consume the shared filter contract");
  assert.ok(source.includes("useState(null)"), "categoryFilter must initialise to null (All), not a preselected category");
  assert.ok(!source.includes("defaultCategory"), "the defaultCategory prop that caused the bug must be gone entirely");
  assert.ok(source.includes("filterClientAssetsByCategoryAndSearch({"), "filtering must go through the shared helper, not a re-implemented inline filter");
  assert.ok(source.includes("value={normalizeCategoryFilter(categoryFilter) ?? \"\"}"), "the <select> value must be normalised so it can never point at an unrendered option");
  assert.ok(source.includes("!availableCategories.includes(active)) setCategoryFilter(null)"), "a category that stops existing among loaded assets must reset to All");
  // loading is still a distinct branch that precedes the empty-state text
  const loadingIdx = source.indexOf("Loading client library...");
  const emptyIdx = source.indexOf("No files match your search.");
  assert.ok(loadingIdx !== -1 && emptyIdx !== -1 && loadingIdx < emptyIdx, "the loading branch must render before (and instead of) the empty-state text");
});

test("order file + order-line artwork pickers reuse the shared modal — no separate category-filter implementation to regress", async () => {
  const orderFiles = await readSource("src/components/orders/drawer/OrderFilesTab.jsx");
  const productsEditor = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  assert.ok(orderFiles.includes("<ClientAssetPickerModal"), "OrderFilesTab must use the shared ClientAssetPickerModal");
  assert.ok(productsEditor.includes("<ClientAssetPickerModal"), "ProductsEditor must use the shared ClientAssetPickerModal");
  // neither may carry its own client-asset category <select> defaulting to a
  // real category (the ProductsEditor "all"-sentinel selects at lines ~1448 /
  // ~1867 filter CATALOG/STOCK items, a different domain, and already default
  // to "all").
  for (const [name, src] of [["OrderFilesTab", orderFiles], ["ProductsEditor", productsEditor]]) {
    assert.ok(!/useState\("(Artwork|Mockups|General|Brand Assets)"\)/.test(src), `${name} must not seed a category filter with a real category name`);
  }
});
