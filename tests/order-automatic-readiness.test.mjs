import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  getRepresentedClientProductIds,
  derivePaymentFact,
  deriveClientApprovalFact,
  deriveLineConfigurationFact,
  deriveProductionFilesFact,
  buildAutomaticReadinessItems,
} from "../src/lib/orderAutomaticReadiness.js";

async function readSource(relativePath) {
  const raw = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  return raw.replace(/\r\n/g, "\n");
}

const CARD_PATH = "src/components/orders/ProductionReadinessCard.jsx";
const DRAWER_PATH = "src/components/orders/OrderDrawer.jsx";

// ─────────────────────────────────────────────────────────────────────
// Order Operational Readiness, Phase B2 - "Ready automatically" strip.
// Pure-logic unit tests for src/lib/orderAutomaticReadiness.js, plus
// static-source assertions on ProductionReadinessCard.jsx proving the
// strip is additive, separate from the manual checklist, and introduces
// no new write path - same convention as every other migration/component
// test in this suite.
// ─────────────────────────────────────────────────────────────────────

test("getRepresentedClientProductIds extracts distinct product-line ids, skips non-product lines and lines without a client_product_id", () => {
  const order = {
    products: [
      { line_role: "product", client_product_id: "a" },
      { line_role: "product", client_product_id: "b" },
      { line_role: "product", client_product_id: "a" }, // duplicate
      { line_role: "setup_fee", client_product_id: "c" }, // not a product line
      { line_role: "product" }, // no client_product_id
      { client_product_id: "d" }, // line_role defaults to 'product'
    ],
  };
  assert.deepEqual(getRepresentedClientProductIds(order), ["a", "b", "d"]);
});

test("getRepresentedClientProductIds returns [] for a missing/empty products array", () => {
  assert.deepEqual(getRepresentedClientProductIds({}), []);
  assert.deepEqual(getRepresentedClientProductIds({ products: [] }), []);
  assert.deepEqual(getRepresentedClientProductIds(null), []);
});

test("derivePaymentFact reads balance_due directly - satisfied only when it is not a positive number", () => {
  assert.equal(derivePaymentFact({ balance_due: 0 }).satisfied, true);
  assert.equal(derivePaymentFact({ balance_due: null }).satisfied, true);
  const unsatisfied = derivePaymentFact({ balance_due: 2770 });
  assert.equal(unsatisfied.satisfied, false);
  assert.match(unsatisfied.detail, /2,?770/);
});

test("deriveClientApprovalFact requires EVERY represented product to have its own approved client_product_concept row - one approval never covers another product", () => {
  const approvals = [
    { related_table: "client_products", related_id: "jv1", approval_type: "client_product_concept", status: "approved" },
  ];
  // Only JV1 approved, Sweater also represented and NOT approved.
  const result = deriveClientApprovalFact({ representedClientProductIds: ["jv1", "sweater"], approvals });
  assert.equal(result.satisfied, false);
  assert.deepEqual(result.missingProductIds, ["sweater"]);
});

test("deriveClientApprovalFact is satisfied when every represented product has its own approved row (the real JV1+Sweater fixture)", () => {
  const approvals = [
    { related_table: "client_products", related_id: "jv1", approval_type: "client_product_concept", status: "approved" },
    { related_table: "client_products", related_id: "sweater", approval_type: "client_product_concept", status: "approved" },
  ];
  const result = deriveClientApprovalFact({ representedClientProductIds: ["jv1", "sweater"], approvals });
  assert.equal(result.satisfied, true);
  assert.equal(result.detail, null);
});

test("deriveClientApprovalFact does not count a pending or rejected approval, and does not count an approval for a different, unrelated product", () => {
  const approvals = [
    { related_table: "client_products", related_id: "jv1", approval_type: "client_product_concept", status: "pending" },
    { related_table: "client_products", related_id: "some_other_product", approval_type: "client_product_concept", status: "approved" },
  ];
  const result = deriveClientApprovalFact({ representedClientProductIds: ["jv1"], approvals });
  assert.equal(result.satisfied, false);
  assert.deepEqual(result.missingProductIds, ["jv1"]);
});

