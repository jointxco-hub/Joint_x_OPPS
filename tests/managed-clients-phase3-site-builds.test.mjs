import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(relativePath) {
  const raw = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  return raw.replace(/\r\n/g, "\n");
}

const MIGRATION = "supabase/migrations/20260825090000_managed_clients_phase3_site_builds.sql";
const SQL_TEST_SUITE = "supabase/tests/managed_clients_phase3_site_builds.sql";
const PAGE = "src/pages/ManagedClients.jsx";
const TEMPLATES_PAGE = "src/pages/ManagedSiteTemplates.jsx";
const SECTION = "src/components/managedClients/SiteBuildSection.jsx";
const LAYOUT = "src/Layout.jsx";
const PAGES_CONFIG = "src/pages.config.js";

const PHASE3_RPCS = [
  { name: "admin_list_managed_site_templates", args: "" },
  { name: "admin_upsert_managed_site_template", args: "uuid, jsonb" },
  { name: "admin_archive_managed_site_template", args: "uuid" },
  { name: "admin_get_managed_site_build", args: "uuid" },
  { name: "admin_upsert_managed_site_build", args: "uuid, jsonb" },
  { name: "admin_generate_managed_site_build_brief", args: "uuid" },
  { name: "admin_get_managed_site_build_briefs", args: "uuid" },
];

// ─────────────────────────────────────────────────────────────────────
// Static source-inspection tests, matching the convention already used
// by tests/managed-clients-phase2-operations.test.mjs (this repo has no
// live-database/component test harness reachable from `node --test`).
// ─────────────────────────────────────────────────────────────────────

test("migration: every Phase 3 RPC gates on is_app_admin(), never is_opps_staff() alone", async () => {
  const source = await readSource(MIGRATION);
  for (const { name } of PHASE3_RPCS) {
    const fnMatch = source.match(new RegExp(`create function public\\.${name}\\([^)]*\\)[\\s\\S]*?\\$\\$;`));
    assert.ok(fnMatch, `expected to find create function public.${name}(...)`);
    assert.match(fnMatch[0], /if not public\.is_app_admin\(\) then/, `${name} must gate on is_app_admin()`);
  }
});

test("migration: every Phase 3 table has RLS enabled with no browser grants - authenticated only reaches data through the RPC surface", async () => {
  const source = await readSource(MIGRATION);
  for (const table of ["managed_site_templates", "managed_site_builds", "managed_site_build_briefs"]) {
    assert.match(source, new RegExp(`alter table public\\.${table} enable row level security;`));
    assert.match(source, new RegExp(`revoke all on public\\.${table} from authenticated;`));
    assert.ok(!new RegExp(`create policy[\\s\\S]{0,80}public\\.${table}`).test(source), `${table} must have zero RLS policies - SECURITY DEFINER RPCs only`);
  }
});

test("migration: managed_client_workspaces is never mutated by this file - the architectural boundary is respected", async () => {
  const source = await readSource(MIGRATION);
  assert.ok(!/update public\.managed_client_workspaces/i.test(source), "Phase 3 must never write to managed_client_workspaces - it is read-only from this migration's perspective");
  assert.ok(!/insert into public\.managed_client_workspaces/i.test(source));
});

test("migration: templates are archive-only - no delete RPC or DROP/DELETE FROM managed_site_templates is defined", async () => {
  const source = await readSource(MIGRATION);
  assert.ok(!/create function public\.admin_delete_managed_site_template/i.test(source));
  assert.ok(!/delete from public\.managed_site_templates/i.test(source));
});

test("migration: at most one non-archived site build per workspace is enforced by a partial unique index, not application logic alone", async () => {
  const source = await readSource(MIGRATION);
  assert.match(
    source,
    /create unique index managed_site_builds_one_active_per_workspace\s*\n\s*on public\.managed_site_builds \(workspace_id\)\s*\n\s*where status <> 'archived';/
  );
});

test("migration: template selection enforces both active-status and site-type compatibility before a build can reference it", async () => {
  const source = await readSource(MIGRATION);
  const fn = source.match(/create function public\.admin_upsert_managed_site_build[\s\S]*?\$\$;/)?.[0] ?? "";
  assert.match(fn, /SITE_BUILD_TEMPLATE_INVALID/, "must reject a non-existent or non-active template");
  assert.match(fn, /SITE_BUILD_TEMPLATE_SITE_TYPE_MISMATCH/, "must reject a template that does not support the workspace's site type");
});

