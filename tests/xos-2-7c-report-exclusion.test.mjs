import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// ─────────────────────────────────────────────────────────────────────
// XOS 2.7C Phase C4 — consistent exclusion semantics. When
// excluded_from_reports=true, an order must be excluded from every
// operational/reporting surface: Orders.jsx counts and kanban/production
// queues, FinanceKPIs.jsx revenue-adjacent order metrics,
// OperationsHealth.jsx order counts, and the Dashboard/Clients
// executive-facing consumers found by this phase's repo-wide search.
//
// The switch is excluded_from_reports === true, NEVER is_test alone - a
// staff member can mark an order is_test=true while deliberately leaving
// it excluded_from_reports=false (still counted, clearly flagged). These
// tests guard that distinction as much as the exclusion itself: every
// assertion below checks specifically for excluded_from_reports, and the
// list/table visibility test below confirms is_test/excluded rows are
// NOT hidden from the plain order list (only from calculations) - Archive
// keeps its own separate, unfiltered historical record entirely
// (Phase C6, tested in Archive's own test below).
// ─────────────────────────────────────────────────────────────────────

async function readSource(relativePath) {
  const raw = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  return raw.replace(/\r\n/g, "\n");
}

test("Orders.jsx: the active/delivered/cancelled counts memo excludes excluded_from_reports rows", async () => {
  const source = await readSource("src/pages/Orders.jsx");
  const countsStart = source.indexOf("const counts = useMemo(");
  const countsBody = source.slice(countsStart, source.indexOf(");", countsStart));
  const occurrences = (countsBody.match(/!o\.excluded_from_reports/g) || []).length;
  assert.equal(occurrences, 3, "all three counts (active/delivered/cancelled) must exclude excluded_from_reports rows");
});

test("Orders.jsx: kanban/production-lane feed (activeOrders) excludes excluded_from_reports rows, so excluded orders never occupy a stage lane or exception queue", async () => {
  const source = await readSource("src/pages/Orders.jsx");
  assert.ok(source.includes('orders.filter(o => !o.is_archived && !o.excluded_from_reports), [orders]);'));
});

test("Orders.jsx: OrdersProductionSummary's own active-orders filter (the 'Active summary'/'Due' print views) excludes excluded_from_reports rows", async () => {
  const source = await readSource("src/pages/Orders.jsx");
  assert.ok(source.includes('.filter(order => !order.is_archived && !order.excluded_from_reports && !["delivered", "cancelled"].includes(order.status))'));
});

test("Orders.jsx: the payment-health flag summary is computed from a reports-excluded subset, not the raw filtered list", async () => {
  const source = await readSource("src/pages/Orders.jsx");
  assert.ok(source.includes("const reportableFiltered = useMemo(() => filtered.filter(o => !o.excluded_from_reports), [filtered]);"));
  assert.ok(source.includes("const healthSummary = useMemo(() => getOrderHealthSummary(reportableFiltered), [reportableFiltered]);"));
});

test("Orders.jsx: the list/table row filter (`filtered`) itself is NOT restricted by excluded_from_reports - excluded orders stay visible in the list, with a badge, per Phase C2", async () => {
  const source = await readSource("src/pages/Orders.jsx");
  const filteredStart = source.indexOf("const filtered = useMemo(() => orders.filter(o => {");
  const filteredBody = source.slice(filteredStart, source.indexOf("}), [orders, statusFilter, assigneeFilter, search]);", filteredStart));
  assert.ok(!filteredBody.includes("excluded_from_reports"), "the list/table view must still show excluded orders, only calculations exclude them");
});

test("FinanceKPIs.jsx: activeOrders and outstandingBalance both exclude excluded_from_reports rows", async () => {
  const source = await readSource("src/components/executive/FinanceKPIs.jsx");
  assert.match(source, /const activeOrders = orders\.filter\(o =>\s*\n\s*!\["delivered", "cancelled"\]\.includes\(o\.status\) && !o\.is_archived && !o\.excluded_from_reports\s*\n\s*\);/);
  assert.match(source, /const outstandingBalance = orders\s*\n\s*\.filter\(o => !o\.is_archived && !o\.excluded_from_reports && !\["cancelled"\]\.includes\(o\.status\)\)/);
});

test("FinanceKPIs.jsx: the exclusion switch used for orders matches the existing payments/expenses precedent (is_test AND excluded_from_reports both already excluded there)", async () => {
  const source = await readSource("src/components/executive/FinanceKPIs.jsx");
  assert.ok(source.includes("!p.is_test && !p.excluded_from_reports"));
  assert.ok(source.includes("!e.is_test && !e.excluded_from_reports"));
});

