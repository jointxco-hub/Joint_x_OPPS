import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeOpsTaskForViews,
  normalizeLegacyTaskForOpsViews,
  toEntityTaskPayload,
} from "../src/lib/taskAdapters.js";

// src/lib/taskAdapters.js is pure/Supabase-free by design, same reasoning
// as the other Phase 2B identity tests. Covers the Task <-> OpsTask merge
// layer's Phase 2B additions: normalizing both entities' auth-id shape
// into one array for the UI, and converting back to each entity's real
// column shape (single vs array) on save, dual-writing id + email.

test("normalizeLegacyTaskForOpsViews: single assigned_auth_user_id becomes a one-element array", () => {
  const view = normalizeLegacyTaskForOpsViews({
    id: "t1",
    assigned_to: "amy@example.com",
    assigned_auth_user_id: "auth-1",
  });
  assert.deepEqual(view.assigned_auth_user_ids, ["auth-1"]);
});

test("normalizeLegacyTaskForOpsViews: missing assigned_auth_user_id becomes an empty array, not [undefined]", () => {
  const view = normalizeLegacyTaskForOpsViews({ id: "t1", assigned_to: "amy@example.com" });
  assert.deepEqual(view.assigned_auth_user_ids, []);
});

test("normalizeOpsTaskForViews: array assigned_auth_user_ids passes through, nulls filtered", () => {
  const view = normalizeOpsTaskForViews({
    id: "o1",
    assigned_to: ["amy@example.com", "ben@example.com"],
    assigned_auth_user_ids: ["auth-1", null, "auth-2"],
  });
  assert.deepEqual(view.assigned_auth_user_ids, ["auth-1", "auth-2"]);
});

test("toEntityTaskPayload (Task): collapses the array back to a single assigned_auth_user_id and dual-writes with legacy email", () => {
  const task = normalizeLegacyTaskForOpsViews({
    id: "t1",
    assigned_to: "amy@example.com",
    assigned_auth_user_id: "auth-1",
  });
  const payload = toEntityTaskPayload(task, {});
  assert.equal(payload.assigned_to, "amy@example.com");
  assert.equal(payload.assigned_auth_user_id, "auth-1");
});

test("toEntityTaskPayload (Task): a patch changing the assignee updates both id and email together", () => {
  const task = normalizeLegacyTaskForOpsViews({
    id: "t1",
    assigned_to: "amy@example.com",
    assigned_auth_user_id: "auth-1",
  });
  const payload = toEntityTaskPayload(task, {
    assigned_to: ["ben@example.com"],
    assigned_auth_user_ids: ["auth-2"],
  });
  assert.equal(payload.assigned_to, "ben@example.com");
  assert.equal(payload.assigned_auth_user_id, "auth-2");
});

test("toEntityTaskPayload (OpsTask): array assigned_auth_user_ids passes through unchanged", () => {
  const task = normalizeOpsTaskForViews({
    id: "o1",
    assigned_to: ["amy@example.com"],
    assigned_auth_user_ids: ["auth-1"],
  });
  const payload = toEntityTaskPayload(task, { assigned_auth_user_ids: ["auth-1", "auth-2"] });
  assert.deepEqual(payload.assigned_auth_user_ids, ["auth-1", "auth-2"]);
});

test("toEntityTaskPayload (Task): no assignee resolves to undefined, not null or empty string, so it's omitted rather than clearing the column", () => {
  const task = normalizeLegacyTaskForOpsViews({ id: "t1" });
  const payload = toEntityTaskPayload(task, {});
  assert.equal(payload.assigned_auth_user_id, undefined);
});
