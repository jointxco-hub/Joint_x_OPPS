import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(relativePath) {
  const raw = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  return raw.replace(/\r\n/g, "\n");
}

// The picker helper is a pure module, but it imports the shared
// classifiers from the Quotes mapping via the @/ alias, which
// node --test can't resolve. Mirror the repo convention
// (tests/quotes-product-picker.test.mjs): load the source, swap the
// aliased import for the real inline equivalents, and import the shim.
// A separate source-string test asserts the real import is present so
// this shim can't mask a divergence.
async function loadPicker() {
  const src = await readSource("src/features/orders/clientProductPicker.js");
  const shimmed = src.replace(
    /import \{\s*isClientProductApproved,\s*isClientProductArchived,?\s*\} from "@\/features\/quotes\/quoteProductMapping";/,
    [
      'const CLIENT_PRODUCT_APPROVED_STATUSES = ["client_approved", "ready_to_order", "active"];',
      "const isClientProductApproved = (cp = {}) => CLIENT_PRODUCT_APPROVED_STATUSES.includes(String(cp.status || \"\"));",
      "const isClientProductArchived = (cp = {}) => String(cp.status || \"\") === \"archived\";",
    ].join("\n"),
  );
  const mod = `data:text/javascript;base64,${Buffer.from(shimmed).toString("base64")}`;
  return import(mod);
}

const {
  selectableClientProductsForOrder,
  clientProductToPickerItem,
  applyClientProductPickToNewRow,
  clientProductStatusLabel,
  clientProductRevision,
  isClientProductApproved,
  isClientProductArchived,
} = await loadPicker();

const cp = (overrides = {}) => ({
  id: "cp-1",
  client_id: "client-1",
  client_facing_name: "Acme Staff Hoodie",
  internal_name: "acme-hoodie-2026",
  status: "active",
  revision: 3,
  client_price: 450,
  requires_quote: false,
  primary_mockup_url: "private-upload://mockups/acme-hoodie.png",
  opps_product_id: null,
  inventory_item_id: null,
  category: "",
  ...overrides,
});

// ─────────────────────────────────────────────────────────────────────
// selectableClientProductsForOrder - archived hidden, everything else
// selectable, junk rows dropped.
// ─────────────────────────────────────────────────────────────────────

test("selectableClientProductsForOrder hides archived and keeps every other status", () => {
  const rows = [
    cp({ id: "a", status: "active" }),
    cp({ id: "b", status: "draft" }),
    cp({ id: "c", status: "ready_for_client_review" }),
    cp({ id: "d", status: "client_changes_requested" }),
    cp({ id: "e", status: "archived" }),
  ];
  const out = selectableClientProductsForOrder(rows).map((r) => r.id);
  assert.deepEqual(out, ["a", "b", "c", "d"]);
});

test("selectableClientProductsForOrder drops rows with no id and non-arrays", () => {
  assert.deepEqual(selectableClientProductsForOrder([{ status: "active" }, null, cp({ id: "keep" })]).map((r) => r.id), ["keep"]);
  assert.deepEqual(selectableClientProductsForOrder(undefined), []);
  assert.deepEqual(selectableClientProductsForOrder("nope"), []);
});

// ─────────────────────────────────────────────────────────────────────
// status classification is the SHARED helper from the live Quotes picker
// ─────────────────────────────────────────────────────────────────────

test("approval/archived classification matches the shared Quotes rules", () => {
  assert.equal(isClientProductApproved({ status: "client_approved" }), true);
  assert.equal(isClientProductApproved({ status: "ready_to_order" }), true);
  assert.equal(isClientProductApproved({ status: "active" }), true);
  assert.equal(isClientProductApproved({ status: "draft" }), false);
  assert.equal(isClientProductApproved({ status: "ready_for_client_review" }), false);
  assert.equal(isClientProductArchived({ status: "archived" }), true);
  assert.equal(isClientProductArchived({ status: "active" }), false);
});

test("clientProductPicker re-exports the classifiers from the Quotes mapping module, not a private copy", async () => {
  const source = await readSource("src/features/orders/clientProductPicker.js");
  assert.ok(
    source.includes('from "@/features/quotes/quoteProductMapping"'),
    "must import the shared classification, not redefine CLIENT_PRODUCT_APPROVED_STATUSES",
  );
  assert.ok(!source.includes("CLIENT_PRODUCT_APPROVED_STATUSES ="), "must not declare its own approved-status list");
});

// ─────────────────────────────────────────────────────────────────────
// clientProductToPickerItem - commercial projection only, identity
// preserved, price never invented.
// ─────────────────────────────────────────────────────────────────────

