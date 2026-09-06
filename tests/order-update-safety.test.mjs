import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { OP_ERROR_CODES, isOpError } from "../src/lib/opError.js";
import {
  performCheckedUpdate,
  classifySupabaseWriteError,
  describeCheckedUpdateError,
} from "../src/lib/checkedUpdate.js";

// ── a configurable fake supabase client ─────────────────────────────────
// Supports the two chains checkedUpdate.js uses:
//   from(t).update(p).eq(...).eq(...).select('*')          -> updateResult
//   from(t).select('id, updated_at, tenant_id').eq('id',x).maybeSingle() -> probeResult
// `updateResult` / `probeResult` may be an object {data,error} or a
// function (filters) => {data,error}.
function makeClient({ updateResult, probeResult } = {}) {
  const calls = { updates: [], probes: [] };
  const client = {
    calls,
    from(table) {
      const filters = {};
      let patch;
      let mode = null;
      const api = {
        update(p) {
          mode = "update";
          patch = p;
          return api;
        },
        eq(k, v) {
          filters[k] = v;
          return api;
        },
        select() {
          if (mode === "update") {
            calls.updates.push({ table, patch, filters: { ...filters } });
            const r = typeof updateResult === "function"
              ? updateResult({ filters: { ...filters }, patch })
              : updateResult;
            return Promise.resolve(r || { data: [], error: null });
          }
          mode = "select";
          return api;
        },
        maybeSingle() {
          calls.probes.push({ table, filters: { ...filters } });
          const r = typeof probeResult === "function" ? probeResult({ ...filters }) : probeResult;
          return Promise.resolve(r || { data: null, error: null });
        },
      };
      return api;
    },
  };
  return client;
}

const ROW_T2 = { id: "o1", updated_at: "2026-02-02T00:00:00Z", tenant_id: "tenant-A", status: "in_production" };

// ── A. healthy update ──────────────────────────────────────────────────

test("A · a 1-row update returns the row", async () => {
  const client = makeClient({ updateResult: { data: [ROW_T2], error: null } });
  const row = await performCheckedUpdate({
    client, table: "orders", id: "o1", patch: { status: "in_production" },
    tenantId: "tenant-A", expectedUpdatedAt: "2026-02-01T00:00:00Z", operation: "order_update",
  });
  assert.deepEqual(row, ROW_T2);
  assert.equal(client.calls.updates.length, 1);
  assert.equal(client.calls.updates[0].filters.tenant_id, "tenant-A", "tenant scope applied");
  assert.equal(client.calls.updates[0].filters.updated_at, "2026-02-01T00:00:00Z", "version guard applied");
  assert.equal(client.calls.probes.length, 0, "no diagnostic probe on success");
});

// ── B. 0 rows because updated_at moved -> STALE ────────────────────────

test("B · 0 rows + probe shows a newer updated_at => ENTITY_STALE_VERSION", async () => {
  const client = makeClient({
    updateResult: { data: [], error: null },
    probeResult: { data: { id: "o1", updated_at: "2026-02-02T00:00:00Z", tenant_id: "tenant-A" }, error: null },
  });
  await assert.rejects(
    () => performCheckedUpdate({
      client, table: "orders", id: "o1", patch: { status: "ready" },
      tenantId: "tenant-A", expectedUpdatedAt: "2026-02-01T00:00:00Z",
    }),
    (e) => isOpError(e) && e.code === OP_ERROR_CODES.ENTITY_STALE_VERSION,
  );
  const d = describeCheckedUpdateError(
    Object.assign(new Error(), { name: "OpError", code: OP_ERROR_CODES.ENTITY_STALE_VERSION }),
    { entityNoun: "order" },
  );
  assert.match(d.message, /updated elsewhere\. Reload it before saving/i);
  assert.equal(d.retriable, false);
  assert.equal(d.shouldRefetch, true);
});

// ── C. 0 rows because not visible / wrong tenant -> NOT_VISIBLE ────────

