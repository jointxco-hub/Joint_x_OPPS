import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { deriveSizesForProductColour } from "../src/lib/inventorySizeDerivation.js";
import { buildGarmentVariantPayload, buildTreatmentPayload, emptyTreatmentForm } from "../src/lib/garmentVariantTreatmentPayloads.js";
import { toStaffMessage } from "../src/lib/pgErrorMessages.js";
import { SIZE_PRESETS } from "../src/lib/sizePresets.js";

async function readSource(relativePath) {
  const raw = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  return raw.replace(/\r\n/g, "\n");
}

// ─────────────────────────────────────────────────────────────────────
// Phase 2B Step 3 - OPPS Staff UI for garment variants/treatments.
// Calls the live duplicate_garment_variant/duplicate_treatment RPCs only
// (never clones client-side); mapping toggles are upsert-by-existence,
// never a blind insert; component scope is one explicit { type, id? }
// concept, never two independently-optional IDs.
// ─────────────────────────────────────────────────────────────────────

test("deriveSizesForProductColour: active variants only, matching product+colour (whitespace/case-normalized), nonblank+deduped, standard sizes in SIZE_PRESETS order with unknown sizes retained after", () => {
  const variants = [
    { inventory_product_id: "p1", colour_name: " Black ", size_name: "L", is_active: true },
    { inventory_product_id: "p1", colour_name: "black", size_name: "S", is_active: true },
    { inventory_product_id: "p1", colour_name: "BLACK", size_name: "S", is_active: true }, // duplicate, deduped
    { inventory_product_id: "p1", colour_name: "Black", size_name: "OSFA", is_active: true }, // custom, kept, appended after standard
    { inventory_product_id: "p1", colour_name: "Black", size_name: "", is_active: true }, // blank, dropped
    { inventory_product_id: "p1", colour_name: "Black", size_name: "XL", is_active: false }, // inactive, dropped
    { inventory_product_id: "p1", colour_name: "White", size_name: "M", is_active: true }, // different colour, dropped
    { inventory_product_id: "p2", colour_name: "Black", size_name: "M", is_active: true }, // different product, dropped
  ];
  const result = deriveSizesForProductColour(variants, "p1", "Black");
  assert.deepEqual(result, ["S", "L", "OSFA"]);
});

test("deriveSizesForProductColour: returns empty array without a product or colour, never throws", () => {
  assert.deepEqual(deriveSizesForProductColour([{ inventory_product_id: "p1", colour_name: "Black", size_name: "M" }], null, "Black"), []);
  assert.deepEqual(deriveSizesForProductColour([{ inventory_product_id: "p1", colour_name: "Black", size_name: "M" }], "p1", ""), []);
  assert.deepEqual(deriveSizesForProductColour(undefined, "p1", "Black"), []);
});