test("clientProductToPickerItem projects name / image / category / status and the client_product identity", () => {
  const item = clientProductToPickerItem(cp());
  assert.equal(item.id, "cp-1");
  assert.equal(item.source, "client_product");
  assert.equal(item.client_product_id, "cp-1");
  assert.equal(item.name, "Acme Staff Hoodie");
  assert.equal(item.image_url, "private-upload://mockups/acme-hoodie.png");
  assert.equal(item.status, "active");
  assert.equal(item.approved, true);
  assert.equal(item.revision, 3);
});

test("clientProductToPickerItem does NOT synthesise a customer-approval flag - client_products has no such column and Phase 0 does not read client_approvals", () => {
  const item = clientProductToPickerItem(cp({ client_approved: true, client_approved_at: "2026-09-01" }));
  assert.equal("client_approved" in item, false, "no client_approved key - status is the only approval signal Phase 0 carries");
});

test("clientProductToPickerItem falls back to internal_name, then a generic label", () => {
  assert.equal(clientProductToPickerItem(cp({ client_facing_name: "" })).name, "acme-hoodie-2026");
  assert.equal(clientProductToPickerItem(cp({ client_facing_name: "", internal_name: "" })).name, "Client product");
});

test("clientProductToPickerItem uses the configured client_price when it is a positive number", () => {
  const item = clientProductToPickerItem(cp({ client_price: 450, requires_quote: false }));
  assert.equal(item.price, 450);
  assert.equal(item.needsPriceReview, false);
});

test("clientProductToPickerItem NEVER invents a price: missing / zero / negative -> blank + needsPriceReview", () => {
  for (const bad of [null, undefined, 0, -10, "", "abc"]) {
    const item = clientProductToPickerItem(cp({ client_price: bad, requires_quote: false }));
    assert.equal(item.price, "", `price must be blank for client_price=${JSON.stringify(bad)}`);
    assert.equal(item.needsPriceReview, true);
  }
});

test("clientProductToPickerItem treats requires_quote as needs-price-review even with a positive price", () => {
  const item = clientProductToPickerItem(cp({ client_price: 999, requires_quote: true }));
  assert.equal(item.price, "");
  assert.equal(item.needsPriceReview, true);
  assert.equal(item.requires_quote, true);
});

test("clientProductToPickerItem preserves a catalog parent (opps_product_id) and never also sets inventory", () => {
  const item = clientProductToPickerItem(cp({ opps_product_id: "cat-9", inventory_item_id: null }));
  assert.equal(item.catalog_item_id, "cat-9");
  assert.equal(item.inventory_item_id, "");
});

test("clientProductToPickerItem preserves a stock parent (inventory_item_id) and never also sets catalog", () => {
  const item = clientProductToPickerItem(cp({ opps_product_id: null, inventory_item_id: "inv-4" }));
  assert.equal(item.inventory_item_id, "inv-4");
  assert.equal(item.catalog_item_id, "");
});

test("clientProductToPickerItem leaves both parent ids blank for a standalone client product", () => {
  const item = clientProductToPickerItem(cp({ opps_product_id: null, inventory_item_id: null }));
  assert.equal(item.catalog_item_id, "");
  assert.equal(item.inventory_item_id, "");
});

test("clientProductToPickerItem carries NO fabricated variant options - sizes/colours/print/addons are empty", () => {
  const item = clientProductToPickerItem(cp());
  assert.deepEqual(item.sizes, []);
  assert.deepEqual(item.colors, []);
  assert.deepEqual(item.print_options, []);
  assert.deepEqual(item.addons, []);
});

test("clientProductRevision returns an integer or null, never NaN", () => {
  assert.equal(clientProductRevision({ revision: 5 }), 5);
  assert.equal(clientProductRevision({ revision: "7" }), 7); // numeric strings coerce - DB delivers an int anyway
  assert.equal(clientProductRevision({ revision: 1.5 }), null);
  assert.equal(clientProductRevision({ revision: "abc" }), null);
  assert.equal(clientProductRevision({}), null);
});

// ─────────────────────────────────────────────────────────────────────
// applyClientProductPickToNewRow - the order-line patch
// ─────────────────────────────────────────────────────────────────────

const newRow = (overrides = {}) => ({
  name: "",
  quantity: 1,
  price: "",
  size: "",
  color: "",
  notes: "",
  catalog_item_id: "",
  inventory_item_id: "",
  client_product_id: "",
  image_url: "",
  category: "",
  source: "",
  selected_print_options: [],
  selected_addons: [],
  ...overrides,
});

