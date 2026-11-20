import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/api/cafeWorkQueue.js", import.meta.url), "utf8");

test("work queue calls a dedicated read RPC and normalizes the response", () => {
  assert.match(source, /supabase\.rpc\("qs_cafe_list_work_queue"/);
  assert.match(source, /return normalizeWorkQueue\(data\)/);
});

test("work queue cannot pass a browser-selected tenant or payment amount", () => {
  assert.doesNotMatch(source, /p_tenant_id|p_amount|p_balance|p_paid|p_order_id/);
  assert.match(source, /p_cursor: cursor/);
  assert.match(source, /p_limit: limit/);
});

test("pagination inputs are validated before RPC invocation", () => {
  assert.match(source, /Number\.isInteger\(limit\)/);
  assert.match(source, /limit > 50/);
  assert.match(source, /cursor\.length > 512/);
});
