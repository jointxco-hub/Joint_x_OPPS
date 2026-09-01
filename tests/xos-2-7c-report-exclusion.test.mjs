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

// ─────────────────────────────────────────────────────────────────────
// Reconciliation follow-up (closing the two gaps a repo-wide search found
// after the original 2.7C + Blocker 1/2 correction landed): the executive
// "Finance Insights" outstanding-balance card and a per-project Finance
// tab both aggregated straight off raw orders, with no excluded_from_
// reports exclusion at all - a QA/test order with a fake balance could
// inflate both. Fixed with the same excluded_from_reports-only switch
// (never is_test alone) used everywhere else in this feature.
// ─────────────────────────────────────────────────────────────────────

test("FinanceInsights.jsx: outstandingOrders excludes excluded_from_reports rows, and does NOT filter on is_test (A/B/C: a normal order and an is_test=true/excluded=false order both still contribute; only excluded=true is zeroed out)", async () => {
  const source = await readSource("src/components/executive/FinanceInsights.jsx");
  const start = source.indexOf("const outstandingOrders = orders.filter(o =>");
  const filterExpr = source.slice(start, source.indexOf(");", start));
  assert.ok(filterExpr.includes("!o.excluded_from_reports"), "must exclude excluded_from_reports=true rows");
  assert.ok(!filterExpr.includes("is_test"), "must NOT filter on is_test - a test-but-not-excluded order still counts");
  // Pre-existing conditions (is_archived, status, positive balance) must
  // survive unchanged alongside the new exclusion.
  assert.ok(filterExpr.includes("!o.is_archived"));
  assert.ok(filterExpr.includes('!["cancelled", "delivered"].includes(o.status)'));
  assert.ok(filterExpr.includes("(o.total_amount || 0) - (o.deposit_paid || 0) > 0"));
});