test("applyClientProductPickToNewRow sets client_product_id directly and marks the line source", () => {
  const item = clientProductToPickerItem(cp());
  const row = applyClientProductPickToNewRow(newRow(), item);
  assert.equal(row.client_product_id, "cp-1");
  assert.equal(row.source, "client_product");
  assert.equal(row.name, "Acme Staff Hoodie");
  assert.equal(row.image_url, "private-upload://mockups/acme-hoodie.png");
});

test("applyClientProductPickToNewRow preserves a catalog parent id on the line", () => {
  const item = clientProductToPickerItem(cp({ opps_product_id: "cat-9" }));
  const row = applyClientProductPickToNewRow(newRow(), item);
  assert.equal(row.catalog_item_id, "cat-9");
  assert.equal(row.inventory_item_id, "");
  assert.equal(row.client_product_id, "cp-1");
});

test("applyClientProductPickToNewRow preserves a stock parent id on the line", () => {
  const item = clientProductToPickerItem(cp({ opps_product_id: null, inventory_item_id: "inv-4" }));
  const row = applyClientProductPickToNewRow(newRow(), item);
  assert.equal(row.inventory_item_id, "inv-4");
  assert.equal(row.catalog_item_id, "");
});

test("applyClientProductPickToNewRow never writes a fabricated price - blank when the product has none", () => {
  const item = clientProductToPickerItem(cp({ client_price: null }));
  const row = applyClientProductPickToNewRow(newRow({ price: "123" }), item);
  assert.equal(row.price, "", "a previously typed price must not be kept as if it were the product's configured price");
});

test("applyClientProductPickToNewRow copies a real configured price as a string", () => {
  const item = clientProductToPickerItem(cp({ client_price: 450 }));
  const row = applyClientProductPickToNewRow(newRow(), item);
  assert.equal(row.price, "450");
});

test("applyClientProductPickToNewRow clears size / colour / options carried from a previous pick", () => {
  const item = clientProductToPickerItem(cp());
  const row = applyClientProductPickToNewRow(
    newRow({ size: "L", color: "Black", selected_print_options: [{ name: "front" }], selected_addons: [{ name: "bag" }] }),
    item,
  );
  assert.equal(row.size, "");
  assert.equal(row.color, "");
  assert.deepEqual(row.selected_print_options, []);
  assert.deepEqual(row.selected_addons, []);
});

test("applyClientProductPickToNewRow keeps unrelated line fields (quantity, notes) untouched", () => {
  const item = clientProductToPickerItem(cp());
  const row = applyClientProductPickToNewRow(newRow({ quantity: 25, notes: "rush" }), item);
  assert.equal(row.quantity, 25);
  assert.equal(row.notes, "rush");
});

test("clientProductStatusLabel: approved -> 'Client-approved', otherwise the humanised status", () => {
  assert.equal(clientProductStatusLabel({ approved: true, status: "active" }), "Client-approved");
  assert.equal(clientProductStatusLabel({ approved: false, status: "client_changes_requested" }), "client changes requested");
  assert.equal(clientProductStatusLabel({ approved: false, status: "" }), "unconfigured");
});

// ─────────────────────────────────────────────────────────────────────
// ProductsEditor.jsx wiring - Phase 0 connects selection to the EXISTING
// production/attach path and does NOT touch the frozen-snapshot / save
// path or create a client_products row.
// ─────────────────────────────────────────────────────────────────────

test("ProductsEditor imports and uses the client-product picker helpers", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  assert.ok(source.includes('from "@/features/orders/clientProductPicker"'), "helper module must be imported");
  assert.ok(source.includes("selectableClientProductsForOrder(clientProductsForOrder)"), "must reuse the existing client_id-scoped query, not a new fetch");
  assert.ok(source.includes("applyClientProductPickToNewRow(r, item)"), "selecting a client product must apply the shared patch");
});

test("the client-product picker source reuses the SAME client_id-scoped query the production maps use", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  // exactly one ClientProduct.filter call, still client_id-scoped, still
  // gated on order.client_id - no widening of tenant/client scope.
  const matches = source.match(/dataClient\.entities\.ClientProduct\.filter\(/g) || [];
  assert.equal(matches.length, 1, "Phase 0 must not add a second ClientProduct query");
  assert.ok(source.includes('filter({ client_id: order.client_id }, "client_facing_name", 200)'), "the one query stays client_id-scoped");
  assert.ok(source.includes("enabled: Boolean(order.client_id)"), "still gated on the order having a client");
  assert.ok(source.includes("order.client_id\n    ? selectableClientProductsForOrder"), "picker items are only built when the order has a client");
});

