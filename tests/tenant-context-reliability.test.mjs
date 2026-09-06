import assert from "node:assert/strict";
import test from "node:test";

import { createRetryableMemo } from "../src/lib/asyncMemo.js";
import { OP_ERROR_CODES, OpError, isOpError, createOpError } from "../src/lib/opError.js";
import {
  selectTenantFromMemberships,
  validateTenantChoice,
  isAuthorizedTenant,
  normalizeActiveMemberships,
} from "../src/lib/tenantSelection.js";
import { supabaseErrorMessage } from "../src/lib/supabaseErrorMessage.js";

// tenantContext.js itself imports @/lib/supabaseClient and can't run under
// `node --test` (same reason auth-identity.test.mjs tests authIdentity.js
// directly). Its behaviour is composed from the three pure pieces below —
// createRetryableMemo (single-flight, no rejection caching),
// selectTenantFromMemberships (fail-closed choice) and validateTenantChoice
// (switch validation) — each exercised here, then the wiring is verified
// in staging acceptance step B/C.

const MEMBERSHIP_A = { tenant_id: "tenant-A", tenants: { id: "tenant-A", slug: "acme", status: "active" } };
const MEMBERSHIP_B = { tenant_id: "tenant-B", tenants: { id: "tenant-B", slug: "beta", status: "active" } };

// ── A. transient membership-query failure does not poison later calls ──

test("A · a rejected resolution is NOT cached — the next call retries and succeeds without a reload", async () => {
  let calls = 0;
  const memo = createRetryableMemo(async () => {
    calls += 1;
    if (calls === 1) throw new Error("network blip on tenant_memberships");
    return { authUserId: "u1", memberships: [MEMBERSHIP_A] };
  });

  await assert.rejects(() => memo.get(), /network blip/);
  assert.equal(memo.peek(), undefined, "nothing cached after the failure");

  const ctx = await memo.get(); // simply calling again retries
  assert.deepEqual(ctx, { authUserId: "u1", memberships: [MEMBERSHIP_A] });
  assert.equal(calls, 2, "exactly one retry, no reload needed");

  // and it maps to a resolved tenant
  const { tenantId } = selectTenantFromMemberships({ memberships: ctx.memberships, savedTenantId: null });
  assert.equal(tenantId, "tenant-A");
});

test("A · the membership lookup failure surfaces as a retriable TENANT_CONTEXT_UNRESOLVED", () => {
  const err = createOpError({
    code: OP_ERROR_CODES.TENANT_CONTEXT_UNRESOLVED,
    operation: "resolve_tenant",
    technical: "tenant_memberships query failed: fetch failed",
  });
  assert.ok(isOpError(err));
  assert.equal(err.code, "TENANT_CONTEXT_UNRESOLVED");
  assert.equal(err.retriable, true);
  assert.ok(!/membership|tenant_memberships|fetch failed/i.test(err.userMessage), "no internal detail in the user copy");
});

// ── B. explicit tenant switch takes effect on the next resolution ─────

test("B · switching the saved selection + resetting the memo makes the next resolution the new tenant", async () => {
  let saved = "tenant-A";
  const memo = createRetryableMemo(async () => ({ authUserId: "u1", memberships: [MEMBERSHIP_A, MEMBERSHIP_B] }));

  const first = await memo.get();
  assert.equal(selectTenantFromMemberships({ memberships: first.memberships, savedTenantId: saved }).tenantId, "tenant-A");

  // setCurrentTenantId("tenant-B") does exactly this: validate, persist, reset
  validateTenantChoice({ memberships: first.memberships, tenantId: "tenant-B" });
  saved = "tenant-B";
  memo.reset();

  const second = await memo.get();
  assert.equal(
    selectTenantFromMemberships({ memberships: second.memberships, savedTenantId: saved }).tenantId,
    "tenant-B",
    "no stale tenant-A promise reused",
  );
});

test("B · switching to a tenant you are not a member of is rejected, not silently accepted", () => {
  assert.throws(
    () => validateTenantChoice({ memberships: [MEMBERSHIP_A], tenantId: "tenant-C" }),
    (e) => isOpError(e) && e.code === "NO_ACTIVE_TENANT",
  );
  assert.equal(isAuthorizedTenant([MEMBERSHIP_A], "tenant-A"), true);
  assert.equal(isAuthorizedTenant([MEMBERSHIP_A], "tenant-C"), false);
});

// ── C. a revoked saved tenant fails closed — never a silent switch ────

test("C · saved tenant no longer in active memberships ⇒ NO_ACTIVE_TENANT (no fallback to another tenant)", () => {
  assert.throws(
    () => selectTenantFromMemberships({ memberships: [MEMBERSHIP_B], savedTenantId: "tenant-A" }),
    (e) => isOpError(e) && e.code === "NO_ACTIVE_TENANT",
    "must NOT return tenant-B just because it happens to be active",
  );
});

test("C · zero active memberships ⇒ NO_ACTIVE_TENANT", () => {
  assert.throws(
    () => selectTenantFromMemberships({ memberships: [], savedTenantId: null }),
    (e) => isOpError(e) && e.code === "NO_ACTIVE_TENANT",
  );
  // an inactive tenant/membership does not count
  const inactive = { tenant_id: "t", tenants: { id: "t", status: "suspended" } };
  assert.throws(
    () => selectTenantFromMemberships({ memberships: [inactive], savedTenantId: null }),
    (e) => e.code === "NO_ACTIVE_TENANT",
  );
});