test("migration: tenant/client/workspace identity is always server-resolved, never accepted as a browser-supplied id", async () => {
  const source = await readSource(MIGRATION);
  const buildFn = source.match(/create function public\.admin_upsert_managed_site_build\(p_tenant_id uuid, p_input jsonb\)[\s\S]*?\$\$;/)?.[0] ?? "";
  assert.ok(buildFn, "expected to find admin_upsert_managed_site_build with only (p_tenant_id, p_input)");
  assert.ok(!/p_client_id|p_workspace_id/.test(buildFn), "the RPC must not accept a client_id/workspace_id parameter at all");
  assert.match(buildFn, /_resolve_active_managed_workspace\(p_tenant_id\)/, "client/workspace must be resolved server-side from the tenant id");
});

test("migration: the brief generator re-verifies tenant/client/workspace agreement server-side before generating anything", async () => {
  const source = await readSource(MIGRATION);
  const fn = source.match(/create function public\.admin_generate_managed_site_build_brief[\s\S]*?\$\$;/)?.[0] ?? "";
  assert.match(fn, /SITE_BUILD_IDENTITY_MISMATCH/);
  assert.match(fn, /v_client\.tenant_id is distinct from v_build\.tenant_id/);
  assert.match(fn, /v_workspace\.tenant_id is distinct from v_build\.tenant_id/);
  assert.match(fn, /v_workspace\.client_id is distinct from v_build\.client_id/);
});