test("FinanceInsights.jsx: both the outstanding order count and the outstanding total derive from the SAME already-filtered outstandingOrders array, so an excluded order contributes zero to both, never just one", async () => {
  const source = await readSource("src/components/executive/FinanceInsights.jsx");
  assert.match(source, /if \(outstandingOrders\.length > 0\) \{\s*\n\s*const outstandingTotal = outstandingOrders\.reduce\(/);
});

test("FinanceInsights.jsx (D): every other insight (test transactions, no expenses, uncategorised, courier/bank fee gaps, revenue trend, expense spike, pending approvals) is untouched by this fix", async () => {
  const source = await readSource("src/components/executive/FinanceInsights.jsx");
  const unrelatedFragments = [
    'const testTxCount = [...payments, ...expenses].filter(t => t.is_test).length;',
    'if (totalRevenue > 0 && totalExpenses === 0) {',
    'const uncatCount = activeExpenses.filter(e => !e.expense_category && !e.category).length +',
    '!expenseCategories.has("shipping") && !expenseCategories.has("courier_delivery")',
    '!expenseCategories.has("bank_fees") && !expenseCategories.has("bank_payment_fees")',
    'if (thisMonthExp > thisMonthRev && thisMonthRev > 0) {',
    'const pendingExpenses = activeExpenses.filter(e => e.approval_status === "submitted");',
  ];
  for (const fragment of unrelatedFragments) {
    assert.ok(source.includes(fragment), `unrelated insight logic must be byte-for-byte unchanged: ${fragment}`);
  }
});

test("ProjectHub.jsx FinanceTab: totals derive from a separately-filtered projectOrders subset that excludes excluded_from_reports, not is_test (E/F/G: a normal order and an is_test=true/excluded=false order both still contribute; only excluded=true contributes zero)", async () => {
  const source = await readSource("src/pages/ProjectHub.jsx");
  const start = source.indexOf("function FinanceTab({ project, orders }) {");
  const body = source.slice(start, source.indexOf("\n  return (", start));
  assert.ok(body.includes("const projectOrders = orders.filter(o => !o.excluded_from_reports);"));
  // Scoped to the filter expression's own line, not the whole function
  // body - the explanatory comment above it legitimately says "is_test"
  // in prose.
  const filterLine = body.slice(body.indexOf("const projectOrders"), body.indexOf(";", body.indexOf("const projectOrders")) + 1);
  assert.ok(!filterLine.includes("is_test"), "must NOT filter on is_test - a test-but-not-excluded order still counts");
  assert.ok(body.includes("projectOrders.reduce((sum, o) => sum + (o.quoted_price || 0), 0)"));
  assert.ok(body.includes("projectOrders.reduce((sum, o) => sum + (o.deposit_paid || 0), 0)"));
  // Must not still be reducing off the raw, unfiltered `orders`.
  assert.ok(!body.includes("orders.reduce((sum, o) => sum + (o.quoted_price"));
  assert.ok(!body.includes("orders.reduce((sum, o) => sum + (o.deposit_paid"));
});

test("ProjectHub.jsx (H): OverviewTab and OrdersTab still receive the raw, unfiltered `orders` - an excluded project order stays internally inspectable outside the Finance tab, only the finance math itself is filtered", async () => {
  const source = await readSource("src/pages/ProjectHub.jsx");
  assert.ok(source.includes("<OverviewTab project={project} orders={orders} tasks={tasks} />"));
  assert.ok(source.includes("<OrdersTab orders={orders} projectId={projectId} clientName={project.client_name} />"));
  assert.ok(source.includes("<FinanceTab project={project} orders={orders} />"), "FinanceTab still receives the raw set - filtering happens inside it, not at the fetch/prop level, so nothing else regresses");
});

// ─────────────────────────────────────────────────────────────────────
// Final closeout gap: Projects.jsx's project-card health derivation
// (Blocked/Healthy) and its "{N} orders" count both ran off the raw,
// unfiltered project-order relationship - an excluded QA/proof order
// could mark a real project Blocked, make it read as operationally
// "healthy", or inflate the shown count. Fixed with the same
// excluded_from_reports-only operational subset used everywhere else in
// this feature; the raw relationship (getProjectOrders) is untouched.
// ─────────────────────────────────────────────────────────────────────

test("Projects.jsx (A/B/C): getOperationalProjectOrders excludes excluded_from_reports rows and does NOT filter on is_test - a normal order and an is_test=true/excluded=false order both still contribute, only excluded=true contributes zero", async () => {
  const source = await readSource("src/pages/Projects.jsx");
  const start = source.indexOf("const getOperationalProjectOrders = (projectId) =>");
  const line = source.slice(start, source.indexOf(";", start) + 1);
  assert.ok(line.includes("getProjectOrders(projectId).filter((o) => !o.excluded_from_reports)"));
  assert.ok(!line.includes("is_test"), "must NOT filter on is_test - a test-but-not-excluded order still counts");
});

test("Projects.jsx: getProjectOrders itself (the raw project-order relationship) is unchanged - still returns every project-linked order with no excluded_from_reports filter", async () => {
  const source = await readSource("src/pages/Projects.jsx");
  assert.ok(source.includes('const getProjectOrders = (projectId) =>\n    orders.filter((o) => o.project_id === projectId);'));
});

test("Projects.jsx (D): getProjectHealth's blockedOrders derives from the operational subset, not the raw project-order list, so an excluded stuck/blocked order cannot mark a real project Blocked", async () => {
  const source = await readSource("src/pages/Projects.jsx");
  const start = source.indexOf("const getProjectHealth = (project) => {");
  const body = source.slice(start, source.indexOf("\n  };", start));
  assert.ok(body.includes("const operationalOrders = getOperationalProjectOrders(project.id);"));
  assert.ok(body.includes('const blockedOrders = operationalOrders.filter(\n      (o) => o.stuck_reason && o.stuck_reason !== "none"\n    );'));
});

test("Projects.jsx (E): the in_production health check derives from the operational subset, so an excluded in_production order cannot make a project read as operationally healthy", async () => {
  const source = await readSource("src/pages/Projects.jsx");
  assert.ok(source.includes('if (operationalOrders.some((o) => o.status === "in_production")) return "healthy";'));
});

test("Projects.jsx: the project-card order count uses the operational subset, not the raw project-order list", async () => {
  const source = await readSource("src/pages/Projects.jsx");
  const cardStart = source.indexOf("const operationalOrders = getOperationalProjectOrders(project.id);", source.indexOf("filteredProjects.map"));
  assert.ok(cardStart > -1, "expected the render loop to compute operationalOrders per project card");
  assert.ok(source.includes("{operationalOrders.length} orders"));
});

test("Projects.jsx (F): the raw, unfiltered order relationship remains available for internal inspection - ProjectHub's own orders query is a separate, untouched fetch (see the ProjectHub.jsx (H) test above), and getProjectOrders itself is never removed from this file", async () => {
  const source = await readSource("src/pages/Projects.jsx");
  assert.match(source, /const getProjectOrders = \(projectId\) =>\s*\n\s*orders\.filter\(\(o\) => o\.project_id === projectId\);/);
});