test("deriveClientApprovalFact is vacuously satisfied when the order represents no client products", () => {
  assert.equal(deriveClientApprovalFact({ representedClientProductIds: [], approvals: [] }).satisfied, true);
});

test("deriveLineConfigurationFact reads order_readiness directly from the line-readiness RPC output - never recomputes per-line feasibility", () => {
  assert.equal(deriveLineConfigurationFact({ order_readiness: "ready", lines: [] }).satisfied, true);
  assert.equal(deriveLineConfigurationFact({ order_readiness: "ready_with_warnings", lines: [] }).satisfied, true);
  const blocked = deriveLineConfigurationFact({
    order_readiness: "blocked",
    lines: [{ status: "blocked", blocking_reasons: [{ code: "ARTWORK_MISSING", message: "Front: required artwork is missing." }] }],
  });
  assert.equal(blocked.satisfied, false);
  assert.equal(blocked.detail, "Front: required artwork is missing.");
});

test("deriveLineConfigurationFact returns satisfied=null (unresolved, not a false negative) when the line-readiness query hasn't loaded yet", () => {
  assert.equal(deriveLineConfigurationFact(undefined).satisfied, null);
  assert.equal(deriveLineConfigurationFact({}).satisfied, null);
});

test("deriveProductionFilesFact reads readiness.ready directly from admin_get_client_product_artwork_readiness - satisfied only when EVERY represented product's artwork is ready", () => {
  const allReady = deriveProductionFilesFact([
    { clientProductId: "jv1", readiness: { ready: true } },
    { clientProductId: "sweater", readiness: { ready: true } },
  ]);
  assert.equal(allReady.satisfied, true);

  const oneNotReady = deriveProductionFilesFact([
    { clientProductId: "jv1", readiness: { ready: true } },
    { clientProductId: "sweater", readiness: { ready: false, blocking_reasons: ["Front (Chest): production file confirmation pending"] } },
  ]);
  assert.equal(oneNotReady.satisfied, false);
  assert.deepEqual(oneNotReady.missingProductIds, ["sweater"]);
});

test("deriveProductionFilesFact never uses the stricter requirements-confirmation classification - legacy_fallback=true with ready=true is still satisfied", () => {
  // This is the real live shape for JV1/Sweater: legacy_fallback is true
  // (required_placements was never explicitly locked by an admin) but
  // ready is true (every placement's production file IS confirmed).
  // deriveReadinessState() from clientProductReadiness.js would call this
  // "requirements_unconfirmed" - this fact must NOT reuse that
  // classification, it reads `ready` directly.
  const result = deriveProductionFilesFact([
    { clientProductId: "jv1", readiness: { legacy_fallback: true, ready: true, required_placements: ["Front (Chest)", "Back"] } },
  ]);
  assert.equal(result.satisfied, true);
});

test("buildAutomaticReadinessItems returns exactly 4 items with the required keys/labels, and all satisfied=true for the real XL-261006-3936 fixture", () => {
  const items = buildAutomaticReadinessItems({
    readinessOrder: { balance_due: 0 },
    approvals: [
      { related_table: "client_products", related_id: "jv1", approval_type: "client_product_concept", status: "approved" },
      { related_table: "client_products", related_id: "sweater", approval_type: "client_product_concept", status: "approved" },
    ],
    representedClientProductIds: ["jv1", "sweater"],
    lineProductionReadiness: { order_readiness: "ready", lines: [] },
    artworkReadinessEntries: [
      { clientProductId: "jv1", readiness: { ready: true } },
      { clientProductId: "sweater", readiness: { ready: true } },
    ],
  });
  assert.deepEqual(items.map((i) => i.key), ["payment", "client_approval", "line_configuration", "production_files"]);
  assert.deepEqual(items.map((i) => i.label), ["Payment", "Client approval", "Line configuration", "Production files"]);
  assert.ok(items.every((i) => i.satisfied === true));
});

