import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(relativePath) {
  const raw = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  return raw.replace(/\r\n/g, "\n");
}

const PAGE = "src/pages/ManagedClients.jsx";

// ─────────────────────────────────────────────────────────────────────
// Static source-inspection tests, matching the convention already used
// by tests/managed-clients-control-plane.test.mjs and
// tests/managed-clients-phase2/3 suites (this repo has no live-database/
// component test harness reachable from `node --test`).
//
// Fixes browser-acceptance feedback found after intentionally
// initializing GSB's first real modern workspace: row.source === "both"
// means the projection carries BOTH a modern tenant identity AND a
// managed_client_workspaces record - it does NOT mean that workspace is
// historical/legacy. "Legacy" must only ever describe
// row.source === "legacy" (a client never migrated to its own dedicated
// tenant), never merely "a managed_client_workspaces row exists".
// ─────────────────────────────────────────────────────────────────────

test("detail dialog: source=legacy shows the legacy-migration warning copy", async () => {
  const source = await readSource(PAGE);
  assert.match(
    source,
    /row\.source === "legacy"\s*\n\s*\?\s*"Legacy workspace record - not yet migrated to a dedicated XOS tenant\."/,
    "a genuinely legacy-only row (never migrated to its own tenant) must still show the legacy-migration warning"
  );
});

test("detail dialog: source=both says 'configured workspace', never implies the workspace itself is legacy/historical", async () => {
  const source = await readSource(PAGE);
  assert.match(
    source,
    /: row\.source === "both"\s*\n\s*\?\s*"Modern managed tenant with a configured workspace\."/,
    "source='both' means a modern tenant WITH a workspace record - the copy must say so plainly, not describe the workspace as legacy/linked/historical"
  );
  // Isolate just the ternary expression (not the whole file) before
  // asserting "legacy" is absent - the file legitimately uses the word
  // elsewhere (the actual legacy branch, doc comments, etc.); this test
  // only guards that the 'both' branch's own string never contains it.
  const bothBranch = source.match(/: row\.source === "both"\s*\n\s*\?\s*"([^"]*)"/)?.[1] ?? "";
  assert.ok(bothBranch, "expected to find the 'both' branch's copy string");
  assert.ok(!/legacy/i.test(bothBranch), `the 'both' branch copy must never use the word "legacy": "${bothBranch}"`);
});

test("detail dialog: source=modern (no workspace yet) says 'workspace not configured yet', not a legacy claim", async () => {
  const source = await readSource(PAGE);
  assert.match(
    source,
    /: "Modern managed tenant - workspace not configured yet\."/,
    "the fallback (source==='modern') branch must describe workspace absence plainly, without any legacy/historical framing"
  );
});

test("managed-brand card badge never calls an existing OR absent modern workspace 'legacy'", async () => {
  const source = await readSource(PAGE);
  const badgeMatch = source.match(
    /\{row\.workspace_id \? \(row\.site_status \|\| "([^"]*)"\) : "([^"]*)"\}/
  );
  assert.ok(badgeMatch, "expected to find the workspace badge's conditional text");
  const [, presentFallback, absentText] = badgeMatch;
  assert.equal(presentFallback, "Workspace configured", "when a workspace exists but has no site_status, the badge must say 'Workspace configured', not imply tracking/legacy status");
  assert.equal(absentText, "Workspace not configured", "when no workspace exists, the badge must say 'Workspace not configured' - workspace absence is not evidence of legacy status either");
  assert.ok(!/legacy/i.test(presentFallback) && !/legacy/i.test(absentText), "neither badge state may use the word 'legacy' - workspace presence/absence alone never proves legacy status");
});

test("Site Build eligibility (isModern) is untouched by the terminology fix", async () => {
  const source = await readSource(PAGE);
  assert.match(
    source,
    /const isModern = row\.source === "modern" \|\| row\.source === "both";/,
    "isModern must still be derived identically from row.source - this fix only changes copy, never eligibility logic"
  );
  assert.match(source, /\{isModern && <SiteBuildSection row=\{row\} \/>\}/, "Site Build must still be gated behind the same isModern check");
});

test("Commerce and XOS activation controls are untouched by the terminology fix", async () => {
  const source = await readSource(PAGE);
  assert.match(
    source,
    /function isCommerceEligible\(row\)\s*\{\s*return Boolean\(row\.tenant_id\)\s*&&\s*\(row\.source === "modern" \|\| row\.source === "both"\);\s*\}/,
    "Commerce eligibility logic must be byte-for-byte unchanged"
  );
  assert.match(source, /\{isModern && <XosActivationCard row=\{row\} \/>\}/, "XOS activation card gating must be unchanged");
  assert.match(source, /\{isModern && <ProductsCapabilityCard row=\{row\} \/>\}/, "Products capability card gating must be unchanged");
});