test("C · 0 rows + probe returns another tenant's row => ENTITY_UPDATE_NOT_VISIBLE", async () => {
  const client = makeClient({
    updateResult: { data: [], error: null },
    probeResult: { data: { id: "o1", updated_at: "2026-02-01T00:00:00Z", tenant_id: "tenant-B" }, error: null },
  });
  await assert.rejects(
    () => performCheckedUpdate({ client, table: "orders", id: "o1", patch: {}, tenantId: "tenant-A", expectedUpdatedAt: "2026-02-01T00:00:00Z" }),
    (e) => e.code === OP_ERROR_CODES.ENTITY_UPDATE_NOT_VISIBLE,
  );
});

test("C · 0 rows + probe finds nothing (RLS-invisible / not found) => ENTITY_UPDATE_NOT_VISIBLE", async () => {
  const client = makeClient({ updateResult: { data: [], error: null }, probeResult: { data: null, error: null } });
  await assert.rejects(
    () => performCheckedUpdate({ client, table: "orders", id: "o1", patch: {}, tenantId: "tenant-A" }),
    (e) => e.code === OP_ERROR_CODES.ENTITY_UPDATE_NOT_VISIBLE,
  );
});

test("C · 0 rows on a visible, in-tenant, version-matching row => NOT_VISIBLE (likely UPDATE-RLS denial, never a false STALE)", async () => {
  const client = makeClient({
    updateResult: { data: [], error: null },
    probeResult: { data: { id: "o1", updated_at: "2026-02-01T00:00:00Z", tenant_id: "tenant-A" }, error: null },
  });
  await assert.rejects(
    () => performCheckedUpdate({ client, table: "orders", id: "o1", patch: {}, tenantId: "tenant-A", expectedUpdatedAt: "2026-02-01T00:00:00Z" }),
    (e) => e.code === OP_ERROR_CODES.ENTITY_UPDATE_NOT_VISIBLE,
  );
});

// ── D. tenant missing -> fail before any DB write ──────────────────────