test("migration: staleness (admin_get_managed_site_build) and generation (admin_generate_managed_site_build_brief) both derive the fingerprint from the SAME shared snapshot helper - never two independently-maintained computations", async () => {
  const source = await readSource(MIGRATION);
  const getFn = source.match(/create function public\.admin_get_managed_site_build\(p_tenant_id uuid\)[\s\S]*?\$\$;/)?.[0] ?? "";
  const genFn = source.match(/create function public\.admin_generate_managed_site_build_brief[\s\S]*?\$\$;/)?.[0] ?? "";
  assert.match(getFn, /_compute_managed_site_build_snapshot\(/, "admin_get_managed_site_build must call the shared snapshot helper to detect staleness");
  assert.match(getFn, /brief_stale/);
  assert.match(genFn, /_compute_managed_site_build_snapshot\(/, "admin_generate_managed_site_build_brief must call the same shared snapshot helper");
});

test("migration: the brief never generates on a structurally blocked build, but missing CONTENT never blocks generation", async () => {
  const source = await readSource(MIGRATION);
  const readinessFn = source.match(/create function public\._managed_site_build_readiness[\s\S]*?\$\$;/)?.[0] ?? "";
  assert.match(readinessFn, /'blocked'/);
  assert.match(readinessFn, /'ready_with_missing_inputs'/);
  const genFn = source.match(/create function public\.admin_generate_managed_site_build_brief[\s\S]*?\$\$;/)?.[0] ?? "";
  assert.match(genFn, /if v_readiness ->> 'state' = 'blocked' then/, "generation must only be refused on a structural 'blocked' state");
});

test("migration: brief generation only ever bumps managed_site_builds.status draft -> brief_ready, and never touches onboarding_stage", async () => {
  const source = await readSource(MIGRATION);
  const genFn = source.match(/create function public\.admin_generate_managed_site_build_brief[\s\S]*?\$\$;/)?.[0] ?? "";
  assert.match(genFn, /if v_build\.status = 'draft' then\s*\n\s*update public\.managed_site_builds set status = 'brief_ready'/);
  // The function body legitimately explains in a comment WHY
  // onboarding_stage is never touched (documentation, not code) - so
  // this checks for an actual SQL statement referencing the column, not
  // a blanket string ban that would also flag that explanatory comment.
  assert.ok(!/\bonboarding_stage\s*=/.test(genFn), "brief generation must never assign managed_client_workspaces.onboarding_stage");
  assert.ok(!/update public\.managed_client_workspaces/i.test(genFn), "brief generation must never UPDATE managed_client_workspaces at all");
});

test("migration: brief versions are unique per (site_build_id, version) and a regeneration always computes the next version rather than overwriting", async () => {
  const source = await readSource(MIGRATION);
  assert.match(source, /unique \(site_build_id, version\)/);
  const genFn = source.match(/create function public\.admin_generate_managed_site_build_brief[\s\S]*?\$\$;/)?.[0] ?? "";
  assert.match(genFn, /select coalesce\(max\(version\), 0\) \+ 1 into v_next_version from public\.managed_site_build_briefs where site_build_id = v_build\.id;/);
});

test("migration: the safe Commerce snapshot never selects an internal-cost-shaped column - only the customer-facing catalog projection", async () => {
  const source = await readSource(MIGRATION);
  const snapshotFn = source.match(/create function public\._compute_managed_site_build_snapshot[\s\S]*?\$\$;/)?.[0] ?? "";
  assert.match(snapshotFn, /from commerce\.products p/);
  assert.ok(!/cost_price|supplier_price|internal_cost/i.test(snapshotFn), "must never select an internal/supplier cost column");
});

test("migration: no repository/Vercel/Supabase tokens or secret-shaped columns exist on the template registry", async () => {
  const source = await readSource(MIGRATION);
  const tableBlock = source.match(/create table public\.managed_site_templates \(([\s\S]*?)\);/)?.[1] ?? "";
  assert.ok(tableBlock, "expected to find the managed_site_templates column list");
  assert.ok(!/token|secret|password|service_role_key|api_key/i.test(tableBlock), "the template registry must never declare a secret-shaped column");
});

test("SQL test suite never uses GSB as a write fixture - the only calls targeting GSB are inside begin/exception blocks proving they are REJECTED, and every successful (assignment-form) call targets the disposable fixture", async () => {
  const source = await readSource(SQL_TEST_SUITE);
  assert.ok(source.includes("v_gsb_tenant_id"), "expected GSB's tenant id to be used for read-only/rejection-probe purposes");

  // "Successful" calls are the assignment-form ones (v_build :=, v_build2
  // :=) - these must always target the disposable fixture (v_tenant_id),
  // never GSB.
  const successfulCalls = source.match(/v_build2? := public\.admin_upsert_managed_site_build\(([^,]+),/g) || [];
  assert.ok(successfulCalls.length > 0, "expected at least one successful (assignment-form) admin_upsert_managed_site_build call");
  for (const call of successfulCalls) {
    assert.ok(call.includes("v_tenant_id") && !call.includes("v_gsb_tenant_id"), `every successful site-build write must target the disposable fixture tenant, not GSB: ${call}`);
  }

  // The only bare `perform ... admin_upsert_managed_site_build(v_gsb_tenant_id`
  // call must be wrapped in a begin/exception block expecting denial.
  const gsbProbeIdx = source.indexOf("admin_upsert_managed_site_build(v_gsb_tenant_id");
  assert.ok(gsbProbeIdx > -1, "expected the GSB-targeting probe call");
  const precedingLines = source.slice(0, gsbProbeIdx).split("\n").slice(-3).join("\n");
  assert.match(precedingLines, /^\s*begin\s*$/m, "the GSB-targeting call must be the first statement inside a begin/exception block, proving it is expected to fail, not silently succeed");
  const followingLines = source.slice(gsbProbeIdx, gsbProbeIdx + 400);
  assert.match(followingLines, /exception when others then/, "the GSB-targeting call's block must have an exception handler expecting denial");
});

// ─────────────────────────────────────────────────────────────────────
// Frontend
// ─────────────────────────────────────────────────────────────────────

test("SiteBuildSection: a modern tenant with no workspace shows the 'Set up workspace' prerequisite, not the build UI", async () => {
  const source = await readSource(SECTION);
  assert.match(source, /!hasWorkspace \? \(\s*\n\s*<p className="text-sm text-slate-500">Set up workspace before configuring the managed site build\.<\/p>/);
});

test("SiteBuildSection: workspace present but no build shows 'Configure site build', not the build summary", async () => {
  const source = await readSource(SECTION);
  assert.match(source, /!build \? \(/);
  assert.match(source, /No site build configured yet\./);
  assert.match(source, /<Button size="sm" onClick=\{\(\) => setConfigOpen\(true\)\}>Configure site build<\/Button>/);
});

test("SiteBuildSection: the template selector in BuildConfigDialog is populated from the registry RPC, and only active templates are offered", async () => {
  const source = await readSource(SECTION);
  assert.match(source, /adminListManagedSiteTemplates/);
  assert.match(source, /const activeTemplates = templates\.filter\(\(t\) => t\.status === "active"\);/, "archived templates must be filtered out of the selectable options");
});

test("SiteBuildSection: required pages/features/integrations use structured repeatable controls (TagListEditor), not one giant notes box", async () => {
  const source = await readSource(SECTION);
  assert.match(source, /<TagListEditor label="Required pages"/);
  assert.match(source, /<TagListEditor label="Required features"/);
  assert.match(source, /<TagListEditor label="Integrations"/);
  assert.match(source, /<TagListEditor label="Reference URLs"/);
  // Distinct notes fields must still exist separately - not merged into one box.
  for (const notesField of ["content_notes", "product_notes", "technical_notes", "deployment_notes"]) {
    assert.match(source, new RegExp(`value=\\{form\\.${notesField}\\}`));
  }
});

test("SiteBuildSection: Generate Build Brief calls the generator RPC and label switches to Regenerate once a brief exists", async () => {
  const source = await readSource(SECTION);
  assert.match(source, /adminGenerateManagedSiteBuildBrief/);
  assert.match(source, /\{generating \? "Generating\.\.\." : build\.latest_brief \? "Regenerate Build Brief" : "Generate Build Brief"\}/);
});

test("SiteBuildSection: View/Copy brief uses the versions RPC and a real clipboard write, and shows version + generated-at metadata", async () => {
  const source = await readSource(SECTION);
  assert.match(source, /adminGetManagedSiteBuildBriefs/);
  assert.match(source, /navigator\.clipboard\.writeText\(selected\.brief_text\)/);
  assert.match(source, /Copy Build Brief/);
  assert.match(source, /Version \{b\.version\}/);
});

test("SiteBuildSection: brief version and 'stale' state are both surfaced in the build summary", async () => {
  const source = await readSource(SECTION);
  assert.match(source, /build\.latest_brief\?\.version/);
  assert.match(source, /build\.brief_stale === true/);
  assert.match(source, /Build brief out of date/);
});

test("SiteBuildSection: no Deploy action, and no secret/env/token input field exists anywhere in the build UI", async () => {
  const source = await readSource(SECTION);
  // Strip only whole-line `//` comments and JSX `{/* ... */}` blocks
  // first - explanatory prose is allowed to mention why Vercel/deploy
  // integration does NOT exist yet; only actual code (JSX elements, prop
  // names, RPC calls) must never reference one. Deliberately NOT a
  // naive `//`-anywhere strip, which would also truncate an unrelated
  // "https://..." string literal (e.g. the reference-URL placeholder).
  const codeOnly = source
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  assert.ok(!/>Deploy</i.test(codeOnly), "no Deploy button/action may exist in Phase 3");
  assert.ok(!/vercel|deploy_token|env_var|secret|api[_-]?key/i.test(codeOnly), "no secret/env/Vercel input must exist in the site-build UI's actual code");
});

test("ManagedSiteTemplates page: Add/Edit/Archive actions exist, no Delete action, and no secret input fields", async () => {
  const source = await readSource(TEMPLATES_PAGE);
  assert.match(source, />\s*Add template<\/Button>/);
  assert.match(source, />Edit<\/Button>/);
  assert.match(source, />Archive<\/Button>/);
  assert.ok(!/>Delete</i.test(source), "no Delete action must exist - templates are archive-only");
  // Strip whole-line `//` comments first - the file's own header
  // legitimately explains that secrets are never stored here; only
  // actual code (an input/field for one) must never exist.
  const codeOnly = source.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
  assert.ok(!/token|secret|password|api[_-]?key/i.test(codeOnly), "no secret-shaped input must exist on the template form");
  assert.match(source, /No site templates configured yet\./, "an empty registry must say so explicitly, never show a fabricated template");
});

test("ManagedClients.jsx: SiteBuildSection is only rendered for modern tenants, mounted after workspace/site information", async () => {
  const source = await readSource(PAGE);
  assert.match(source, /\{isModern && <SiteBuildSection row=\{row\} \/>\}/);
  const workIdx = source.indexOf('<h3 className="font-semibold mb-3">Work</h3>');
  const siteBuildIdx = source.indexOf("<SiteBuildSection row={row} />");
  const xosIdx = source.indexOf('<h3 className="font-semibold">XOS</h3>');
  assert.ok(workIdx > -1 && siteBuildIdx > -1 && xosIdx > -1);
  assert.ok(workIdx < siteBuildIdx && siteBuildIdx < xosIdx, "Site Build must be mounted after Work/site information and before XOS");
});

test("Manage Site Templates nav entry and page registration exist and are admin-only", async () => {
  const layoutSource = await readSource(LAYOUT);
  assert.match(layoutSource, /\{\s*name:\s*"Manage Site Templates",\s*page:\s*"ManagedSiteTemplates",\s*icon:\s*LayoutTemplate,\s*adminOnly:\s*true\s*\}/);

  const pagesConfigSource = await readSource(PAGES_CONFIG);
  assert.match(pagesConfigSource, /"ManagedSiteTemplates":\s*ManagedSiteTemplates,/);
});

test("build-task checklist integration is deferred, not shipped as a fake/offline queue (Part M)", async () => {
  const sectionSource = await readSource(SECTION);
  // No task-creation call must exist anywhere in the Site Build UI in
  // this phase - the brief requires only Configure/Generate/Regenerate/
  // View/Copy actions to exist, per Part H's explicit action list.
  assert.ok(!/create.*task|task.*queue|View Tasks/i.test(sectionSource), "no build-task creation/queue UI may exist yet - deferred to Phase 3B per the task brief");
});
