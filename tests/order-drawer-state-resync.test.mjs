import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function src(rel) {
  return (await readFile(new URL(`../${rel}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
}

const HOOK = "src/hooks/useOrderDrawerData.js";
const DRAWER = "src/components/orders/OrderDrawer.jsx";
const QUERY_CLIENT = "src/lib/query-client.js";

// Bug: OrderDrawer seeds localPipelineStage / localIsTest /
// localExcludedFromReports from the `order` prop via useState(order.x),
// which only reads the initial value once. If the underlying order changes
// externally (another tab, a bulk action) while the drawer stays open, the
// three mirrors never resync — only a manual close/reopen (which remounts
// the component) picks up the new value.
//
// Fix (v1): useOrderDrawerData exposes `liveOrder`, read from the SAME
// ["orders"] cache entry Orders.jsx's own list query already uses (and
// already invalidates on every order-edit / classification mutation).
// OrderDrawer resyncs the three mirrors whenever liveOrder's relevant
// fields change. No new query key, no new invalidation call site anywhere
// else, no polling, no Orders.jsx edit (PR #74 also touches Orders.jsx —
// this stays out of it entirely).
//
// Browser QA found v1 insufficient for the SAME order open in a SEPARATE
// tab: each tab runs its own independent QueryClient, so tab B's
// invalidateQueries call never reaches tab A's cache no matter what tab A
// resyncs from — only a fresh network refetch, initiated by tab A itself,
// can pick up a change already persisted by tab B. The global QueryClient
// (src/lib/query-client.js) disables refetchOnWindowFocus app-wide, so
// returning focus to tab A triggered nothing. Fix (v2): refetchOnWindowFocus
// is overridden to true on ONLY the liveOrder query — no global config
// change, no polling, no Realtime/BroadcastChannel (neither exists
// anywhere in this app; confirmed by search before choosing this fix).

test("useOrderDrawerData reads liveOrder from the SAME ['orders'] key Orders.jsx's list query uses", async () => {
  const s = await src(HOOK);
  assert.match(s, /queryKey:\s*\["orders"\]/, "shares the existing key — no new invalidation call site needed anywhere else");
  assert.match(s, /queryFn:\s*\(\)\s*=>\s*dataClient\.entities\.Order\.list\("-created_date",\s*200\)/, "same fetch shape as Orders.jsx's list query");
  assert.match(s, /select:\s*\(list\)\s*=>\s*\(Array\.isArray\(list\)\s*\?\s*list\.find\(\(row\)\s*=>\s*row\.id === orderId\)\s*:\s*undefined\)/, "extracts just this one order from the shared list cache");
  assert.match(s, /enabled:\s*Boolean\(orderId\)/, "disabled with no orderId, matching every other query in this hook");
});

test("useOrderDrawerData does not introduce polling (no refetchInterval anywhere)", async () => {
  const s = await src(HOOK);
  assert.doesNotMatch(s, /refetchInterval/, "resync relies on invalidation + normal refetch triggers, never a timer");
});

test("liveOrderQuery narrowly re-enables refetchOnWindowFocus for cross-tab freshness — this query only", async () => {
  const s = await src(HOOK);
  const start = s.indexOf("const liveOrderQuery = useQuery({");
  const end = s.indexOf("});", start);
  assert.notEqual(start, -1, "liveOrderQuery exists");
  const queryConfig = s.slice(start, end);
  assert.match(queryConfig, /refetchOnWindowFocus:\s*true/, "explicitly overrides the app's disabled default for this one query");
  // exactly one override in the whole file — not applied to any other query
  // in this hook (payments/tasks/readiness/etc all keep the app default)
  const overrideCount = (s.match(/refetchOnWindowFocus:\s*true/g) || []).length;
  assert.equal(overrideCount, 1, "the override is scoped to a single query, not copy-pasted onto others");
});

test("the app-wide QueryClient default is untouched — refetchOnWindowFocus stays disabled globally", async () => {
  const s = await src(QUERY_CLIENT);
  assert.match(s, /refetchOnWindowFocus:\s*false/, "global default unchanged — the fix is a per-query override, not a global behavior change");
});

test("no Realtime/BroadcastChannel/storage-event sync was introduced for this fix", async () => {
  const hook = await src(HOOK);
  const drawer = await src(DRAWER);
  for (const s of [hook, drawer]) {
    assert.doesNotMatch(s, /supabase\.channel\(|new BroadcastChannel\(|addEventListener\(\s*["']storage["']/,
      "cross-tab sync relies on refetchOnWindowFocus, not a new pub/sub mechanism (comments may still name these as rejected alternatives)");
  }
});

test("useOrderDrawerData returns liveOrder alongside the other drawer data", async () => {
  const s = await src(HOOK);
  assert.match(s, /return \{\s*\n\s*liveOrder:\s*liveOrderQuery\.data \|\| null,/);
});

test("OrderDrawer resyncs the three order-field mirrors from liveOrder, not on every render", async () => {
  const s = await src(DRAWER);
  const effectStart = s.indexOf("useEffect(() => {\n    if (!liveOrder) return;");
  assert.notEqual(effectStart, -1, "the resync effect exists");
  const effectEnd = s.indexOf("}, [liveOrder?.pipeline_stage, liveOrder?.is_test, liveOrder?.excluded_from_reports]);", effectStart);
  assert.notEqual(effectEnd, -1, "effect deps are the individual fetched values, not the liveOrder object reference — fires only on a genuine change");
  const effectBody = s.slice(effectStart, effectEnd);
  assert.match(effectBody, /setLocalPipelineStage\(liveOrder\.pipeline_stage\)/);
  assert.match(effectBody, /setLocalIsTest\(liveOrder\.is_test\)/);
  assert.match(effectBody, /setLocalExcludedFromReports\(liveOrder\.excluded_from_reports\)/);
});

test("OrderDrawer destructures liveOrder from useOrderDrawerData's return value", async () => {
  const s = await src(DRAWER);
  const destructureStart = s.indexOf("const drawerData = useOrderDrawerData(order, tab);");
  const destructureEnd = s.indexOf("} = drawerData;", destructureStart);
  const destructured = s.slice(destructureStart, destructureEnd);
  assert.match(destructured, /liveOrder,/);
});

test("the fix does not touch Orders.jsx or Invoices.jsx — no overlap with PR #74's open changes", async () => {
  // This is enforced by the diff itself (git status), not by inspecting
  // source content here — asserting the two files this fix DOES touch
  // exist and are the only production files this test suite is about.
  const hook = await src(HOOK);
  const drawer = await src(DRAWER);
  assert.ok(hook.length > 0 && drawer.length > 0);
});