// ── Static-source assertions on the component itself ───────────────────

let card;
let drawer;

test.before(async () => {
  card = await readSource(CARD_PATH);
  drawer = await readSource(DRAWER_PATH);
});

test("the automatic strip is rendered as its own section, visually separated from and before the manual checklist", () => {
  // Phase B3 renamed the manual-checklist heading from "Manual /
  // operational checks" to "Production checks" (the relevance-filtered
  // model) - the ordering invariant this test actually cares about
  // (automatic strip renders first) still holds under either heading.
  const stripIndex = card.indexOf("<AutomaticReadinessStrip");
  const manualHeadingIndex = card.indexOf("Production checks");
  const checksListIndex = card.indexOf("checks.map((check) =>");
  assert.notEqual(stripIndex, -1);
  assert.notEqual(manualHeadingIndex, -1);
  assert.ok(stripIndex < manualHeadingIndex, "the automatic strip must render before the manual checklist heading");
  assert.ok(manualHeadingIndex < checksListIndex, "the manual heading must sit directly above the checks list");
});

test("AutomaticReadinessStrip introduces no .update(), no mutation, no Select — it is read-only", () => {
  const start = card.indexOf("function AutomaticReadinessStrip(");
  const end = card.indexOf("function Metric(");
  assert.notEqual(start, -1);
  const stripFn = card.slice(start, end);
  assert.doesNotMatch(stripFn, /\.update\(/);
  assert.doesNotMatch(stripFn, /useMutation/);
  assert.doesNotMatch(stripFn, /<Select/);
  assert.doesNotMatch(stripFn, /updateOrderProductionReadinessCheck/);
});

test("the automatic items are built from buildAutomaticReadinessItems (the existing-authority derivation), not recomputed inline", () => {
  assert.match(card, /buildAutomaticReadinessItems\(/);
  assert.match(card, /getRepresentedClientProductIds\(/);
});

test("artwork readiness is fetched via the EXISTING getClientProductArtworkReadiness wrapper, never a new RPC name", () => {
  assert.match(card, /getClientProductArtworkReadiness\(\{ clientProductId \}\)/);
  assert.doesNotMatch(card, /supabase\.rpc\(\s*["'](?!admin_get_client_product_artwork_readiness)/);
});

test("line configuration is read from a prop (the order-line readiness this order drawer already fetches), not from a new query inside the card", () => {
  assert.match(card, /ProductionReadinessCard\(\{ order, readinessQuery, lineProductionReadiness \}\)/);
  assert.doesNotMatch(card, /supabase\.rpc\(\s*["']get_order_line_production_readiness["']/);
  assert.doesNotMatch(card, /useQuery\(\{[^}]*orderLineProductionReadiness/s);
});

test("OrderDrawer passes its existing lineProductionReadiness data straight through — no new fetch is introduced at the drawer level", () => {
  assert.match(drawer, /lineProductionReadiness=\{drawerData\.lineProductionReadiness\}/);
});

test("the manual checklist still writes through the same updateOrderProductionReadinessCheck RPC wrapper", () => {
  // Phase B3 replaced the flat 8-key dropdown UI with a relevance-filtered,
  // compact row UI (see order-readiness-checklist-relevance-model.test.mjs
  // for that phase's own assertions) - this test only confirms the write
  // path itself wasn't bypassed or duplicated.
  assert.match(card, /updateOrderProductionReadinessCheck/);
  const updateCheckStart = card.indexOf("const updateCheck = (check, status, noteValue)");
  assert.notEqual(updateCheckStart, -1);
});

test("the automatic strip never writes into data.summary.ready_state or the checklist — it has no setter for either", () => {
  const start = card.indexOf("function AutomaticReadinessStrip(");
  const end = card.indexOf("function Metric(");
  const stripFn = card.slice(start, end);
  assert.doesNotMatch(stripFn, /ready_state/);
  assert.doesNotMatch(stripFn, /setNotes/);
});