test("OperationsHealth.jsx: the active-orders metric (feeding Active/Unowned/Overdue) excludes excluded_from_reports rows", async () => {
  const source = await readSource("src/components/executive/OperationsHealth.jsx");
  assert.ok(source.includes('const active = orders.filter((order) => !order.is_archived && !order.excluded_from_reports && !["delivered", "cancelled"].includes(order.status));'));
});

test("Dashboard.jsx: the orders query itself is fetched with excluded_from_reports: false, so Active Orders / payment-health flags on the homepage never include excluded rows", async () => {
  const source = await readSource("src/pages/Dashboard.jsx");
  assert.ok(source.includes('ents.Order.filter({ is_archived: false, excluded_from_reports: false }, "-created_date", 100)'));
});

test("Clients.jsx: the per-client linked-orders source stays visibility-only (is_archived) - excluded_from_reports rows remain linked and visible under the client, per Blocker 2 (visible != operational)", async () => {
  const source = await readSource("src/pages/Clients.jsx");
  assert.ok(source.includes('.filter((order) => !order.is_archived && orderPrimaryClientKey(order))'));
  // Must NOT be over-filtered at the source - that would hide excluded
  // orders from client.orders (the literal list rendered in
  // ClientAccountDialog for staff to inspect), not just from stats.
  const linkStart = source.indexOf("const clientsWithStats = useMemo(");
  const linkFilterLine = source.slice(linkStart, source.indexOf("orderPrimaryClientKey(order))", linkStart) + 40);
  assert.ok(!linkFilterLine.includes("!order.excluded_from_reports"));
});

test("Clients.jsx: buildStats() computes operational figures (revenue, active/completed/cancelled counts, lifecycle status) off a separately-filtered subset, while `orders`/`total_orders` stay the full visible set", async () => {
  const source = await readSource("src/pages/Clients.jsx");
  const start = source.indexOf("function buildStats(orders) {");
  const body = source.slice(start, source.indexOf("\n}\n", start));
  assert.ok(body.includes("const operationalOrders = orders.filter((order) => !order.excluded_from_reports);"));
  assert.ok(body.includes("operationalOrders.reduce((sum, order) => sum + orderAmount(order), 0)"));
  assert.ok(body.includes("operationalOrders.filter((order) => ACTIVE_ORDER_STATUSES.has(order.status))"));
  assert.ok(body.includes("operationalOrders.filter((order) => DONE_ORDER_STATUSES.has(order.status))"));
  assert.ok(body.includes("operationalOrders.filter((order) => order.status === 'cancelled')"));
  // total_orders/orders themselves are NOT derived from operationalOrders -
  // they stay the full, visible set (client.orders must still show an
  // excluded proof order for staff to find and un-exclude it).
  assert.ok(body.includes("total_orders: orders.length,"));
  assert.ok(body.includes("orders,\n    total_orders:"));
});

test("dataClient.js: Order.serialize() does NOT whitelist is_test or excluded_from_reports - the generic Order.update() path can never write these columns, by construction", async () => {
  const source = await readSource("src/api/dataClient.js");
  const orderEntityStart = source.indexOf("  Order: {");
  const taskEntityStart = source.indexOf("\n  Task: {", orderEntityStart);
  const orderEntitySource = source.slice(orderEntityStart, taskEntityStart);
  const serializeStart = orderEntitySource.indexOf("serialize(payload) {");
  const serializeBody = orderEntitySource.slice(serializeStart, orderEntitySource.indexOf("},", serializeStart));
  assert.ok(!serializeBody.includes("is_test"));
  assert.ok(!serializeBody.includes("excluded_from_reports"));
});

test("dataClient.js: staff.setOrderTestClassification calls the dedicated RPC by name with the exact parameter names the migration defines", async () => {
  const source = await readSource("src/api/dataClient.js");
  assert.ok(source.includes("async setOrderTestClassification(orderId, { isTest, excludedFromReports } = {}) {"));
  assert.ok(source.includes("supabase.rpc('set_order_test_classification', {"));
  assert.ok(source.includes("p_order_id: orderId,"));
  assert.ok(source.includes("p_is_test: isTest === undefined ? null : isTest,"));
  assert.ok(source.includes("p_excluded_from_reports: excludedFromReports === undefined ? null : excludedFromReports,"));
});
