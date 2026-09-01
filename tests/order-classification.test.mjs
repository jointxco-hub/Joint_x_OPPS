import assert from "node:assert/strict";
import test from "node:test";
import { getOrderClassificationBadge } from "../src/lib/orderClassification.js";

// ─────────────────────────────────────────────────────────────────────
// XOS 2.7C — classification display helper. is_test and
// excluded_from_reports are independent booleans; this helper must
// handle all four combinations safely and never overbadge an ordinary
// real order (false/false).
// ─────────────────────────────────────────────────────────────────────

test("false/false (ordinary real order) - renders nothing", () => {
  assert.equal(getOrderClassificationBadge({ is_test: false, excluded_from_reports: false }), null);
  assert.equal(getOrderClassificationBadge({}), null);
  assert.equal(getOrderClassificationBadge(null), null);
  assert.equal(getOrderClassificationBadge(undefined), null);
});

test("is_test=true, excluded_from_reports=false - Test badge, still operationally visible per the label/title", () => {
  const badge = getOrderClassificationBadge({ is_test: true, excluded_from_reports: false });
  assert.equal(badge.key, "test");
  assert.equal(badge.label, "Test");
  assert.match(badge.title, /still counted operationally/i);
});

test("is_test=false, excluded_from_reports=true - Excluded badge", () => {
  const badge = getOrderClassificationBadge({ is_test: false, excluded_from_reports: true });
  assert.equal(badge.key, "excluded");
  assert.equal(badge.label, "Excluded");
});

test("is_test=true, excluded_from_reports=true - one compact combined badge, not two separate badges", () => {
  const badge = getOrderClassificationBadge({ is_test: true, excluded_from_reports: true });
  assert.equal(badge.key, "test-excluded");
  assert.equal(badge.label, "Test · Excluded");
});

test("tolerates truthy/falsy non-boolean values (e.g. values coming straight off a DB row) the same way as strict booleans", () => {
  assert.deepEqual(
    getOrderClassificationBadge({ is_test: 1, excluded_from_reports: 0 }),
    getOrderClassificationBadge({ is_test: true, excluded_from_reports: false })
  );
  assert.equal(getOrderClassificationBadge({ is_test: null, excluded_from_reports: null }), null);
});