test("SIZE_PRESETS has a single canonical source - Inventory.jsx imports it rather than defining its own copy", async () => {
  const source = await readSource("src/pages/Inventory.jsx");
  assert.ok(source.includes('import { SIZE_PRESETS } from "@/lib/sizePresets";'));
  assert.ok(!/const SIZE_PRESETS = \[/.test(source), "Inventory.jsx must not define a second, competing SIZE_PRESETS list");
});

test("buildGarmentVariantPayload: inventory-linked variants clear manual_available_sizes (inventory-derived is authoritative, never silently merged with stale manual data)", () => {
  const payload = buildGarmentVariantPayload({
    name: "220gsm / Black", inventory_product_id: "inv-1", colour_name: "Black",
    manual_available_sizes: "S, M, L", price_override: "", sort_order: 0, notes: "", is_active: true,
  }, { clientProductId: "cp-1" });
  assert.equal(payload.inventory_product_id, "inv-1");
  assert.equal(payload.manual_available_sizes, null, "manual sizes must be cleared once an inventory product is linked");
});

test("buildGarmentVariantPayload: no inventory product linked - manual_available_sizes is split/trimmed into an array and IS authoritative", () => {
  const payload = buildGarmentVariantPayload({
    name: "Custom variant", inventory_product_id: "", colour_name: "Black",
    manual_available_sizes: " S, M ,L", price_override: "299", sort_order: 1, notes: "", is_active: true,
  }, { clientProductId: "cp-1" });
  assert.equal(payload.inventory_product_id, null);
  assert.deepEqual(payload.manual_available_sizes, ["S", "M", "L"]);
  assert.equal(payload.price_override, 299);
});

test("buildGarmentVariantPayload: blank name is trimmed, price_override empty string becomes null (uses family price), not zero", () => {
  const payload = buildGarmentVariantPayload({
    name: "  Padded name  ", inventory_product_id: "", colour_name: "", manual_available_sizes: "",
    price_override: "", sort_order: 0, notes: "", is_active: true,
  }, { clientProductId: "cp-1" });
  assert.equal(payload.name, "Padded name");
  assert.equal(payload.price_override, null);
});

test("buildTreatmentPayload: surcharge defaults to 0 (not null) when left blank, since surcharge participates directly in the pricing preview addition", () => {
  const payload = buildTreatmentPayload({ ...emptyTreatmentForm(), name: "White SFR Print", surcharge: "" }, { clientProductId: "cp-1" });
  assert.equal(payload.surcharge, 0);
});

test("buildTreatmentPayload: primary_placement is passed through as a plain field, never validated/required - it is a display hint only", () => {
  const withPlacement = buildTreatmentPayload({ ...emptyTreatmentForm(), name: "A", primary_placement: "front" }, { clientProductId: "cp-1" });
  const withoutPlacement = buildTreatmentPayload({ ...emptyTreatmentForm(), name: "B", primary_placement: "" }, { clientProductId: "cp-1" });
  assert.equal(withPlacement.primary_placement, "front");
  assert.equal(withoutPlacement.primary_placement, null);
});

test("toStaffMessage: translates the active-name unique index violation into the exact staff-facing sentence", () => {
  assert.equal(
    toStaffMessage('duplicate key value violates unique constraint "client_product_garment_variants_active_name_uidx"'),
    "An active garment variant/treatment with this name already exists."
  );
});

test("toStaffMessage: translates the not-blank constraint and strips RPC error codes down to their human text", () => {
  assert.equal(toStaffMessage('new row violates check constraint "client_product_treatments_name_not_blank"'), "Name cannot be blank.");
  assert.equal(
    toStaffMessage("GARMENT_VARIANT_CLONE_IDEMPOTENCY_CONFLICT: idempotency key already used with a different request"),
    "idempotency key already used with a different request"
  );
});

test("toStaffMessage: an unrecognized message passes through unchanged rather than being hidden behind a generic string", () => {
  assert.equal(toStaffMessage("some genuinely new failure"), "some genuinely new failure");
});

// ─────────────────────────────────────────────────────────────────────
// Structural checks (matches this codebase's established convention for
// component-level behaviour - see tests/unified-add-product-flow.test.mjs)
// ─────────────────────────────────────────────────────────────────────

test("DuplicateGarmentVariantModal: idempotency key is generated via useState's lazy initializer (stable across rerenders/retries, fresh on next mount) and the RPC is called directly - never a client-side clone", async () => {
  const source = await readSource("src/components/composition/DuplicateGarmentVariantModal.jsx");
  assert.ok(source.includes('const [idempotencyKey] = useState(() =>'), "must use the lazy-initializer pattern, not a plain useState(value) or useEffect-driven regeneration");
  assert.ok(source.includes('supabase.rpc("duplicate_garment_variant"'), "must call the live RPC directly");
  assert.ok(source.includes("p_idempotency_key: idempotencyKey"));
  assert.ok(!/\.insert\(|\.create\(/.test(source), "must never write directly to client_product_garment_variants/product_components - only the RPC clones");
});

test("DuplicateTreatmentModal: identical idempotency-key lifecycle, calls duplicate_treatment directly, never clones client-side, and warns staff that artwork/mappings are not copied", async () => {
  const source = await readSource("src/components/composition/DuplicateTreatmentModal.jsx");
  assert.ok(source.includes('const [idempotencyKey] = useState(() =>'));
  assert.ok(source.includes('supabase.rpc("duplicate_treatment"'));
  assert.ok(source.includes("p_idempotency_key: idempotencyKey"));
  assert.ok(!/\.insert\(|\.create\(/.test(source));
  assert.ok(/not copied/i.test(source), "the not-copied warning must be present in the component");
});

test("VariantTreatmentMappingEditor: fetches mappings WITHOUT filtering to is_active (inactive historical mappings must be visible to look up), and toggling looks up an existing mapping (by variant+treatment existence) BEFORE deciding whether to update or create - never a blind insert", async () => {
  const source = await readSource("src/components/composition/VariantTreatmentMappingEditor.jsx");
  const queryCall = source.indexOf("VariantTreatmentMapping.filter({ garment_variant_id: variantId }");
  assert.notEqual(queryCall, -1);
  const queryLine = source.slice(queryCall, queryCall + 100);
  assert.ok(!/is_active/.test(queryLine), "the mappings query must not filter to active-only - inactive rows must be fetched too");

  const mutationStart = source.indexOf("const toggleMutation = useMutation({");
  assert.notEqual(mutationStart, -1);
  const mutationBody = source.slice(mutationStart, mutationStart + 700);
  assert.ok(mutationBody.includes("if (existingMapping)"), "must branch on whether a mapping row already exists");
  assert.ok(mutationBody.includes(".update(existingMapping.id"), "an existing row (active or inactive) must be updated, not duplicated");
  assert.ok(mutationBody.includes(".create({"), "only the no-existing-row branch may create a new row");

  const lookupStart = source.indexOf("const existingMapping = mappings.find(");
  assert.notEqual(lookupStart, -1, "the existing-mapping lookup must happen before the checkbox renders/toggles, keyed by treatment_id only (variant is already fixed by the query)");
});

test("GarmentVariantsSection / TreatmentsSection: disable is a plain is_active UPDATE (never a delete), requires confirmation only when disabling (not when re-enabling), and duplication opens the dedicated RPC-backed modal rather than any inline clone logic", async () => {
  for (const file of ["src/components/composition/GarmentVariantsSection.jsx", "src/components/composition/TreatmentsSection.jsx"]) {
    const source = await readSource(file);
    assert.ok(/\.update\(id, \{ is_active \}\)/.test(source), `${file}: disable/re-enable must be a plain is_active update`);
    assert.ok(!/\.delete\(/.test(source), `${file}: must never hard-delete a variant/treatment row`);
    assert.ok(source.includes("window.confirm("), `${file}: disabling must be confirmed`);
    assert.ok(source.includes("if (!reEnabling &&"), `${file}: confirmation must be skipped when re-enabling`);
  }
  const variantSource = await readSource("src/components/composition/GarmentVariantsSection.jsx");
  assert.ok(variantSource.includes("<DuplicateGarmentVariantModal"));
  const treatmentSource = await readSource("src/components/composition/TreatmentsSection.jsx");
  assert.ok(treatmentSource.includes("<DuplicateTreatmentModal"));
});

test("ScopedComponentsEditor: derives its list via filterComponentsByScope and passes the explicit scope through to every create/update call - never a raw client_product_id-only write that could silently default to family scope on edit", async () => {
  const source = await readSource("src/components/composition/ScopedComponentsEditor.jsx");
  assert.ok(source.includes("filterComponentsByScope(allComponents, scope)"));
  assert.ok(source.includes("buildComponentPayload(form, { clientProductId, sortOrder: activeComponents.length, scope })"));
  assert.ok(source.includes("buildComponentPayload(form, { clientProductId, sortOrder: undefined, scope })"), "the edit path must also pass scope explicitly, not just the add path");
});

test("TreatmentArtworkState: queries client_product_artwork scoped by treatment_id, never the family (treatment_id IS NULL) rows, never calls _compute_artwork_readiness, and deep-links to X LAB Admin's existing /admin/client-products/:id route rather than building a second upload flow", async () => {
  const source = await readSource("src/components/composition/TreatmentArtworkState.jsx");
  assert.ok(source.includes("ClientProductArtwork.filter({ client_product_id: clientProductId, treatment_id: treatmentId }"));
  assert.ok(!/_compute_artwork_readiness\(/.test(source), "no treatment readiness concept exists yet - this is state display only (mentioning the function BY NAME in an explanatory comment, as this file does, is fine - actually CALLING it is not)");
  assert.ok(source.includes("https://xlab.jointx.co.za/admin/client-products/${clientProductId}"));
  assert.ok(!/\.insert\(|UploadFile/.test(source), "must never implement a second upload flow");
});

test("GarmentVariantsSection: zero variants shows the simple-product fallback message and never forces a family into variant configuration", async () => {
  const source = await readSource("src/components/composition/GarmentVariantsSection.jsx");
  assert.ok(source.includes("No garment variants configured - this product uses the standard product setup above."));
});

test("dataClient: GarmentVariant, Treatment, and VariantTreatmentMapping are registered with the same table/tenantScoped/normalize/serialize shape as every other entity, and ProductComponent.serialize passes garment_variant_id/treatment_id through unconditionally", async () => {
  const source = await readSource("src/api/dataClient.js");
  assert.ok(source.includes("table: 'client_product_garment_variants'"));
  assert.ok(source.includes("table: 'client_product_treatments'"));
  assert.ok(source.includes("table: 'client_product_variant_treatments'"));
  const pcStart = source.indexOf("ProductComponent: {");
  const pcEnd = source.indexOf("GarmentVariant: {", pcStart);
  const pcBody = source.slice(pcStart, pcEnd);
  assert.ok(pcBody.includes("garment_variant_id: payload.garment_variant_id"));
  assert.ok(pcBody.includes("treatment_id: payload.treatment_id"));
});

test("no client-side cloning exists anywhere in the new components - every 'duplicate' action routes through supabase.rpc('duplicate_garment_variant', ...) or supabase.rpc('duplicate_treatment', ...), never a create() call built from a spread of the source row", async () => {
  for (const file of [
    "src/components/composition/DuplicateGarmentVariantModal.jsx",
    "src/components/composition/DuplicateTreatmentModal.jsx",
    "src/components/composition/GarmentVariantsSection.jsx",
    "src/components/composition/TreatmentsSection.jsx",
  ]) {
    const source = await readSource(file);
    assert.ok(!/GarmentVariant\.create\(\{[^}]*\.\.\.(duplicatingVariant|sourceVariant)/.test(source));
    assert.ok(!/Treatment\.create\(\{[^}]*\.\.\.(duplicatingTreatment|sourceTreatment)/.test(source));
  }
});

// ─────────────────────────────────────────────────────────────────────
// Post-review fixes: (1) family artwork context must never reach a
// variant- or treatment-scoped ScopedComponentsEditor instance, and (2)
// every write that changes displayed derived state must invalidate every
// query that state is read from.
// ─────────────────────────────────────────────────────────────────────

test("ScopedComponentsEditor: artworkAware is true ONLY for family scope (including the no-scope/undefined default) - variant and treatment scope both compute it false", async () => {
  const source = await readSource("src/components/composition/ScopedComponentsEditor.jsx");
  assert.ok(source.includes('const artworkAware = !scope || scope.type === "family";'));
});

test("ScopedComponentsEditor: scopedCurrentArtwork/scopedOnArtworkLinked collapse to undefined whenever artworkAware is false, and BOTH ComponentFieldsForm render sites (add and edit) use the scoped values plus allowArtworkLinking={artworkAware} - never the raw currentArtwork/onArtworkLinked props directly", async () => {
  const source = await readSource("src/components/composition/ScopedComponentsEditor.jsx");
  assert.ok(source.includes("const scopedCurrentArtwork = artworkAware ? currentArtwork : undefined;"));
  assert.ok(source.includes("const scopedOnArtworkLinked = artworkAware ? onArtworkLinked : undefined;"));
  // Neither raw prop may be forwarded directly to ComponentFieldsForm -
  // only the scoped (potentially-undefined) versions.
  assert.ok(!/currentArtwork={currentArtwork}/.test(source), "must never pass the raw prop straight through");
  assert.ok(!/onArtworkLinked={onArtworkLinked}/.test(source), "must never pass the raw prop straight through");
  const componentFieldsFormCount = (source.match(/<ComponentFieldsForm/g) || []).length;
  const scopedArtworkPropCount = (source.match(/currentArtwork={scopedCurrentArtwork}/g) || []).length;
  const scopedLinkedPropCount = (source.match(/onArtworkLinked={scopedOnArtworkLinked}/g) || []).length;
  const allowLinkingPropCount = (source.match(/allowArtworkLinking={artworkAware}/g) || []).length;
  assert.equal(componentFieldsFormCount, 2, "expected exactly the add and edit render sites");
  assert.equal(scopedArtworkPropCount, componentFieldsFormCount);
  assert.equal(scopedLinkedPropCount, componentFieldsFormCount);
  assert.equal(allowLinkingPropCount, componentFieldsFormCount, "every ComponentFieldsForm render must pass allowArtworkLinking={artworkAware}");
});

test("ScopedComponentsEditor: the 'no approved artwork' list-view badge is also gated by artworkAware - hasApprovedArtwork short-circuits to null (not false) whenever artworkAware is false, so a treatment/variant-scoped print_service component never shows a misleading family-artwork warning", async () => {
  const source = await readSource("src/components/composition/ScopedComponentsEditor.jsx");
  assert.ok(source.includes("const hasApprovedArtwork = (placement) => !artworkAware || !placement"));
});

test("ComponentFieldsForm: allowArtworkLinking (default true, so every pre-Step-3 caller is unaffected) gates BOTH the artwork-status block and the ClientAssetPickerModal - false means the artwork-linking control cannot render or be invoked at all, not just visually hidden", async () => {
  const source = await readSource("src/components/composition/ComponentFieldsForm.jsx");
  assert.ok(source.includes("allowArtworkLinking = true,"));
  assert.ok(source.includes('{allowArtworkLinking && form.component_type === "print_service" && effectivePlacement && ('));
  assert.ok(source.includes("{allowArtworkLinking && showArtworkPicker && ("));
});

test("GarmentVariantsSection: the variant-scoped ScopedComponentsEditor instance is never given currentArtwork/onArtworkLinked as actual JSX props - the component signature itself no longer accepts them (mentioning them BY NAME in an explanatory comment, as this file does, is fine - actually passing them as props is not)", async () => {
  const source = await readSource("src/components/composition/GarmentVariantsSection.jsx");
  assert.ok(!/currentArtwork={/.test(source), "GarmentVariantsSection must never pass currentArtwork as a prop - variant composition does not own artwork");
  assert.ok(!/onArtworkLinked={/.test(source));
});

test("TreatmentsSection: the treatment-scoped ScopedComponentsEditor instance is never given currentArtwork/onArtworkLinked as actual JSX props either - treatment artwork state is TreatmentArtworkState's own scoped query, not family data forwarded through ComponentFieldsForm", async () => {
  const source = await readSource("src/components/composition/TreatmentsSection.jsx");
  assert.ok(!/currentArtwork={/.test(source));
  assert.ok(!/onArtworkLinked={/.test(source));
  assert.ok(source.includes("<TreatmentArtworkState"), "the only treatment artwork surface must still be TreatmentArtworkState");
});

test("CatalogManagement no longer mounts the scoped-component / variant / treatment editors (XOS Phase C — canonical production only)", async () => {
  const source = await readSource("src/pages/CatalogManagement.jsx");
  assert.ok(!/ScopedComponentsEditor|GarmentVariantsSection|TreatmentsSection/.test(source));
  assert.ok(source.includes('import CanonicalProductionEditor from "@/components/clients/CanonicalProductionEditor";'));
});

test("VariantTreatmentMappingEditor: a mapping toggle invalidates BOTH the per-variant mapping query and the family-wide mapping-count query used by the visible variant/treatment lists - not just the former", async () => {
  const source = await readSource("src/components/composition/VariantTreatmentMappingEditor.jsx");
  const invalidateStart = source.indexOf("const invalidate = () => {");
  assert.notEqual(invalidateStart, -1);
  const invalidateBody = source.slice(invalidateStart, invalidateStart + 400);
  assert.ok(invalidateBody.includes('queryKey: ["variantTreatmentMappings", variantId]'));
  assert.ok(invalidateBody.includes('queryKey: ["variantTreatmentMappingsForFamily", clientProductId]'));
});

test("GarmentVariantsSection: duplicating a variant invalidates the variants list, the shared productComponents query, AND the family mapping-count query - not just the variants list", async () => {
  const source = await readSource("src/components/composition/GarmentVariantsSection.jsx");
  const start = source.indexOf("const invalidateAfterDuplicate = () => {");
  assert.notEqual(start, -1);
  const body = source.slice(start, start + 300);
  assert.ok(body.includes("invalidate();"));
  assert.ok(body.includes('queryKey: ["productComponents", clientProductId]'));
  assert.ok(body.includes("queryKey: mappingCountsQueryKey"));
  assert.ok(source.includes("onSuccess={() => { invalidateAfterDuplicate(); setDuplicatingVariant(null); }}"), "the duplicate modal's onSuccess must call the wider invalidation, not the plain one");
});

test("TreatmentsSection: duplicating a treatment invalidates the treatments list, the shared productComponents query, AND the family mapping-count query", async () => {
  const source = await readSource("src/components/composition/TreatmentsSection.jsx");
  const start = source.indexOf("const invalidateAfterDuplicate = () => {");
  assert.notEqual(start, -1);
  const body = source.slice(start, start + 300);
  assert.ok(body.includes("invalidate();"));
  assert.ok(body.includes('queryKey: ["productComponents", clientProductId]'));
  assert.ok(source.includes("onSuccess={() => { invalidateAfterDuplicate(); setDuplicatingTreatment(null); }}"));
});

test("the scoped-component / variant / treatment editors are still self-consistent in isolation (files kept, unmounted) — GarmentVariantsSection reads the shared productComponents key its duplication invalidates", async () => {
  const variantSectionSource = await readSource("src/components/composition/GarmentVariantsSection.jsx");
  assert.ok(variantSectionSource.includes('queryKey: ["productComponents", clientProductId]'));

  const editorSource = await readSource("src/components/composition/ScopedComponentsEditor.jsx");
  assert.ok(editorSource.includes("const scopedComponents = filterComponentsByScope(allComponents, scope);"));
});

test("no real SFR data is referenced anywhere in this phase's changed files - UI/data-layer only, no client_product id is hardcoded", async () => {
  for (const file of [
    "src/pages/CatalogManagement.jsx",
    "src/components/composition/GarmentVariantsSection.jsx",
    "src/components/composition/TreatmentsSection.jsx",
    "src/components/composition/ScopedComponentsEditor.jsx",
    "src/components/composition/DuplicateGarmentVariantModal.jsx",
    "src/components/composition/DuplicateTreatmentModal.jsx",
    "src/components/composition/VariantTreatmentMappingEditor.jsx",
    "src/components/composition/TreatmentArtworkState.jsx",
  ]) {
    const source = await readSource(file);
    assert.ok(!source.includes("4ae5878d-f3e2-41c7-9256-9165782a1781"), `${file}: SFR's real client_product id must not appear`);
  }
});
