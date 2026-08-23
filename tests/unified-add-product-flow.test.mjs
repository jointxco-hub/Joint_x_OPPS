import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(relativePath) {
  const raw = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  return raw.replace(/\r\n/g, "\n");
}

// ─────────────────────────────────────────────────────────────────────
// "+ Add print option" replaces the pill-only path for NEW work without
// removing the legacy pill path for existing/historical lines.
// ─────────────────────────────────────────────────────────────────────

test("legacy print_options pill rendering is preserved, unremoved", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  assert.ok(source.includes("selected_print_options"), "the legacy pill selection field must still be readable");
  assert.ok(source.includes("optionListFrom"), "the legacy print_options->pill mapping must still exist");
});

test("the new + Add print option action exists as a distinct entry point", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  assert.ok(source.includes("Add print option"), "the new action's label must exist");
  assert.ok(source.includes("addPrintOptionMutation"), "it must be backed by its own mutation, not reuse the pill state");
});

test("a client_products row is created on demand when none exists yet, without requiring a Catalog Management visit first", async () => {
  // Extracted into resolveOrCreateClientProductForLine (shared with
  // Review for My Products) - addPrintOptionMutation now calls it
  // rather than inlining the create-or-reuse logic itself.
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  const helperStart = source.indexOf("const resolveOrCreateClientProductForLine = async (orderLine) => {");
  assert.notEqual(helperStart, -1, "the shared resolve-or-create helper must exist");
  const helperBody = source.slice(helperStart, helperStart + 1200);
  assert.ok(helperBody.includes("dataClient.entities.ClientProduct.create("), "must create a client_products row when none already exists");
  assert.ok(helperBody.includes("if (!clientProduct"), "creation must be conditional on none already existing, not unconditional");

  const mutationStart = source.indexOf("const addPrintOptionMutation = useMutation({");
  assert.notEqual(mutationStart, -1);
  const mutationBody = source.slice(mutationStart, mutationStart + 500);
  assert.ok(mutationBody.includes("resolveOrCreateClientProductForLine(orderLine)"), "addPrintOptionMutation must reuse the shared helper, not a second copy");
});

test("adding a print option creates both a reusable product_components row and an immutable order snapshot", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  const start = source.indexOf("const addPrintOptionMutation = useMutation({");
  assert.notEqual(start, -1);
  const body = source.slice(start, start + 6000);
  assert.ok(body.includes("dataClient.entities.ProductComponent.create("), "the reusable master component must be created");
  assert.ok(body.includes("dataClient.entities.OrderLineComponentSnapshot.create("), "an immutable order snapshot must be created for it");
});

test("the order price override is applied only to the snapshot, never written back onto the reusable component", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  const start = source.indexOf("const addPrintOptionMutation = useMutation({");
  const body = source.slice(start, start + 6000);
  assert.ok(body.includes("resolveOrderPrice(form.orderPrice, component.default_sell_price)"), "the snapshot's sell_price must resolve through the order-override helper");
  assert.ok(!body.includes("default_sell_price: form.orderPrice"), "the order price must never be written into a component payload's default_sell_price");
});

test("a setup-fee companion, when requested, is always once_per_order and gets its own snapshot", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  const start = source.indexOf("const addPrintOptionMutation = useMutation({");
  const body = source.slice(start, start + 6000);
  assert.ok(body.includes("form.setupRequired"), "setup-fee creation must be gated on the explicit staff toggle, not implicit");
  assert.ok(body.includes("buildSetupFeeCompanionPayload"), "must reuse the shared once_per_order-enforcing builder, not a bespoke payload");
  assert.ok(body.includes("if (setupComponent)"), "the setup component, if created, must get its own snapshot in the same attach");
});

test("ComponentFieldsForm is reused rather than a second/duplicate form implementation", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  assert.ok(source.includes('import ComponentFieldsForm, { emptyPrintOptionForm } from "@/components/composition/ComponentFieldsForm"'));
  assert.ok(source.includes("<ComponentFieldsForm"), "the shared form component must actually be rendered");
});

// ─────────────────────────────────────────────────────────────────────
// Manual testing found the real defect this covers: "+ Add print
// option" opened with component_type defaulted to blank_garment (the
// shared form's general-purpose default), which silently made the
// resulting component inventory-bearing - it required an internal
// product pick and later variant resolution that a print service was
// never meant to need, and hid the method/placement/setup-fee/artwork
// controls entirely (all gated on component_type === "print_service").
// ─────────────────────────────────────────────────────────────────────

test("+ Add print option defaults to print_service, never blank_garment", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  assert.ok(source.includes("emptyPrintOptionForm()"), "the print-option form must initialize via the print_service-defaulting factory");
  assert.ok(!source.includes("setPrintOptionForm(emptyComponentForm())"), "must never reset back to the general-purpose (blank_garment-defaulting) factory");
});

test("emptyPrintOptionForm defaults component_type to print_service and leaves production_method unselected", async () => {
  const source = await readSource("src/components/composition/ComponentFieldsForm.jsx");
  const start = source.indexOf("export function emptyPrintOptionForm()");
  assert.notEqual(start, -1);
  const body = source.slice(start, start + 200);
  assert.ok(body.includes('component_type: "print_service"'));
  // production_method is never re-set here - it must still come from
  // emptyComponentForm()'s own "" default, i.e. no silent method default
  // (e.g. DTF) is layered on top for the print-option entry point.
  assert.ok(!body.includes("production_method:"), "must not override production_method with any specific default");
});

test("blank_garment is excluded from the + Add print option component-type choices", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  assert.ok(source.includes('excludeComponentTypes={["blank_garment"]}'), "staff must not be able to pick blank_garment from this entry point at all");
});

test("Catalog Management's general Add component flow is unaffected - blank_garment stays available there", async () => {
  const source = await readSource("src/pages/CatalogManagement.jsx");
  assert.ok(source.includes("emptyComponentForm()"), "Catalog Management still uses the general-purpose (blank_garment-defaulting) factory");
  assert.ok(!source.includes("excludeComponentTypes"), "Catalog Management must not restrict component types - it is the general composition editor");
});

test("a print_service component created via + Add print option never carries an inventory identity", async () => {
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  const start = source.indexOf("const addPrintOptionMutation = useMutation({");
  const body = source.slice(start, start + 6000);
  // buildComponentPayload (shared, tested separately in
  // product-composition-form.test.mjs) already nulls inventory_product_id
  // for every component_type except blank_garment - this just confirms
  // the mutation still routes through that shared builder rather than
  // constructing its own payload that could reintroduce the bug.
  assert.ok(body.includes("buildComponentPayload(form, { clientProductId: clientProduct.id, sortOrder: existingCount })"));
});

test("a genuine blank_garment component (added via Catalog Management) still requires an internal inventory identity, unchanged", async () => {
  const source = await readSource("src/pages/CatalogManagement.jsx");
  assert.ok(
    source.includes('createComponentMutation.isPending || (newComponent.component_type === "blank_garment" && !newComponent.inventory_product_id)'),
    "the add-component submit button must still be disabled for an unresolved blank_garment"
  );
  assert.ok(
    source.includes('updateComponentMutation.isPending || (editComponentForm.component_type === "blank_garment" && !editComponentForm.inventory_product_id)'),
    "the edit-component submit button must still enforce the same rule"
  );
});
