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
  const source = await readSource("src/components/orders/drawer/ProductsEditor.jsx");
  const start = source.indexOf("const addPrintOptionMutation = useMutation({");
  assert.notEqual(start, -1);
  const body = source.slice(start, start + 2000);
  assert.ok(body.includes("dataClient.entities.ClientProduct.create("), "must create a client_products row when clientProductByCatalogItemId has no match");
  assert.ok(body.includes("if (!clientProduct"), "creation must be conditional on none already existing, not unconditional");
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
  assert.ok(source.includes('import ComponentFieldsForm, { emptyComponentForm } from "@/components/composition/ComponentFieldsForm"'));
  assert.ok(source.includes("<ComponentFieldsForm"), "the shared form component must actually be rendered");
});