test("C · first run with NO saved selection adopts the first active membership and flags the write-back", () => {
  const out = selectTenantFromMemberships({ memberships: [MEMBERSHIP_A, MEMBERSHIP_B], savedTenantId: null });
  assert.deepEqual(out, { tenantId: "tenant-A", changedSelection: true });
});

test("C · a valid saved selection is used as-is (no write-back)", () => {
  const out = selectTenantFromMemberships({ memberships: [MEMBERSHIP_A, MEMBERSHIP_B], savedTenantId: "tenant-B" });
  assert.deepEqual(out, { tenantId: "tenant-B", changedSelection: false });
});

// ── D. auth sign-out / sign-in leaves the cache coherent ─────────────

test("D · reset() clears the cache so a different identity re-fetches", async () => {
  const identities = [
    { authUserId: "u1", memberships: [MEMBERSHIP_A] },
    { authUserId: "u2", memberships: [MEMBERSHIP_B] },
  ];
  let i = 0;
  const memo = createRetryableMemo(async () => identities[i]);

  assert.equal((await memo.get()).authUserId, "u1");
  assert.equal((await memo.get()).authUserId, "u1", "same identity is cached, not re-fetched");

  // onAuthStateChange('SIGNED_IN' | 'SIGNED_OUT' | 'INITIAL_SESSION') -> resetTenantContext()
  i = 1;
  memo.reset();
  assert.equal((await memo.get()).authUserId, "u2", "post-reset resolution is the new identity");
});

// ── E. concurrent callers share one in-flight promise; failure doesn't poison ──

test("E · concurrent get() calls share a single in-flight run", async () => {
  let calls = 0;
  const memo = createRetryableMemo(async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 10));
    return { authUserId: "u1", memberships: [MEMBERSHIP_A] };
  });

  const [a, b, c] = await Promise.all([memo.get(), memo.get(), memo.get()]);
  assert.equal(calls, 1, "one round trip for three concurrent callers");
  assert.equal(a, b);
  assert.equal(b, c);
});

test("E · a failed in-flight run rejects all waiters but does not poison the next call", async () => {
  let calls = 0;
  const memo = createRetryableMemo(async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 5));
    if (calls === 1) throw new Error("boom");
    return { authUserId: "u1", memberships: [MEMBERSHIP_A] };
  });

  const results = await Promise.allSettled([memo.get(), memo.get(), memo.get()]);
  assert.ok(results.every((r) => r.status === "rejected"), "every concurrent waiter sees the failure");
  assert.equal(calls, 1, "still just one shared attempt");

  const ok = await memo.get();
  assert.equal(ok.authUserId, "u1");
  assert.equal(calls, 2, "the next call retries cleanly");
});

// ── F. supabaseErrorMessage is generic — never points at purchase_orders ──

test("F · an Order failure never mentions purchase_orders", () => {
  const missing = supabaseErrorMessage({ message: 'relation "orders" does not exist' }, "Order");
  const rls = supabaseErrorMessage({ message: "new row violates row-level security policy for table \"orders\"" }, "Order");
  for (const m of [missing, rls]) {
    assert.ok(!/purchase_orders/i.test(m), `must not mention purchase_orders: ${m}`);
    assert.ok(!/INSERT policy for purchase_orders/i.test(m));
  }
  assert.ok(/order/i.test(missing) && /migration/i.test(missing), "still useful: names the entity + the likely cause");
  assert.ok(/permission|workspace/i.test(rls), "RLS message explains it as a permission/ownership issue");
});

test("F · a Client failure never mentions purchase_orders and stays useful", () => {
  const m = supabaseErrorMessage({ message: 'column clients.foo does not exist' }, "Client");
  assert.ok(!/purchase_orders/i.test(m));
  assert.ok(/client/i.test(m));
});

test("F · with no entity label the copy is still safe and generic", () => {
  const missing = supabaseErrorMessage({ message: "something does not exist" });
  const rls = supabaseErrorMessage({ message: "violates row-level security" });
  assert.ok(!/purchase_orders/i.test(missing + rls));
  assert.ok(/this record/i.test(missing), "falls back to a neutral subject");
  assert.ok(/permission|workspace/i.test(rls));
});

test("F · a plain error string passes straight through", () => {
  assert.equal(supabaseErrorMessage("boom"), "boom");
  assert.equal(supabaseErrorMessage(null), "Unknown error");
});

// ── opError shape ───────────────────────────────────────────────────

test("OpError carries { code, operation, retriable, userMessage, technical } and hides technical from users", () => {
  const e = new OpError({
    code: OP_ERROR_CODES.NO_ACTIVE_TENANT,
    operation: "order_update",
    technical: "saved tenant selection is not in the current active memberships",
  });
  assert.equal(e.code, "NO_ACTIVE_TENANT");
  assert.equal(e.operation, "order_update");
  assert.equal(e.retriable, false);
  assert.ok(e.userMessage && !/membership/i.test(e.userMessage));
  assert.equal(e.technical, "saved tenant selection is not in the current active memberships");
  assert.deepEqual(Object.keys(e.toJSON()).sort(), ["code", "operation", "retriable", "technical", "userMessage"]);
});

test("normalizeActiveMemberships keeps only active tenant + active membership rows", () => {
  const rows = [
    MEMBERSHIP_A,
    { tenant_id: "t2", status: "invited", tenants: { id: "t2", status: "active" } },
    { tenant_id: "t3", status: "active", tenants: { id: "t3", status: "suspended" } },
    { tenant_id: null, tenants: { status: "active" } },
  ];
  assert.deepEqual(
    normalizeActiveMemberships(rows).map((m) => m.tenantId),
    ["tenant-A"],
  );
});
