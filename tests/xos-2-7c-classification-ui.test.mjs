import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// ─────────────────────────────────────────────────────────────────────
// XOS 2.7C Phases C2/C3/C6 — classification display wiring and the
// staff-only control surface.
// ─────────────────────────────────────────────────────────────────────

async function readSource(relativePath) {
  const raw = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  return raw.replace(/\r\n/g, "\n");
}

// ── C2: display, at minimum in list/table, mobile card, OrderDrawer ──

test("Orders.jsx renders OrderClassificationBadge in the mobile card, the desktop table row, and the kanban card", async () => {
  const source = await readSource("src/pages/Orders.jsx");
  assert.ok(source.includes('import OrderClassificationBadge from "@/components/orders/OrderClassificationBadge";'));
  const occurrences = (source.match(/<OrderClassificationBadge order=\{order\} \/>/g) || []).length;
  assert.equal(occurrences, 3, "mobile card + desktop row + kanban card");
});

test("OrderDrawer.jsx renders OrderClassificationBadge in its header, fed from the local optimistic classification state (not stale props)", async () => {
  const source = await readSource("src/components/orders/OrderDrawer.jsx");
  assert.ok(source.includes('import OrderClassificationBadge from "@/components/orders/OrderClassificationBadge";'));
  assert.ok(source.includes("<OrderClassificationBadge order={effectiveOrderForClassification} />"));
});

// ── C6: Archive gets a minimal indicator, no filtering, no redesign ──

test("Archive.jsx shows OrderClassificationBadge for archived orders but does not filter/hide test or excluded rows", async () => {
  const source = await readSource("src/pages/Archive.jsx");
  assert.ok(source.includes('import OrderClassificationBadge from "@/components/orders/OrderClassificationBadge";'));
  assert.ok(source.includes('activeTab === "orders" && <OrderClassificationBadge order={item} />'));
  // No .filter(...) call anywhere in the page keys off is_test/excluded_from_reports -
  // Archive stays the unfiltered historical record; the badge is display-only.
  assert.ok(!/\.filter\([^)]*(?:is_test|excluded_from_reports)/s.test(source));
});

// ── C3: staff-only control, independent toggles, dedicated RPC ──────

test("OrderDrawer.jsx classification control calls the dedicated staff RPC, never the generic order-update mutation", async () => {
  const source = await readSource("src/components/orders/OrderDrawer.jsx");
  const mutationStart = source.indexOf("const setClassificationMutation = useMutation({");
  const mutationBody = source.slice(mutationStart, source.indexOf("});", mutationStart));
  assert.ok(mutationBody.includes("dataClient.staff.setOrderTestClassification(order.id, patch)"));
  assert.ok(!mutationBody.includes("dataClient.entities.Order.update"));
  assert.ok(!mutationBody.includes("onUpdate("), "must not round-trip through the generic onUpdate/Order.update path, which deliberately cannot write these columns");
});

test("OrderDrawer.jsx: the two classification toggles are wired independently - flipping one never sends the other field", async () => {
  const source = await readSource("src/components/orders/OrderDrawer.jsx");
  assert.ok(source.includes("setClassificationMutation.mutate({ isTest: e.target.checked })"));
  assert.ok(source.includes("setClassificationMutation.mutate({ excludedFromReports: e.target.checked })"));
  // Neither call site bundles both fields into one mutate() call.
  assert.ok(!source.includes("mutate({ isTest: e.target.checked, excludedFromReports"));
  assert.ok(!source.includes("mutate({ excludedFromReports: e.target.checked, isTest"));
});

test("OrderDrawer.jsx: mutation errors surface via toast, and control uses the preferred wording with a clarifying description for each toggle", async () => {
  const source = await readSource("src/components/orders/OrderDrawer.jsx");
  assert.ok(source.includes('toast.error("Could not update classification - "'));
  assert.ok(source.includes("Test / QA order"));
  assert.ok(source.includes("Exclude from reports &amp; operations"));
  assert.ok(source.includes("Excludes this order from operational counts, finance totals, production queues and client-facing XOS views."));
});

test("OrderDrawer.jsx: classification checkboxes are disabled while the mutation is in flight, so a second click can't fire while the first hasn't resolved", async () => {
  const source = await readSource("src/components/orders/OrderDrawer.jsx");
  const occurrences = (source.match(/disabled=\{setClassificationMutation\.isPending\}/g) || []).length;
  assert.equal(occurrences, 2);
});
