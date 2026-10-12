import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  getRepresentedClientProductIds,
  derivePaymentFact,
  deriveClientApprovalFact,
  deriveLineConfigurationFact,
  groupOrderArtworkByLine,
  listDistinctOrderArtworkRevisionIds,
  deriveProductionFilesFact,
  buildAutomaticReadinessItems,
} from "../src/lib/orderAutomaticReadiness.js";

async function readSource(relativePath) {
  const raw = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  return raw.replace(/\r\n/g, "\n");
}

const CARD_PATH = "src/components/orders/ProductionReadinessCard.jsx";
const DRAWER_PATH = "src/components/orders/OrderDrawer.jsx";
const STRIP_PATH = "src/components/orders/AutomaticReadinessStrip.jsx";
const HOOK_PATH = "src/hooks/useOrderAutomaticReadiness.js";
const SUMMARY_PATH = "src/components/orders/drawer/OrderOperationalSummary.jsx";

// ─────────────────────────────────────────────────────────────────────
// Order Operational Readiness, Phase B2 - "Ready automatically" strip.
// Pure-logic unit tests for src/lib/orderAutomaticReadiness.js, plus
// static-source assertions on ProductionReadinessCard.jsx proving the
// strip is additive, separate from the manual checklist, and introduces
// no new write path - same convention as every other migration/component
// test in this suite.
//
// Fresh-audit finding this revision fixes: admin_get_client_product_
// artwork_readiness(client_product_id) is NOT order-aware - it only ever
// reports the CURRENT (is_current=true) revision's status. For order
// XL-261006-3936 (b4551439-d32e-4a38-ad8e-d146e8a8717a), confirmed live
// against production: 2 of its 3 JV1 lines are frozen to a historical
// revision (status='pending', never reviewed) that was later superseded
// by a now-current, approved revision. The fixture below ("historical
// frozen artwork...") reproduces exactly that shape.
//
// Final-review revision: moved from a product-level UNION of artwork
// revisions (which could let one line's missing/unconfirmed artwork hide
// behind a sibling line's own coverage) to a genuinely PER-LINE
// evaluation, added a defence-in-depth check that a resolved artwork
// row's own client_product_id/placement actually matches what the
// order's snapshot claims, and switched the data-fetch strategy from one
// query per distinct revision id to one batched query per represented
// product (existing ClientProductArtwork.filter({client_product_id})
// capability) - fewer requests, no sequential waterfall.
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

// ── 2. Partial/unpaid payment ───────────────────────────────────────────

test("derivePaymentFact reads balance_due directly - a PARTIALLY paid order is never equated with a fully paid one", () => {
  assert.equal(derivePaymentFact({ balance_due: 0 }).satisfied, true);
  assert.equal(derivePaymentFact({ balance_due: null }).satisfied, true);
  const partiallyPaid = derivePaymentFact({ balance_due: 500.5 });
  assert.equal(partiallyPaid.satisfied, false);
  assert.match(partiallyPaid.detail, /500\.50/);
  const unpaid = derivePaymentFact({ balance_due: 2770 });
  assert.equal(unpaid.satisfied, false);
  assert.match(unpaid.detail, /2,?770/);
});

// ── 3. One represented client product unapproved ───────────────────────