test("selecting a client product sets client_product_id so the EXISTING production gates open", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  // isProductionCapableLine + clientProductForLine are unchanged and are
  // what make "Attach composition" appear - assert they still gate the panel.
  assert.ok(source.includes("isProductionCapableLine(p) && ("), "production panel still gated by the existing helper");
  assert.ok(source.includes("onBeginAttach={() => beginAttach(p.line_id, clientProductForLine(p)?.id, p)}"), "Attach composition still routes through the existing beginAttach");
  const helper = await readSource("src/features/orders/clientProductPicker.js");
  assert.ok(helper.includes('client_product_id: item.client_product_id || item.id || ""'), "the pick patch sets client_product_id on the line");
});

test("Phase 0 does NOT add a client-product branch to the frozen-snapshot attach or the order save path", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  // confirmAttach / beginAttach bodies must be untouched by this slice -
  // no new RPC, no new snapshot-writing branch keyed on the picker.
  const confirmStart = source.indexOf("const confirmAttach = useMutation({");
  const confirmBody = source.slice(confirmStart, confirmStart + 2600);
  assert.ok(!confirmBody.includes("clientProductPicker"), "confirmAttach must not reference the Phase 0 picker helper");
  assert.ok(!source.includes("xos_add_client_product_to_order"), "the new atomic reuse RPC is explicitly out of Phase 0 scope");
  assert.ok(source.includes('supabase.rpc("duplicate_order_line_with_snapshots"'), "the existing duplication RPC call is left in place, unchanged");
});

test("selecting a client product never creates a client_products row", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  // The only ClientProduct.create calls are the pre-existing ones
  // (resolveOrCreateClientProductForLine / createClientProductMutation) -
  // the picker pick path must not add another.
  const pickPatchStart = source.indexOf("item.source === \"client_product\"\n                          ? applyClientProductPickToNewRow(r, item)");
  assert.notEqual(pickPatchStart, -1, "the client-product pick branch must exist");
  const pickPatchArea = source.slice(pickPatchStart, pickPatchStart + 900);
  assert.ok(!pickPatchArea.includes("ClientProduct.create"), "picking a configured product must not create a duplicate");
});

test("editing a line's commercial fields preserves its client_product_id (saveRow spreads ...p before ...editRow)", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  // editRow is populated without client_product_id and there is no UI to
  // change identity in the edit form, so the ...p spread must come first
  // for the link to survive an edit.
  assert.ok(
    source.includes("i === editingIdx ? { ...p, ...editRow, quantity: Number(editRow.quantity) || 1 } : p"),
    "saveRow must merge editRow onto the existing line, keeping fields (like client_product_id) the edit form does not carry",
  );
});

test("Configure Product pickers stay catalog+stock only - client products are not offered there", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  assert.ok(source.includes("const catalogAndStockPickerItems = allPickerItems.filter((item) => item.source !== \"client_product\")"), "a catalog+stock-only list must be derived");
  assert.ok(source.includes("<CatalogPicker items={catalogAndStockPickerItems} onPick={setConfigurePickedItem} />"), "Match existing product picker uses the filtered list");
  assert.ok(source.includes('<CatalogPicker items={catalogAndStockPickerItems} onPick={setConfigureCreatePickedItem}'), "Create client product link picker uses the filtered list");
});

test("emptyRow carries client_product_id so switching back to Custom / a catalog item clears the link", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  assert.ok(source.includes('inventory_item_id: "", client_product_id: "", image_url: ""'), "emptyRow includes client_product_id");
  // every identity-reset site clears all three ids together
  assert.ok(source.includes('catalog_item_id: "", inventory_item_id: "", client_product_id: "", image_url: "", category: "", source: "custom"'), "the Custom reset clears client_product_id too");
  assert.ok(source.includes('catalog_item_id: "", inventory_item_id: "", client_product_id: "", image_url: "", category: "" })); setPickerSearch(e.target.value)'), "typing a fresh name clears client_product_id too");
});

test("the catalog/stock pick branch explicitly clears client_product_id (mutually exclusive identity)", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  const branchStart = source.indexOf("inventory_item_id: item.source === \"stock\" ? item.id : \"\",");
  const branchArea = source.slice(branchStart, branchStart + 200);
  assert.ok(branchArea.includes('client_product_id: "",'), "picking a catalog/stock item clears any prior client_product_id");
});

test("readiness / approval state is surfaced at selection time from the already-fetched row", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  assert.ok(source.includes("clientProductStatusLabel(cpItem)"), "status label shown for the selected client product");
  assert.ok(source.includes('selectedPickerItem?.source === "client_product" && (() => {'), "the readiness panel is gated on a selected client-product picker item");
  assert.ok(source.includes("Not client-approved yet"), "a non-approved product is clearly flagged, not blocked");
  assert.ok(source.includes("not customer-approved or production-ready"), "selection must not imply production readiness");
  assert.ok(source.includes("existing readiness and approval checks still apply"), "the panel points back to the existing gates");
});