test("D · dataClient.runUpdate resolves + requires the tenant BEFORE performCheckedUpdate", async () => {
  const src = (await readFile(new URL("../src/api/dataClient.js", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  // resolveTenantForWrite throws typed NO_ACTIVE_TENANT / TENANT_CONTEXT_UNRESOLVED
  assert.match(src, /function resolveTenantForWrite/);
  assert.match(src, /OP_ERROR_CODES\.NO_ACTIVE_TENANT/);
  assert.match(src, /OP_ERROR_CODES\.TENANT_CONTEXT_UNRESOLVED/);
  // and runUpdate calls it for tenant-scoped entities before the checked update
  const runUpdate = src.slice(src.indexOf("async function runUpdate("));
  const resolveIdx = runUpdate.indexOf("resolveTenantForWrite(operation)");
  const performIdx = runUpdate.indexOf("performCheckedUpdate({");
  assert.ok(resolveIdx > -1 && performIdx > -1 && resolveIdx < performIdx,
    "tenant is resolved before the DB write is attempted");
  assert.match(runUpdate.slice(0, performIdx), /if \(entityConfig\.tenantScoped\)\s*\{\s*tenantId = await resolveTenantForWrite/s);
  // the old silent-drop pattern is gone
  assert.doesNotMatch(runUpdate.slice(0, performIdx), /if \(tenantId\) query = query\.eq\('tenant_id'/);
});

// ── E. >1 rows defensive check ────────────────────────────────────────

test("E · >1 rows updated => ENTITY_UPDATE_AMBIGUOUS", async () => {
  const client = makeClient({ updateResult: { data: [{ id: "o1" }, { id: "o1" }], error: null } });
  await assert.rejects(
    () => performCheckedUpdate({ client, table: "orders", id: "o1", patch: {}, tenantId: "tenant-A" }),
    (e) => e.code === OP_ERROR_CODES.ENTITY_UPDATE_AMBIGUOUS,
  );
});

// ── F. network / 5xx errors are retriable ─────────────────────────────

test("F · transport failures classify as NETWORK (retriable), non-network as not retriable", async () => {
  for (const err of [
    { message: "TypeError: Failed to fetch" },
    { message: "NetworkError when attempting to fetch resource." },
    { code: "503" },
    { status: 502 },
    { message: "upstream request timeout" },
  ]) {
    const e = classifySupabaseWriteError(err, { operation: "order_update" });
    assert.equal(e.code, OP_ERROR_CODES.NETWORK, `${JSON.stringify(err)} -> NETWORK`);
    assert.equal(e.retriable, true);
    assert.equal(describeCheckedUpdateError(e).message, "Connection problem. Try again.");
  }
  const rls = classifySupabaseWriteError({ code: "42501", message: 'new row violates row-level security policy for table "orders"' });
  assert.equal(rls.code, OP_ERROR_CODES.ENTITY_UPDATE_NOT_VISIBLE);
  assert.equal(rls.retriable, false);

  const other = classifySupabaseWriteError({ code: "23514", message: "check constraint" }, { entityLabel: "Order" });
  assert.equal(other.code, OP_ERROR_CODES.ENTITY_UPDATE_FAILED);
  assert.equal(other.retriable, false);

  const propagated = classifySupabaseWriteError(
    Object.assign(new Error("x"), { name: "OpError", code: OP_ERROR_CODES.NO_ACTIVE_TENANT }),
  );
  assert.equal(propagated.code, OP_ERROR_CODES.NO_ACTIVE_TENANT, "an OpError passes straight through");
});

// ── G. two-tab concurrency: stale writer is rejected, no overwrite ────

test("G · tab A saves; tab B saves a stale copy -> tab B gets ENTITY_STALE_VERSION and never overwrites", async () => {
  // shared server state
  let row = { id: "o1", updated_at: "T1", tenant_id: "tenant-A", status: "confirmed" };

  const client = makeClient({
    updateResult: ({ filters, patch }) => {
      const { updated_at, tenant_id } = filters;
      if (tenant_id !== row.tenant_id) return { data: [], error: null };
      if (updated_at != null && updated_at !== row.updated_at) return { data: [], error: null }; // stale -> 0 rows
      row = { ...row, ...patch, updated_at: row.updated_at === "T1" ? "T2" : "T3" };
      return { data: [row], error: null };
    },
    probeResult: () => ({ data: { id: row.id, updated_at: row.updated_at, tenant_id: row.tenant_id }, error: null }),
  });

  // Tab A: had version T1, saves
  const a = await performCheckedUpdate({
    client, table: "orders", id: "o1", patch: { status: "in_production" },
    tenantId: "tenant-A", expectedUpdatedAt: "T1",
  });
  assert.equal(a.updated_at, "T2", "tab A wins; server moved to T2");

  // Tab B: still thinks it's T1
  await assert.rejects(
    () => performCheckedUpdate({
      client, table: "orders", id: "o1", patch: { status: "ready" },
      tenantId: "tenant-A", expectedUpdatedAt: "T1",
    }),
    (e) => e.code === OP_ERROR_CODES.ENTITY_STALE_VERSION,
  );
  assert.equal(row.status, "in_production", "tab B's 'ready' was NOT written");
  assert.equal(row.updated_at, "T2", "server version unchanged by the rejected write");
});

// ── UI mapping + copy safety ──────────────────────────────────────────

test("describeCheckedUpdateError never leaks RLS/policy/id detail and gives safe copy", () => {
  const cases = [
    [OP_ERROR_CODES.ENTITY_STALE_VERSION, /updated elsewhere/i, false, true],
    [OP_ERROR_CODES.ENTITY_UPDATE_NOT_VISIBLE, /another workspace|no longer have access/i, false, true],
    [OP_ERROR_CODES.ENTITY_UPDATE_AMBIGUOUS, /could not be updated safely/i, false, true],
    [OP_ERROR_CODES.NETWORK, /connection problem/i, true, false],
  ];
  for (const [code, re, retriable, refetch] of cases) {
    const d = describeCheckedUpdateError({ name: "OpError", code }, { entityNoun: "order" });
    assert.match(d.message, re);
    assert.equal(d.retriable, retriable);
    assert.equal(d.shouldRefetch, refetch);
    assert.doesNotMatch(d.message, /row-level security|policy|tenant_id|PGRST|42501|updated_at/i);
  }
});

test("NO_ACTIVE_TENANT / TENANT_CONTEXT_UNRESOLVED surface their OpError userMessage", () => {
  const na = describeCheckedUpdateError({ name: "OpError", code: OP_ERROR_CODES.NO_ACTIVE_TENANT, userMessage: "Your account isn't linked to an active workspace.", retriable: false });
  assert.match(na.message, /active workspace/i);
  assert.equal(na.retriable, false);
  const tu = describeCheckedUpdateError({ name: "OpError", code: OP_ERROR_CODES.TENANT_CONTEXT_UNRESOLVED, userMessage: "We couldn't confirm your workspace just now. Please try again.", retriable: true });
  assert.equal(tu.retriable, true);
});

// ── call-site wiring (source assertions) ─────────────────────────────

test("Order call sites: drawer + kanban + PipelineStrip pass expectedUpdatedAt; ExceptionFlag + OrderLinker deliberately do not", async () => {
  const read = async (p) => (await readFile(new URL(`../${p}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");

  const orders = await read("src/pages/Orders.jsx");
  assert.match(orders, /Order\.update\(id, data, \{ expectedUpdatedAt \}\)/, "mutation forwards the version");
  assert.match(orders, /current\?\.updated_at \?\? current\?\.updated_date/, "drawer edits derive the version from the drawer row");
  assert.match(orders, /updateMutation\.isPending\s*\n?\s*\?\s*null/, "the version guard is skipped while our own save is still in flight");
  assert.match(orders, /expectedUpdatedAt: dragged\?\.updated_at \?\? dragged\?\.updated_date/, "kanban drag passes the dragged row version");
  assert.match(orders, /describeCheckedUpdateError\(err, \{ entityNoun: "order" \}\)/, "typed error -> safe copy");
  assert.doesNotMatch(orders, /Failed to update order — please try again/, "the blind generic toast is gone");

  const strip = await read("src/components/orders/PipelineStrip.jsx");
  assert.match(strip, /expectedUpdatedAt: order\.updated_at \?\? order\.updated_date/);
  assert.match(strip, /describeCheckedUpdateError/);

  const exc = await read("src/components/orders/ExceptionFlag.jsx");
  assert.doesNotMatch(exc, /\bexpectedUpdatedAt:/, "escalation action passes no version option");
  assert.match(exc, /describeCheckedUpdateError/);

  const linker = await read("src/components/projects/OrderLinker.jsx");
  assert.doesNotMatch(linker, /\bexpectedUpdatedAt:/, "bulk-list screen passes no version option");
  assert.match(linker, /describeCheckedUpdateError/);
});

test("runUpdate no longer uses .single() and returns the normalized checked-update row", async () => {
  const src = (await readFile(new URL("../src/api/dataClient.js", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  const runUpdate = src.slice(src.indexOf("async function runUpdate("), src.indexOf("async function runStaffUpdate("));
  assert.doesNotMatch(runUpdate, /\.select\('\*'\)\.single\(\)/, "the 0-or-many-row PGRST116 trap is removed");
  assert.match(runUpdate, /await performCheckedUpdate\(\{/);
  assert.match(runUpdate, /return entityConfig\.normalize\(row\)/);
  assert.match(runUpdate, /const opErr = isOpError\(err\)\s*\?\s*err\s*:\s*classifySupabaseWriteError/);
});