test("deriveClientApprovalFact requires EVERY represented product to have its own approved client_product_concept row - one approval never covers another product", () => {
  const approvals = [
    { related_table: "client_products", related_id: "jv1", approval_type: "client_product_concept", status: "approved" },
  ];
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

// ── 4. Blocked order line ───────────────────────────────────────────────

test("deriveLineConfigurationFact reads order_readiness directly from the line-readiness RPC output - never recomputes per-line feasibility - and surfaces an N/M ready count", () => {
  assert.equal(deriveLineConfigurationFact({ order_readiness: "ready", lines: [] }).satisfied, true);
  assert.equal(deriveLineConfigurationFact({ order_readiness: "ready_with_warnings", lines: [] }).satisfied, true);
  const allReady = deriveLineConfigurationFact({
    order_readiness: "ready",
    lines: [{ status: "ready" }, { status: "ready" }, { status: "ready" }, { status: "ready" }, { status: "ready" }],
  });
  assert.equal(allReady.satisfied, true);
  assert.equal(allReady.detail, "5/5 lines ready");

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

// ── groupOrderArtworkByLine / listDistinctOrderArtworkRevisionIds ──────

test("groupOrderArtworkByLine keys by LINE, not just placement - two lines of the same product/placement keep their own independent revision lists", () => {
  const snapshots = [
    { client_product_id: "jv1", line_id: "line-A", placement: "Front (Chest)", artwork_revision_ids: ["rev-a"] },
    { client_product_id: "jv1", line_id: "line-A", placement: null, artwork_revision_ids: [] }, // blank garment row for line-A
    { client_product_id: "jv1", line_id: "line-B", placement: "Front (Chest)", artwork_revision_ids: ["rev-c"] }, // different line, different revision
    { client_product_id: "not_represented", line_id: "line-X", placement: "Front (Chest)", artwork_revision_ids: ["rev-x"] },
  ];
  const grouped = groupOrderArtworkByLine(snapshots, ["jv1"]);
  assert.deepEqual(grouped, {
    jv1: {
      "line-A": { "Front (Chest)": ["rev-a"] },
      "line-B": { "Front (Chest)": ["rev-c"] },
    },
  });
});

test("groupOrderArtworkByLine registers a line even when it has no placement rows at all (blank-garment-only), so a line with nothing tracked is never simply absent from consideration", () => {
  const snapshots = [{ client_product_id: "jv1", line_id: "line-A", placement: null, artwork_revision_ids: [] }];
  const grouped = groupOrderArtworkByLine(snapshots, ["jv1"]);
  assert.deepEqual(grouped, { jv1: { "line-A": {} } });
});

test("groupOrderArtworkByLine de-duplicates identical revision ids within the same line/placement - never counts one frozen file as two required artworks", () => {
  const snapshots = [
    { client_product_id: "jv1", line_id: "line-A", placement: "Front (Chest)", artwork_revision_ids: ["rev-a", "rev-a"] },
  ];
  const grouped = groupOrderArtworkByLine(snapshots, ["jv1"]);
  assert.deepEqual(grouped.jv1["line-A"]["Front (Chest)"], ["rev-a"]);
});

test("listDistinctOrderArtworkRevisionIds flattens and de-duplicates every revision id across products/lines/placements", () => {
  const grouped = {
    jv1: { "line-A": { "Front (Chest)": ["rev-a", "rev-c"] }, "line-B": { Back: ["rev-b"] } },
    sweater: { "line-C": { "Front (Chest)": ["rev-a"] } }, // shared id across products
  };
  assert.deepEqual(listDistinctOrderArtworkRevisionIds(grouped), ["rev-a", "rev-b", "rev-c"]);
});

// ── 1. Evaluate every order line independently ──────────────────────────

test("deriveProductionFilesFact: ONE line missing a required placement blocks the product even though a SIBLING line of the same product has it fully confirmed", () => {
  const result = deriveProductionFilesFact({
    representedClientProductIds: ["jv1"],
    artworkReadinessEntries: [{ clientProductId: "jv1", readiness: { required_placements: ["Front (Chest)"] } }],
    orderArtworkByLine: {
      jv1: {
        "line-A": { "Front (Chest)": ["rev-approved"] }, // this line is fully confirmed
        "line-B": {}, // this line has nothing tracked for Front (Chest) at all
      },
    },
    revisionLookup: { "rev-approved": { status: "approved", is_current: true, clientProductId: "jv1", placement: "Front (Chest)" } },
  });
  assert.equal(result.satisfied, false, "line-B's missing artwork must not be hidden behind line-A's coverage");
  assert.match(result.detail, /Front \(Chest\): not linked to this order's lines/);
});

test("deriveProductionFilesFact: ONE line frozen to an unconfirmed revision blocks the product even though a sibling line is confirmed", () => {
  const result = deriveProductionFilesFact({
    representedClientProductIds: ["jv1"],
    artworkReadinessEntries: [{ clientProductId: "jv1", readiness: { required_placements: ["Front (Chest)"] } }],
    orderArtworkByLine: {
      jv1: {
        "line-A": { "Front (Chest)": ["rev-approved"] },
        "line-B": { "Front (Chest)": ["rev-pending"] },
      },
    },
    revisionLookup: {
      "rev-approved": { status: "approved", is_current: true, clientProductId: "jv1", placement: "Front (Chest)" },
      "rev-pending": { status: "pending", is_current: false, clientProductId: "jv1", placement: "Front (Chest)" },
    },
  });
  assert.equal(result.satisfied, false);
});

test("deriveProductionFilesFact: all lines independently confirmed is required for satisfied=true", () => {
  const result = deriveProductionFilesFact({
    representedClientProductIds: ["jv1"],
    artworkReadinessEntries: [{ clientProductId: "jv1", readiness: { required_placements: ["Front (Chest)", "Back"] } }],
    orderArtworkByLine: {
      jv1: {
        "line-A": { "Front (Chest)": ["rev-1"], Back: ["rev-2"] },
        "line-B": { "Front (Chest)": ["rev-1"], Back: ["rev-2"] }, // same revisions, shared across lines - fine
      },
    },
    revisionLookup: {
      "rev-1": { status: "approved", is_current: true, clientProductId: "jv1", placement: "Front (Chest)" },
      "rev-2": { status: "approved", is_current: true, clientProductId: "jv1", placement: "Back" },
    },
  });
  assert.equal(result.satisfied, true);
});

// ── 5. Missing artwork/file confirmation ────────────────────────────────

test("deriveProductionFilesFact: a required placement with no order-frozen revision at all on the only line is reported as not linked, not silently satisfied", () => {
  const result = deriveProductionFilesFact({
    representedClientProductIds: ["jv1"],
    artworkReadinessEntries: [{ clientProductId: "jv1", readiness: { required_placements: ["Front (Chest)", "Back"] } }],
    orderArtworkByLine: { jv1: { "line-A": { "Front (Chest)": ["rev-a"] } } }, // Back never linked
    revisionLookup: { "rev-a": { status: "approved", is_current: true, clientProductId: "jv1", placement: "Front (Chest)" } },
  });
  assert.equal(result.satisfied, false);
  assert.match(result.detail, /Back: not linked to this order/);
  assert.deepEqual(result.missingProductIds, ["jv1"]);
});

test("deriveProductionFilesFact: a product with zero tracked lines at all (no snapshot rows whatsoever) is not satisfied, not silently skipped", () => {
  const result = deriveProductionFilesFact({
    representedClientProductIds: ["jv1"],
    artworkReadinessEntries: [{ clientProductId: "jv1", readiness: { required_placements: ["Front (Chest)"] } }],
    orderArtworkByLine: {}, // jv1 has no lines registered at all
    revisionLookup: {},
  });
  assert.equal(result.satisfied, false);
  assert.deepEqual(result.missingProductIds, ["jv1"]);
});

test("deriveProductionFilesFact: a linked revision whose status is still pending is not satisfied", () => {
  const result = deriveProductionFilesFact({
    representedClientProductIds: ["jv1"],
    artworkReadinessEntries: [{ clientProductId: "jv1", readiness: { required_placements: ["Front (Chest)"] } }],
    orderArtworkByLine: { jv1: { "line-A": { "Front (Chest)": ["rev-a"] } } },
    revisionLookup: { "rev-a": { status: "pending", is_current: true, clientProductId: "jv1", placement: "Front (Chest)" } },
  });
  assert.equal(result.satisfied, false);
  assert.match(result.detail, /production file is not yet confirmed/);
});

// ── 6. Historical frozen artwork must never be silently treated as the
//      current confirmed artwork (the core fix) ────────────────────────

test("deriveProductionFilesFact: this order's lines frozen to a HISTORICAL, never-approved revision are NOT satisfied, even though the product's CURRENT revision is fully approved", () => {
  // Reproduces the real live shape for order XL-261006-3936 / JV1: Front
  // (Chest) revision 1 = historical, status 'pending', is_current=false
  // (confirm_client_product_artwork_production_file refuses non-current
  // rows outright, so a superseded row can never become 'approved' after
  // the fact). Front (Chest) revision 2 = current, status 'approved'.
  // This order's own snapshot lines are frozen to revision 1, NOT 2.
  const result = deriveProductionFilesFact({
    representedClientProductIds: ["jv1"],
    artworkReadinessEntries: [{ clientProductId: "jv1", readiness: { required_placements: ["Front (Chest)", "Back"] } }],
    orderArtworkByLine: {
      jv1: {
        "line-A": { "Front (Chest)": ["rev-1-historical"], Back: ["rev-1-historical-back"] },
      },
    },
    revisionLookup: {
      "rev-1-historical": { status: "pending", is_current: false, clientProductId: "jv1", placement: "Front (Chest)" }, // Sky Blue, never approved
      "rev-1-historical-back": { status: "pending", is_current: false, clientProductId: "jv1", placement: "Back" },
      // the CURRENT revision (approved) exists in the system but this
      // order was never frozen to it, so it must play no part here:
      "rev-2-current": { status: "approved", is_current: true, clientProductId: "jv1", placement: "Front (Chest)" },
    },
  });
  assert.equal(result.satisfied, false, "a historical, never-approved frozen revision must not read as confirmed");
  assert.deepEqual(result.missingProductIds, ["jv1"]);
});

test("deriveProductionFilesFact: a frozen revision that WAS approved before being superseded still counts as confirmed for this order, even though it is no longer current", () => {
  const result = deriveProductionFilesFact({
    representedClientProductIds: ["jv1"],
    artworkReadinessEntries: [{ clientProductId: "jv1", readiness: { required_placements: ["Front (Chest)"] } }],
    orderArtworkByLine: { jv1: { "line-A": { "Front (Chest)": ["rev-old-but-approved"] } } },
    revisionLookup: { "rev-old-but-approved": { status: "approved", is_current: false, clientProductId: "jv1", placement: "Front (Chest)" } },
  });
  assert.equal(result.satisfied, true);
});

// ── Verify the revision belongs to the expected product/placement ──────

test("deriveProductionFilesFact: a resolved revision whose OWN client_product_id does not match the expected product is rejected as ambiguous, never trusted", () => {
  const result = deriveProductionFilesFact({
    representedClientProductIds: ["jv1"],
    artworkReadinessEntries: [{ clientProductId: "jv1", readiness: { required_placements: ["Front (Chest)"] } }],
    orderArtworkByLine: { jv1: { "line-A": { "Front (Chest)": ["rev-mismatched"] } } },
    // This revision actually belongs to a DIFFERENT product (data
    // integrity issue, or a stale/reused id) - its 'approved' status must
    // never be trusted on jv1's behalf.
    revisionLookup: { "rev-mismatched": { status: "approved", is_current: true, clientProductId: "some_other_product", placement: "Front (Chest)" } },
  });
  assert.equal(result.satisfied, null);
  assert.equal(result.unavailable, true);
  assert.notEqual(result.satisfied, true, "a product/placement mismatch must never read as confirmed");
});

test("deriveProductionFilesFact: a resolved revision whose OWN placement does not match the expected placement is rejected as ambiguous, never trusted", () => {
  const result = deriveProductionFilesFact({
    representedClientProductIds: ["jv1"],
    artworkReadinessEntries: [{ clientProductId: "jv1", readiness: { required_placements: ["Front (Chest)"] } }],
    orderArtworkByLine: { jv1: { "line-A": { "Front (Chest)": ["rev-wrong-placement"] } } },
    revisionLookup: { "rev-wrong-placement": { status: "approved", is_current: true, clientProductId: "jv1", placement: "Back" } },
  });
  assert.equal(result.satisfied, null);
  assert.equal(result.unavailable, true);
});

test("deriveProductionFilesFact: a known blocker on this SAME product takes priority over an ambiguous/mismatched reference found on another line of it", () => {
  const result = deriveProductionFilesFact({
    representedClientProductIds: ["jv1"],
    artworkReadinessEntries: [{ clientProductId: "jv1", readiness: { required_placements: ["Front (Chest)"] } }],
    orderArtworkByLine: {
      jv1: {
        "line-A": { "Front (Chest)": ["rev-pending"] }, // definite blocker
        "line-B": { "Front (Chest)": ["rev-mismatched"] }, // ambiguous
      },
    },
    revisionLookup: {
      "rev-pending": { status: "pending", is_current: true, clientProductId: "jv1", placement: "Front (Chest)" },
      "rev-mismatched": { status: "approved", is_current: true, clientProductId: "wrong_product", placement: "Front (Chest)" },
    },
  });
  assert.equal(result.satisfied, false, "a definite, already-identified gap is more actionable than an unknown and must win");
  assert.deepEqual(result.missingProductIds, ["jv1"]);
});

// ── mixed-revision-per-line scenario (real order shape) ─────────────────

test("deriveProductionFilesFact: order XL-261006-3936's real shape - 2 of 3 JV1 lines frozen to the historical revision, 1 to current - product-level verdict is false", () => {
  const result = deriveProductionFilesFact({
    representedClientProductIds: ["jv1"],
    artworkReadinessEntries: [{ clientProductId: "jv1", readiness: { required_placements: ["Front (Chest)", "Back"] } }],
    orderArtworkByLine: {
      jv1: {
        "line-1": { "Front (Chest)": ["rev-historical-front"], Back: ["rev-historical-back"] },
        "line-2": { "Front (Chest)": ["rev-historical-front"], Back: ["rev-historical-back"] },
        "line-3": { "Front (Chest)": ["rev-current-front"], Back: ["rev-current-back"] },
      },
    },
    revisionLookup: {
      "rev-historical-front": { status: "pending", is_current: false, clientProductId: "jv1", placement: "Front (Chest)" },
      "rev-historical-back": { status: "pending", is_current: false, clientProductId: "jv1", placement: "Back" },
      "rev-current-front": { status: "approved", is_current: true, clientProductId: "jv1", placement: "Front (Chest)" },
      "rev-current-back": { status: "approved", is_current: true, clientProductId: "jv1", placement: "Back" },
    },
  });
  assert.equal(result.satisfied, false, "2 of 3 lines are unconfirmed - the product-level verdict must not average this away to 'good enough'");
});

// ── 7. Unknown or unavailable authority ─────────────────────────────────

test("deriveProductionFilesFact: a frozen revision id with no lookup result (fetch failed / row unreadable) is UNAVAILABLE - never a silent green check", () => {
  const result = deriveProductionFilesFact({
    representedClientProductIds: ["jv1"],
    artworkReadinessEntries: [{ clientProductId: "jv1", readiness: { required_placements: ["Front (Chest)"] } }],
    orderArtworkByLine: { jv1: { "line-A": { "Front (Chest)": ["rev-unreadable"] } } },
    revisionLookup: {}, // rev-unreadable has no entry - query failed or row missing
  });
  assert.equal(result.satisfied, null);
  assert.equal(result.unavailable, true);
  assert.notEqual(result.satisfied, true, "an unknown fact must never read as satisfied");
});

test("deriveProductionFilesFact: a product with no resolved required-placements entry at all (the authority itself failed to load) is UNAVAILABLE, never silently satisfied", () => {
  const result = deriveProductionFilesFact({
    representedClientProductIds: ["jv1"],
    artworkReadinessEntries: [], // admin_get_client_product_artwork_readiness never resolved for jv1
    orderArtworkByLine: {},
    revisionLookup: {},
  });
  assert.equal(result.satisfied, null);
  assert.equal(result.unavailable, true);
});

test("deriveProductionFilesFact: a known blocker takes priority over an UNRELATED product's unavailable fact (more actionable wins)", () => {
  const result = deriveProductionFilesFact({
    representedClientProductIds: ["jv1", "sweater"],
    artworkReadinessEntries: [
      { clientProductId: "jv1", readiness: { required_placements: ["Front (Chest)"] } },
      { clientProductId: "sweater", readiness: { required_placements: ["Front (Chest)"] } },
    ],
    orderArtworkByLine: {
      jv1: { "line-A": { "Front (Chest)": ["rev-pending"] } },
      sweater: { "line-B": { "Front (Chest)": ["rev-unreadable"] } },
    },
    revisionLookup: { "rev-pending": { status: "pending", is_current: true, clientProductId: "jv1", placement: "Front (Chest)" } },
  });
  assert.equal(result.satisfied, false);
  assert.deepEqual(result.missingProductIds, ["jv1"]);
});

test("deriveProductionFilesFact: a product requiring no placements is trivially satisfied, with no network round trip implied", () => {
  const result = deriveProductionFilesFact({
    representedClientProductIds: ["blank_label"],
    artworkReadinessEntries: [{ clientProductId: "blank_label", readiness: { required_placements: [] } }],
    orderArtworkByLine: {},
    revisionLookup: {},
  });
  assert.equal(result.satisfied, true);
  assert.equal(result.detail, "1/1 product confirmed");
});

test("deriveProductionFilesFact is vacuously satisfied when the order represents no client products", () => {
  assert.equal(
    deriveProductionFilesFact({ representedClientProductIds: [], artworkReadinessEntries: [], orderArtworkByLine: {}, revisionLookup: {} }).satisfied,
    true,
  );
});

// ── 1. All four automatic indicators satisfied ──────────────────────────

test("buildAutomaticReadinessItems returns exactly 4 items with the required keys/labels, all satisfied=true when every order-frozen revision on every line is actually confirmed", () => {
  const items = buildAutomaticReadinessItems({
    readinessOrder: { balance_due: 0 },
    approvals: [
      { related_table: "client_products", related_id: "jv1", approval_type: "client_product_concept", status: "approved" },
      { related_table: "client_products", related_id: "sweater", approval_type: "client_product_concept", status: "approved" },
    ],
    representedClientProductIds: ["jv1", "sweater"],
    lineProductionReadiness: { order_readiness: "ready", lines: [{ status: "ready" }] },
    artworkReadinessEntries: [
      { clientProductId: "jv1", readiness: { required_placements: ["Front (Chest)", "Back"] } },
      { clientProductId: "sweater", readiness: { required_placements: ["Front (Chest)"] } },
    ],
    orderArtworkByLine: {
      jv1: { "line-1": { "Front (Chest)": ["jv1-front"], Back: ["jv1-back"] } },
      sweater: { "line-2": { "Front (Chest)": ["sweater-front"] } },
    },
    revisionLookup: {
      "jv1-front": { status: "approved", is_current: true, clientProductId: "jv1", placement: "Front (Chest)" },
      "jv1-back": { status: "approved", is_current: true, clientProductId: "jv1", placement: "Back" },
      "sweater-front": { status: "approved", is_current: true, clientProductId: "sweater", placement: "Front (Chest)" },
    },
  });
  assert.deepEqual(items.map((i) => i.key), ["payment", "client_approval", "line_configuration", "production_files"]);
  assert.deepEqual(items.map((i) => i.label), ["Payment", "Client approval", "Line configuration", "Production files"]);
  assert.ok(items.every((i) => i.satisfied === true));
});

test("buildAutomaticReadinessItems reproduces the REAL live order XL-261006-3936 shape — production_files correctly reads false despite the product's current artwork being fully approved", () => {
  const items = buildAutomaticReadinessItems({
    readinessOrder: { balance_due: 0 }, // fully paid live (2770 paid == 2770 total, confirmed fresh against production)
    approvals: [
      { related_table: "client_products", related_id: "jv1", approval_type: "client_product_concept", status: "approved" },
      { related_table: "client_products", related_id: "sweater", approval_type: "client_product_concept", status: "approved" },
    ],
    representedClientProductIds: ["jv1", "sweater"],
    lineProductionReadiness: { order_readiness: "ready", lines: [{ status: "ready" }, { status: "ready" }, { status: "ready" }, { status: "ready" }, { status: "ready" }] },
    artworkReadinessEntries: [
      { clientProductId: "jv1", readiness: { required_placements: ["Front (Chest)", "Back"], ready: true } }, // CURRENT revision fully approved
      { clientProductId: "sweater", readiness: { required_placements: ["Front (Chest)"], ready: true } },
    ],
    orderArtworkByLine: {
      // 2 of 3 JV1 lines frozen to the historical (pending) revision,
      // 1 frozen to current (approved) - confirmed live via
      // order_line_component_snapshots.artwork_revision_ids.
      jv1: {
        "line-1": { "Front (Chest)": ["jv1-front-rev1"], Back: ["jv1-back-rev1"] },
        "line-2": { "Front (Chest)": ["jv1-front-rev1"], Back: ["jv1-back-rev1"] },
        "line-3": { "Front (Chest)": ["jv1-front-rev2"], Back: ["jv1-back-rev2"] },
      },
      sweater: { "line-4": { "Front (Chest)": ["sweater-front-rev2"] }, "line-5": { "Front (Chest)": ["sweater-front-rev2"] } },
    },
    revisionLookup: {
      "jv1-front-rev1": { status: "pending", is_current: false, clientProductId: "jv1", placement: "Front (Chest)" }, // historical, never confirmed
      "jv1-front-rev2": { status: "approved", is_current: true, clientProductId: "jv1", placement: "Front (Chest)" }, // current
      "jv1-back-rev1": { status: "pending", is_current: false, clientProductId: "jv1", placement: "Back" },
      "jv1-back-rev2": { status: "approved", is_current: true, clientProductId: "jv1", placement: "Back" },
      "sweater-front-rev2": { status: "approved", is_current: true, clientProductId: "sweater", placement: "Front (Chest)" },
    },
  });
  const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
  assert.equal(byKey.payment.satisfied, true);
  assert.equal(byKey.client_approval.satisfied, true);
  assert.equal(byKey.line_configuration.satisfied, true);
  assert.equal(byKey.production_files.satisfied, false, "must not show a misleading green check for this order");
  assert.deepEqual(byKey.production_files.missingProductIds, ["jv1"]);
});

// ── 3. Historical delivery behavior: no mutation anywhere in this module ──

test("orderAutomaticReadiness.js is pure read-only derivation - no status changes, no retrospective confirmations, no edits to any artwork row, no snapshot mutation", () => {
  return readSource("src/lib/orderAutomaticReadiness.js").then((source) => {
    assert.doesNotMatch(source, /confirm_client_product_artwork_production_file/);
    assert.doesNotMatch(source, /revise_order_line_component_snapshot_artwork/);
    assert.doesNotMatch(source, /\.insert\(|\.update\(|\.delete\(/);
  });
});

// ── 8. Legacy checklist unchanged ───────────────────────────────────────

test("the legacy 8 checklist keys / checklist_state formula are untouched by this revision — no references in the automatic-readiness module", () => {
  return readSource("src/lib/orderAutomaticReadiness.js").then((source) => {
    assert.doesNotMatch(source, /checklist_state/);
    assert.doesNotMatch(source, /check_key/);
    assert.doesNotMatch(source, /tech_pack_checked|special_instructions_checked|contract_terms_accepted|production_notes_reviewed/);
  });
});

// ── Static-source assertions on the component itself ───────────────────

let card;
let drawer;
let strip;
let hook;
let summary;

test.before(async () => {
  card = await readSource(CARD_PATH);
  drawer = await readSource(DRAWER_PATH);
  strip = await readSource(STRIP_PATH);
  hook = await readSource(HOOK_PATH);
  summary = await readSource(SUMMARY_PATH);
});

test("the automatic strip is rendered as its own section, visually separated from and before the manual checklist", () => {
  const stripIndex = card.indexOf("<AutomaticReadinessStrip");
  const manualHeadingIndex = card.indexOf("Production checks");
  const checksListIndex = card.indexOf("checks.map((check) =>");
  assert.notEqual(stripIndex, -1);
  assert.notEqual(manualHeadingIndex, -1);
  assert.ok(stripIndex < manualHeadingIndex, "the automatic strip must render before the manual checklist heading");
  assert.ok(manualHeadingIndex < checksListIndex, "the manual heading must sit directly above the checks list");
});

// ── 9. No new mutation paths ─────────────────────────────────────────────

test("AutomaticReadinessStrip (now its own shared file, Phase C1) introduces no .update(), no mutation, no Select — it is read-only", () => {
  assert.doesNotMatch(strip, /\.update\(/);
  assert.doesNotMatch(strip, /useMutation/);
  assert.doesNotMatch(strip, /<Select/);
  assert.doesNotMatch(strip, /updateOrderProductionReadinessCheck/);
});

test("the order-artwork reads (snapshots, per-product artwork rows) are plain .filter() reads — no .insert/.update/.delete/useMutation anywhere in the shared hook or the card", () => {
  for (const source of [hook, card]) {
    assert.doesNotMatch(source, /OrderLineComponentSnapshot\.(insert|update|delete)/);
    assert.doesNotMatch(source, /ClientProductArtwork\.(insert|update|delete)/);
  }
  assert.match(hook, /OrderLineComponentSnapshot\.filter\(/);
  assert.match(hook, /ClientProductArtwork\.filter\(/);
});

test("neither the card, the shared hook, nor the Details-tab summary call any artwork-mutation RPC (confirm_client_product_artwork_production_file) or snapshot-mutation RPC", () => {
  for (const source of [card, hook, summary]) {
    assert.doesNotMatch(source, /confirm_client_product_artwork_production_file/);
    assert.doesNotMatch(source, /revise_order_line_component_snapshot_artwork/);
  }
});

test("the automatic items are built from buildAutomaticReadinessItems (the existing-authority derivation) inside the shared hook, not recomputed inline in the card or the summary", () => {
  assert.match(hook, /buildAutomaticReadinessItems\(/);
  assert.match(hook, /getRepresentedClientProductIds\(/);
  assert.doesNotMatch(card, /buildAutomaticReadinessItems\(/);
  assert.doesNotMatch(summary, /buildAutomaticReadinessItems\(/);
});

test("artwork required-placements are fetched via the EXISTING getClientProductArtworkReadiness wrapper, never a new RPC name", () => {
  assert.match(hook, /getClientProductArtworkReadiness\(\{ clientProductId \}\)/);
  assert.doesNotMatch(hook, /supabase\.rpc\(\s*["'](?!admin_get_client_product_artwork_readiness)/);
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
  assert.match(card, /updateOrderProductionReadinessCheck/);
  const updateCheckStart = card.indexOf("const updateCheck = (check, status, noteValue)");
  assert.notEqual(updateCheckStart, -1);
});

test("the automatic strip never writes into data.summary.ready_state or the checklist — it has no setter for either", () => {
  assert.doesNotMatch(strip, /ready_state/);
  assert.doesNotMatch(strip, /setNotes/);
});

// ── 2. Loading and query efficiency ──────────────────────────────────────

test("the per-product artwork read is ONE batched query per represented product (client_product_id filter), never one query per distinct revision id", () => {
  assert.match(hook, /ClientProductArtwork\.filter\(\{ client_product_id: clientProductId \}, undefined, 200\)/);
  // the old per-revision-id query pattern must be gone
  assert.doesNotMatch(hook, /ClientProductArtwork\.filter\(\{ id: revisionId \}/);
});

test("the artwork/snapshot/product-artwork queries are not chained into a waterfall - productArtworkQueries is keyed only on representedClientProductIds, not on snapshotsQuery's result", () => {
  const snapshotsStart = hook.indexOf("const snapshotsQuery = useQuery(");
  const productArtworkStart = hook.indexOf("const productArtworkQueries = useQueries(");
  assert.notEqual(snapshotsStart, -1);
  assert.notEqual(productArtworkStart, -1);
  const productArtworkBlockEnd = hook.indexOf("const productArtworkLoading", productArtworkStart);
  const productArtworkBlock = hook.slice(productArtworkStart, productArtworkBlockEnd);
  // must not reference snapshots/orderArtworkByLine (the snapshot query's
  // own derived data) anywhere in its own query definition
  assert.doesNotMatch(productArtworkBlock, /\bsnapshots\b/);
  assert.doesNotMatch(productArtworkBlock, /orderArtworkByLine/);
  assert.match(productArtworkBlock, /representedClientProductIds\.map/);
});

test("every automatic-readiness query sets staleTime (React Query caching avoids unnecessary repeated requests)", () => {
  const matches = hook.match(/staleTime: 30_000/g) || [];
  assert.ok(matches.length >= 3, `expected at least 3 staleTime: 30_000 query configs, found ${matches.length}`);
});

test("the order-scoped snapshot query key includes order.id - switching orders cannot read stale cached data for a different order", () => {
  assert.match(hook, /queryKey: \["orderLineComponentSnapshots", "automaticReadiness", order\?\.id\]/);
});

test("the per-product queries (artwork readiness + artwork rows) are keyed by clientProductId, not by order - correct, since that data is genuinely product-level and safely cacheable/shared across orders that represent the same product", () => {
  assert.match(hook, /queryKey: \["clientProductArtworkReadiness", clientProductId\]/);
  assert.match(hook, /queryKey: \["clientProductArtworkRows", clientProductId\]/);
});

test("Phase C1: the shared hook is called with IDENTICAL arguments from both the card and the Details-tab summary, so React Query's cache (same query keys) serves the second mount from cache - no duplicate network request", () => {
  const callPattern = /useOrderAutomaticReadiness\(\{\s*order,\s*readinessQuery,\s*lineProductionReadiness,?\s*\}\)/;
  assert.match(card, callPattern);
  assert.match(summary, callPattern);
  // neither call site defines its own competing query keys
  assert.doesNotMatch(card, /queryKey: \["clientProductArtworkReadiness"/);
  assert.doesNotMatch(summary, /queryKey: \["clientProductArtworkReadiness"/);
  assert.doesNotMatch(summary, /useQuery\(|useQueries\(/);
});

// ── React hooks / conditional rendering correctness ─────────────────────

test("the card's own hooks (useState/useQueryClient/useMutation/the shared useOrderAutomaticReadiness) are declared before its first early return - no conditional hook calls", () => {
  const componentStart = card.indexOf("export default function ProductionReadinessCard(");
  const firstEarlyReturn = card.indexOf("if (!canLoadReadiness)", componentStart);
  const hooksRegion = card.slice(componentStart, firstEarlyReturn);
  for (const hookCall of ["useState(", "useQueryClient(", "useOrderAutomaticReadiness(", "useMutation("]) {
    assert.ok(hooksRegion.includes(hookCall), `expected ${hookCall} to appear before the first early return`);
  }
  assert.ok(firstEarlyReturn > componentStart, "the first early return must come after the hooks region");
});

test("the shared hook itself calls useQueries/useQuery/useMemo unconditionally - no early return inside it that could violate the Rules of Hooks", () => {
  assert.doesNotMatch(hook, /\n\s*if \([^)]*\)\s*return/);
  for (const hookCall of ["useQueries(", "useQuery(", "useMemo("]) {
    assert.ok(hook.includes(hookCall), `expected ${hookCall} in the shared hook`);
  }
});

// ── 10. Mobile rendering/layout ──────────────────────────────────────────

test("the strip uses a 2-column compact grid below sm: (375/390/414px all fall below the sm: breakpoint)", () => {
  assert.match(strip, /grid grid-cols-2 gap-2 sm:grid-cols-4/);
});

test("the strip renders 4 distinct visual states (ready/blocked/pending/unavailable) with icons and short labels, never a 5th ad-hoc style", () => {
  assert.match(strip, /AUTOMATIC_READINESS_TONE/);
  assert.match(strip, /ready:\s*\{ className: "bg-emerald-50 text-emerald-700", icon: CheckCircle2, spin: false \}/);
  assert.match(strip, /blocked:\s*\{ className: "bg-amber-50 text-amber-800", icon: AlertTriangle, spin: false \}/);
  assert.match(strip, /pending:\s*\{ className: "bg-secondary\/40 text-muted-foreground", icon: RefreshCw, spin: true \}/);
  assert.match(strip, /unavailable:\s*\{ className: "bg-slate-100 text-slate-600", icon: HelpCircle, spin: false \}/);
});

test("secondary detail text inside each tile uses a neutral grey, compact (text-[10px]) treatment — no bright/oversized panels", () => {
  assert.match(strip, /text-\[10px\] font-normal text-muted-foreground/);
});

test("an unavailable item never renders the emerald/green 'ready' tone", () => {
  const toneFnStart = strip.indexOf("function automaticReadinessTone(item)");
  const toneFnEnd = strip.indexOf("\n}", toneFnStart);
  const toneFn = strip.slice(toneFnStart, toneFnEnd);
  assert.match(toneFn, /if \(item\.unavailable\) return "unavailable";/);
});

// ─────────────────────────────────────────────────────────────────────
// Order Drawer Operational Summary, Phase C1 - surfaces the automatic
// readiness facts on the default Details tab (previously only visible
// after tapping into the Readiness tab, per the Phase B3 audit's own
// "mobile UX" finding). No backend/RPC/migration change, no new
// readiness calculation, no change to manual checklist logic, order
// status transitions, or the PAXI gate - static-source checks only.
// ─────────────────────────────────────────────────────────────────────

test("OrderDrawer renders OrderOperationalSummary at the TOP of the default 'details' tab block, before any other details content", () => {
  const tabStart = drawer.indexOf("{tab === 'details' && (");
  assert.notEqual(tabStart, -1, "details tab block not found");
  const summaryIndex = drawer.indexOf("<OrderOperationalSummary", tabStart);
  const printoutsIndex = drawer.indexOf("Order printouts", tabStart);
  assert.notEqual(summaryIndex, -1, "OrderOperationalSummary must be rendered inside the details tab");
  assert.ok(summaryIndex > tabStart, "must be inside the details tab block, not before it");
  assert.ok(summaryIndex < printoutsIndex, "must render before the existing 'Order printouts' section - i.e. at the top");
});

test("OrderDrawer passes the SAME readinessQuery/lineProductionReadiness props to the summary as it already passes to ProductionReadinessCard - no second, independent data source", () => {
  assert.match(drawer, /readinessQuery=\{drawerData\.readinessQuery\}/);
  // both the summary and the card reference drawerData.lineProductionReadiness - already asserted once above for the card; confirm it appears at least twice (summary + card)
  const matches = drawer.match(/lineProductionReadiness=\{drawerData\.lineProductionReadiness\}/g) || [];
  assert.ok(matches.length >= 2, `expected lineProductionReadiness passed to both the summary and the card, found ${matches.length} occurrences`);
});

test("the summary's navigation action switches to the existing 'readiness' tab via the existing setTab state setter - no new tab, no new route", () => {
  assert.match(drawer, /onViewReadiness=\{\(\) => setTab\('readiness'\)\}/);
});

test("fulfilment completeness is passed in from OrderDrawer's EXISTING getCourierRequirementGap()-derived shippingGapReason - the summary never imports or calls getCourierRequirementGap itself, and never computes its own shipping gap", () => {
  assert.match(drawer, /shippingGapReason=\{shippingGapReason\}/);
  // not imported anywhere (a code-level call without the import would be a
  // ReferenceError, and the build passes, so absence of the import is
  // sufficient proof nothing in this file calls it) - a mention in a prose
  // comment explaining where shippingGapReason comes from is fine.
  assert.doesNotMatch(summary, /import\s*\{[^}]*getCourierRequirementGap/);
  assert.doesNotMatch(summary, /shippingRequirements/);
});

test("the summary never reads or writes order.courier/pep_code/fulfillment_type directly - shippingGapReason is the only fulfilment signal it touches, and only for display", () => {
  assert.doesNotMatch(summary, /order\.courier/);
  assert.doesNotMatch(summary, /order\.pep_code/);
  assert.doesNotMatch(summary, /order\.fulfillment_type/);
});

test("the fulfilment note renders conditionally on shippingGapReason - collection orders (where the existing helper already returns null) show nothing, not an empty/misleading banner", () => {
  const match = summary.match(/\{shippingGapReason && \(/);
  assert.ok(match, "fulfilment note must be gated behind a truthy shippingGapReason check");
});

test("the summary introduces no new status gate - it never calls onUpdate/dataClient.entities.Order.update/any order-status mutation", () => {
  assert.doesNotMatch(summary, /onUpdate\(/);
  assert.doesNotMatch(summary, /Order\.update\(/);
  assert.doesNotMatch(summary, /\.update\(\{\s*status/);
  assert.doesNotMatch(summary, /useMutation/);
});

test("the summary respects a delivered/completed order: an unconfirmed historical production file gets an explicit 'historical, not a pending action' caption, never implying the order returns to production", () => {
  assert.match(summary, /TERMINAL_ORDER_STATUSES\s*=\s*\["delivered", "cancelled"\]/);
  assert.match(summary, /isTerminalOrder\s*=\s*TERMINAL_ORDER_STATUSES\.includes\(order\?\.status\)/);
  assert.match(summary, /historical\s+production file from before delivery, not a pending action/);
  // the caption is additive context only - it must not change the tile's own satisfied/unavailable verdict
  assert.doesNotMatch(summary, /productionFilesItem\.satisfied\s*=/); // never assigns/mutates the item
});

test("the historical-artwork caption only shows for a NOT-satisfied Production files fact on a terminal-status order - never implied for an in-progress order", () => {
  const match = summary.match(/showHistoricalArtworkNote\s*=\s*isTerminalOrder\s*&&\s*productionFilesItem\?\.satisfied\s*===\s*false/);
  assert.ok(match, "the caption condition must require both isTerminalOrder AND satisfied === false");
});

test("the summary reuses the shared AutomaticReadinessStrip component - it does not redefine its own tone/color logic", () => {
  assert.match(summary, /import AutomaticReadinessStrip from "@\/components\/orders\/AutomaticReadinessStrip"/);
  assert.match(summary, /<AutomaticReadinessStrip items=\{items\} order=\{order\} \/>/);
  assert.doesNotMatch(summary, /AUTOMATIC_READINESS_TONE/);
});

test("the summary never writes to order_production_readiness_checks (updateOrderProductionReadinessCheck) - it is read-only, same as the strip", () => {
  assert.doesNotMatch(summary, /updateOrderProductionReadinessCheck/);
});

test("Readiness tab still renders ProductionReadinessCard unchanged - same lazy import, same tab gate", () => {
  assert.match(drawer, /const ProductionReadinessCard = React\.lazy\(\(\) => import\("@\/components\/orders\/ProductionReadinessCard"\)\)/);
  assert.match(drawer, /\{tab === 'readiness' && \(/);
});

// ─────────────────────────────────────────────────────────────────────
// Pre-commit verification (final review) - traced every failure mode of
// useOrderAutomaticReadiness's three query groups by hand:
//   1. Still loading -> the hook's own .map guard forces
//      satisfied:null/unavailable:false (spinner) - verified below.
//   2. artworkReadinessQueries errors (the one path that genuinely
//      throws/propagates - getClientProductArtworkReadiness returns an
//      error string, the queryFn re-throws it) -> entry.readiness stays
//      undefined -> deriveProductionFilesFact's own
//      `!entry || entry.readiness == null` guard -> unavailable:true.
//      Already covered above ("the authority itself failed to load").
//   3. snapshotsQuery / productArtworkQueries silently degrade (the
//      app-wide dataClient.js convention: runSelect logs a warning and
//      falls back to cached/local data rather than rejecting - NOT
//      unique to this feature) -> orderArtworkByLine/revisionLookup
//      resolve empty -> deriveProductionFilesFact's own "zero tracked
//      lines" guard -> satisfied:false (amber), never satisfied:true.
// In every traced path the worst outcome is amber or grey - never a
// false green. This is the explicit, durable proof of that property.
// ─────────────────────────────────────────────────────────────────────

test("pre-commit verification: total fetch failure for a product (empty entries, empty snapshot grouping, empty revision lookup) NEVER produces satisfied=true for a product that requires placements", () => {
  const result = deriveProductionFilesFact({
    representedClientProductIds: ["jv1"],
    artworkReadinessEntries: [{ clientProductId: "jv1", readiness: { required_placements: ["Front (Chest)"] } }],
    orderArtworkByLine: {}, // as if snapshotsQuery silently degraded to []
    revisionLookup: {}, // as if productArtworkQueries silently degraded to []
  });
  assert.notEqual(result.satisfied, true, "a total fetch failure must never read as confirmed");
  assert.equal(result.satisfied, false); // the safe, non-premature direction: "not linked", not "unknown-but-shown-anyway"
});

test("pre-commit verification: the hook's own loading guard forces production_files to satisfied:null/unavailable:false while ANY of the three query groups is still loading - never satisfied:true mid-flight", () => {
  assert.match(
    hook,
    /productionFilesLoading\s*&&\s*item\.key === "production_files"\s*\n\s*\?\s*\{ \.\.\.item, satisfied: null, detail: null, unavailable: false \}/,
  );
  assert.match(hook, /const productionFilesLoading = artworkReadinessLoading \|\| snapshotsLoading \|\| productArtworkLoading;/);
});
