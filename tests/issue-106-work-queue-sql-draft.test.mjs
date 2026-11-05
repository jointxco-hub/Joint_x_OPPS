import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(new URL("../docs/ISSUE_106_WORK_QUEUE_RPC_DRAFT.sql", import.meta.url), "utf8");

test("server checks identity, tenant membership capability and module state", () => {
  assert.match(sql, /auth\.uid\(\) is null/);
  assert.match(sql, /t\.slug = 'quick-solution'/);
  assert.match(sql, /has_tenant_capability\(v_tenant_id, 'cafe\.counter\.operate'\) is distinct from true/);
  assert.match(sql, /tc\.capability_key = 'quick_solution'/);
  assert.match(sql, /tc\.enabled = true/);
});

test("server limits both source branches to the resolved Cafe tenant", () => {
  assert.match(sql, /from public\.orders o\s+where o\.tenant_id = v_tenant_id/);
  assert.match(sql, /from public\.opps_invoices i\s+where i\.tenant_id = v_tenant_id/);
  assert.doesNotMatch(sql, /p_tenant_id/);
});

test("server uses no payment writes and exposes minimal projections", () => {
  assert.doesNotMatch(sql, /\b(insert\s+into|update\s+public\.|delete\s+from|commerce\.service_order_payments|raw_itn|share_token)\b/i);
  assert.match(sql, /'balanceDue', null, 'reviewRequired', true/);
  assert.match(sql, /i\.status in \('draft','void'\)/);
});

test("server uses bounded keyset pagination and a restricted function ACL", () => {
  assert.match(sql, /p_limit > 50/);
  assert.match(sql, /\(r\.sort_at,r\.kind,r\.id\) < \(v_at,v_type,v_id\)/);
  assert.match(sql, /limit p_limit \+ 1/);
  assert.match(sql, /security definer\s+set search_path = ''/);
  assert.match(sql, /revoke all on function public\.qs_cafe_list_work_queue\(text,integer\)/);
  assert.match(sql, /grant execute on function public\.qs_cafe_list_work_queue\(text,integer\)\s+to authenticated/);
});
