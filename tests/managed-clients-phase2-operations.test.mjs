import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  EMPTY_WORKSPACE_FORM,
  diffWorkspaceForm,
  fingerprintPreviewInput,
} from "../src/lib/managedClientForms.js";

async function readSource(relativePath) {
  const raw = await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
  return raw.replace(/\r\n/g, "\n");
}

const MIGRATION = "supabase/migrations/20260824090000_managed_clients_phase2_operations.sql";
const LAYOUT = "src/Layout.jsx";
const PAGE = "src/pages/ManagedClients.jsx";
const OPERATIONS = "src/components/managedClients/ManagedClientOperations.jsx";
const SQL_TEST_SUITE = "supabase/tests/managed_clients_phase2_operations.sql";
const FORMS_LIB = "src/lib/managedClientForms.js";

// src/lib/managedClientForms.js is pure/React-free/Supabase-free (see its
// header comment), so diffWorkspaceForm and fingerprintPreviewInput are
// exercised directly here (behavioral), matching the convention already
// used by tests/order-primary-image.test.mjs for src/lib/orderPrimaryImage.js.

// ─────────────────────────────────────────────────────────────────────
// Static source-inspection tests, matching the pattern already used by
// tests/client-products-source-identity-uniqueness.test.mjs and
// tests/managed-clients-control-plane.test.mjs (this repo has no live-
// database test harness reachable from `node --test`). These guard the
// Phase 2 migration/frontend's committed shape - not a live re-execution.
// ─────────────────────────────────────────────────────────────────────

test("Managed Clients nav item still requires adminOnly (Phase 2 does not loosen Phase 0/1's nav gate)", async () => {
  const source = await readSource(LAYOUT);
  assert.match(
    source,
    /\{\s*name:\s*"Managed Clients",\s*page:\s*"ManagedClients",\s*icon:\s*Rocket,\s*adminOnly:\s*true\s*\}/,
    "the Managed Clients nav entry must keep adminOnly: true"
  );
});

test("legacy rows never render Commerce onboarding, even after Phase 2's workspace-editing additions", async () => {
  const source = await readSource(PAGE);
  assert.match(
    source,
    /function isCommerceEligible\(row\)\s*\{\s*return Boolean\(row\.tenant_id\)\s*&&\s*\(row\.source === "modern" \|\| row\.source === "both"\);\s*\}/,
    "Commerce eligibility must still require row.tenant_id AND source in ('modern','both')"
  );
  assert.match(source, /isCommerceEligible\(row\)\s*\?\s*\(\s*row\.client_id && <CommerceProductsSection/, "CommerceProductsSection must still be gated behind isCommerceEligible(row)");
});

test("a legacy-only row gets an Edit Workspace button but no XOS/products capability controls", async () => {
  const source = await readSource(PAGE);
  // [\s\S]*? (not [^>]*) because the button's own onClick handler
  // contains an arrow function "() =>", whose ">" would otherwise
  // terminate a naive [^>]* character class before the JSX tag's real
  // closing ">".
  assert.match(source, /\(isLegacyOnly \|\| hasWorkspace\) && \(\s*<Button[\s\S]*?>Edit Workspace<\/Button>/, "legacy (and any workspace-having) row must expose Edit Workspace");
  assert.match(source, /Legacy tenant reconciliation is a separate migration phase/, "legacy rows must show the explicit deferral message");
  // XosActivationCard/ProductsCapabilityCard must only render for modern
  // rows (isModern), never unconditionally - the legacy detail view has
  // no rendering path that reaches either.
  assert.match(source, /\{isModern && <XosActivationCard row=\{row\} \/>\}/);
  assert.match(source, /\{isModern && <ProductsCapabilityCard row=\{row\} \/>\}/);
});

test("a modern-only row (no workspace) shows Set up workspace, not Edit Workspace", async () => {
  const source = await readSource(PAGE);
  assert.match(
    source,
    /isModern && !hasWorkspace && \(\s*<Button[\s\S]*?>Set up workspace<\/Button>/,
    "a modern tenant with no workspace_id must show Set up workspace"
  );
});

test("WorkspaceFormDialog picks mode from hasWorkspace, not from a hardcoded value", async () => {
  const source = await readSource(PAGE);
  assert.match(source, /mode=\{hasWorkspace \? "edit" : "init"\}/);
});

test("the provisioning wizard never accepts an arbitrary hostname from the browser - only tenant_slug, hostname is always server-derived", async () => {
  const source = await readSource(OPERATIONS);
  assert.ok(!/hostname:\s*workspace\./.test(source), "the wizard must never send a hostname field to the provisioning RPC");
  assert.ok(!/p_input\.hostname/.test(source));
  // The preview/provision inputs only ever pass tenant_slug - the RPC
  // itself derives hostname (see the migration's own admin_preview/
  // admin_provision functions), the browser has no hostname field.
  assert.match(source, /tenant_slug:\s*workspace\.tenant_slug/);
});

test("pending XOS status is never presented as live - the activation card only renders a live badge for status === 'active'", async () => {
  const source = await readSource(OPERATIONS);
  assert.match(source, /if \(row\.xos_status === "active"\)\s*\{/, "XosActivationCard must special-case only the active status as live");
  assert.match(source, /XOS live at \{row\.xos_hostname\}/);
});

test("XOS activation requires the explicit confirmation checkbox to be checked before the Activate button is enabled", async () => {
  const source = await readSource(OPERATIONS);
  assert.match(source, /disabled=\{!confirmed \|\| activating\}\s*onClick=\{handleActivate\}/, "XosActivationCard's Activate button must be disabled until confirmed");
  assert.match(source, /I confirm this hostname is attached to the correct Vercel project\./);
});

test("the Add Managed Brand wizard's provision step is gated behind a CURRENT, can_provision preflight, and step 5 (external activation) requires its own confirmation before activating", async () => {
  const source = await readSource(OPERATIONS);
  // Post-review (blocker): gating on preflight?.can_provision alone was
  // insufficient - an operator could edit brand/slug/email/contact after
  // a successful preflight and still reach Provision describing the OLD
  // reviewed payload. canAdvanceFromPreflight additionally requires the
  // preflight's stored fingerprint to still match the CURRENT form state.
  assert.match(source, /const canAdvanceFromPreflight = preflightIsCurrent && preflight\?\.can_provision === true;/);
  assert.match(source, /disabled=\{provisioning \|\| !canAdvanceFromPreflight\}/, "provisioning must be disabled unless the preflight is both successful AND current");
  assert.match(source, /disabled=\{!confirmed \|\| activating\}\s*onClick=\{handleActivate\}/, "the wizard's own external-activation step must also require confirmation");
  // Steps 5 (provision) and 6 (external activation) must never be
  // triggered from the same handler - handleProvision only ever advances
  // to step 5 (index 5 = "External activation") and stops; activation is
  // a separate handler (handleActivate) requiring its own button click.
  assert.match(source, /setStep\(5\);\s*\}\s*finally/, "handleProvision must stop at step 5, not auto-activate");
});

test("stale preflight invalidates automatically (item 4): editing any preflight-relevant field after a successful preflight changes the fingerprint used to gate Review/Provision", async () => {
  const source = await readSource(OPERATIONS);
  assert.match(source, /import \{[\s\S]*?fingerprintPreviewInput,?[\s\S]*?\} from "@\/lib\/managedClientForms";/, "the wizard must import the shared fingerprint helper, not duplicate its own");
  assert.match(source, /const currentFingerprint = useMemo\(\(\) => fingerprintPreviewInput\(previewInput\), \[previewInput\]\);/, "the current fingerprint must be re-derived from live form state on every render");
  assert.match(source, /const preflightIsCurrent = Boolean\(preflight\) && preflightFingerprint === currentFingerprint;/, "staleness must be a direct comparison against the fingerprint stored at the last successful preflight");
  assert.match(source, /setPreflightFingerprint\(fingerprintPreviewInput\(previewInput\)\);/, "a successful preflight must record the fingerprint of the exact input it was run against");
});

test("Review cannot be reached with a stale preflight (item 4): the Next button at the preflight step is disabled unless the preflight is current", async () => {
  const source = await readSource(OPERATIONS);
  assert.match(
    source,
    /\(step === 2 && !canAdvanceFromPreflight\)/,
    "advancing from the Owner/Preflight step (index 2) to Review must be blocked unless canAdvanceFromPreflight is true"
  );
  assert.match(source, /preflight && !preflightIsCurrent && \(/, "the UI must visibly warn the operator when a preflight is stale, not just silently block Next");
});

test("owner-account-required state is shown verbatim when the preflight finds no matching auth account", async () => {
  const source = await readSource(OPERATIONS);
  assert.match(source, /Owner account required/);
  assert.match(source, /The owner must sign in\/create their XOS account with this exact email before the workspace can be provisioned\./);
});

test("the wizard's idempotency key is generated exactly once via a lazy useState initializer, matching the CommerceProductsSection convention", async () => {
  const source = await readSource(OPERATIONS);
  const match = source.match(/const \[idempotencyKey\] = useState\(\(\) => \(([\s\S]*?)\)\);/);
  assert.ok(match, "expected a lazy useState(() => ...) initializer for idempotencyKey");
  assert.match(match[1], /crypto\.randomUUID/);
});

test("capability toggle only calls admin_set_managed_tenant_products_capability - it never references commerce.products or a product-deletion call client-side", async () => {
  const source = await readSource(OPERATIONS);
  const cardBody = source.match(/export function ProductsCapabilityCard\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(cardBody, "expected to find ProductsCapabilityCard's body");
  assert.match(cardBody, /adminSetManagedTenantProductsCapability/);
  assert.ok(!/commerce\.products/i.test(cardBody));
  // Scoped to an actual deletion CALL (e.g. .delete(, deleteProduct(),
  // removeProduct() as identifiers) - not a blanket word ban, since the
  // component's own reassuring help text legitimately says "does not
  // delete or alter any existing Commerce product".
  assert.ok(!/\.delete\(|deleteProduct|removeProduct/i.test(cardBody), "the capability toggle must never call a product deletion function");
});

test("workspace form only ever assembles the allowlisted operational fields - never an identity field (tenant_id/client_id/id/created_at) - and its field count matches the migration's allowlist exactly", async () => {
  const forbiddenKeys = ["tenant_id", "client_id", "id", "created_at", "business_id", "brand_id", "storefront_id"];
  for (const forbidden of forbiddenKeys) {
    assert.ok(!(forbidden in EMPTY_WORKSPACE_FORM), `EMPTY_WORKSPACE_FORM must not include ${forbidden}`);
  }
  assert.ok("client_type" in EMPTY_WORKSPACE_FORM);
  assert.ok("internal_notes" in EMPTY_WORKSPACE_FORM);

  // Post-review: count both sides programmatically instead of restating
  // a fixed number in two places (a previous "20-field" claim had
  // already drifted from the real 21-key allowlist) - this fails loudly
  // the moment the two lists disagree, rather than silently going stale.
  const formFieldCount = Object.keys(EMPTY_WORKSPACE_FORM).length;
  const migrationSource = await readSource(MIGRATION);
  const allowlistBlock = migrationSource.match(/v_allowed constant text\[\] := array\[([\s\S]*?)\];/)?.[1] ?? "";
  const migrationFieldCount = (allowlistBlock.match(/'[a-z_]+'/g) || []).length;
  assert.ok(formFieldCount > 0 && migrationFieldCount > 0, "expected to find non-empty field lists on both sides");
  assert.equal(formFieldCount, migrationFieldCount, "EMPTY_WORKSPACE_FORM's field count must match the migration's allowlist exactly");
});

test("diffWorkspaceForm (item 6/7 - patch-style edit): only changed fields are included, and an untouched non-midnight timestamp is never resubmitted", async () => {
  const original = { ...EMPTY_WORKSPACE_FORM, site_status: "Not started", next_action_due_at: "2026-08-24" };
  const current = { ...original, site_status: "In progress" };

  const updates = diffWorkspaceForm(current, original);
  assert.deepEqual(updates, { site_status: "In progress" }, "only the actually-changed key should appear in the diff");
  assert.ok(!("next_action_due_at" in updates), "an untouched field (even one truncated for display, like a date-only rendering of a non-midnight timestamptz) must never be resubmitted");
});

test("diffWorkspaceForm clears a field to null when it is explicitly edited to empty, but omits it entirely when never touched", async () => {
  const original = { ...EMPTY_WORKSPACE_FORM, next_action: "Call the client" };
  const clearedCurrent = { ...original, next_action: "" };
  const untouchedCurrent = { ...original };

  assert.deepEqual(diffWorkspaceForm(clearedCurrent, original), { next_action: null });
  assert.deepEqual(diffWorkspaceForm(untouchedCurrent, original), {});
});

test("fingerprintPreviewInput (item 4 - stale preflight): changes whenever any preflight-relevant field changes, and is stable for identical input", async () => {
  const base = { workspace_name: "GSB", tenant_slug: "gsb", client_email: "owner@example.com", client_name: "Owner" };
  const baseline = fingerprintPreviewInput(base);

  assert.equal(fingerprintPreviewInput({ ...base }), baseline, "identical input must fingerprint identically");
  assert.notEqual(fingerprintPreviewInput({ ...base, workspace_name: "GSB Two" }), baseline);
  assert.notEqual(fingerprintPreviewInput({ ...base, tenant_slug: "gsb-two" }), baseline);
  assert.notEqual(fingerprintPreviewInput({ ...base, client_email: "other@example.com" }), baseline);
  assert.notEqual(fingerprintPreviewInput({ ...base, client_name: "Someone Else" }), baseline);
  // A field the fingerprint deliberately does NOT cover (e.g. products
  // capability, client/site type) must not affect it - only the four
  // fields admin_preview_managed_brand_provisioning itself reads.
  assert.equal(fingerprintPreviewInput({ ...base, unrelated_field: "x" }), baseline);
});

test("migration: every Phase 2 mutation/provisioning/preflight RPC gates on is_app_admin(), not is_opps_staff() alone", async () => {
  const source = await readSource(MIGRATION);
  const rpcNames = [
    "admin_update_managed_client_workspace",
    "admin_initialize_managed_client_workspace",
    "admin_preview_managed_brand_provisioning",
    "admin_provision_managed_brand",
    "admin_activate_managed_xos_domain",
    "admin_set_managed_tenant_products_capability",
  ];
  for (const name of rpcNames) {
    const fnMatch = source.match(new RegExp(`create function public\\.${name}\\([\\s\\S]*?\\$\\$;`));
    assert.ok(fnMatch, `expected to find create function public.${name}`);
    assert.match(fnMatch[0], /if not public\.is_app_admin\(\) then/, `${name} must gate on is_app_admin()`);
  }
});

test("migration: admin_list_managed_clients() stays gated on is_opps_staff(), unchanged from Phase 0/1", async () => {
  const source = await readSource(MIGRATION);
  const fnMatch = source.match(/create or replace function public\.admin_list_managed_clients\(\)[\s\S]*?\$\$;/);
  assert.ok(fnMatch);
  assert.match(fnMatch[0], /if not public\.is_opps_staff\(\) then/);
  assert.ok(!/is_app_admin/.test(fnMatch[0]), "the read model must not require is_app_admin()");
});

test("migration: the XOS domain is always provisioned pending, never active, and activation only accepts a tenant id", async () => {
  const source = await readSource(MIGRATION);
  const provisionFn = source.match(/create function public\.admin_provision_managed_brand[\s\S]*?\$\$;/)?.[0] ?? "";
  assert.match(provisionFn, /values \(v_tenant_id, v_hostname, 'xos_admin', 'pending', true\)/, "provisioning must insert the xos_admin domain as pending");
  assert.ok(!/'xos_admin', 'active'/.test(provisionFn), "provisioning must never insert an active domain directly");

  const activateFn = source.match(/create function public\.admin_activate_managed_xos_domain\(p_tenant_id uuid\)[\s\S]*?\$\$;/)?.[0] ?? "";
  assert.ok(activateFn, "expected to find admin_activate_managed_xos_domain");
  assert.ok(!/p_hostname/.test(activateFn), "activation must never accept a hostname parameter");
  assert.match(activateFn, /status not in \('pending', 'verified'\)/, "activation must only allow pending/verified -> active");
});

test("migration: provisioning never returns auth_user_id and resolves the owner via a single case-insensitive email lookup", async () => {
  const source = await readSource(MIGRATION);
  const provisionFn = source.match(/create function public\.admin_provision_managed_brand[\s\S]*?\$\$;/)?.[0] ?? "";
  const resultBlock = provisionFn.match(/v_result := jsonb_build_object\(([\s\S]*?)\);/)?.[1] ?? "";
  assert.ok(!/auth_user_id/i.test(resultBlock), "the returned result must never include auth_user_id");
  assert.match(provisionFn, /select au\.id into v_owner_id from auth\.users au where lower\(au\.email\) = lower\(v_client_email\) limit 1;/);

  const previewFn = source.match(/create function public\.admin_preview_managed_brand_provisioning[\s\S]*?\$\$;/)?.[0] ?? "";
  const previewReturn = previewFn.match(/return jsonb_build_object\(([\s\S]*?)\);/)?.[1] ?? "";
  assert.ok(!/auth_user_id/i.test(previewReturn), "the preview result must never include auth_user_id");
});

test("migration: admin_update_managed_client_workspace's UPDATE statement never assigns an identity column", async () => {
  const source = await readSource(MIGRATION);
  const fnMatch = source.match(/create function public\.admin_update_managed_client_workspace[\s\S]*?\$\$;/)?.[0] ?? "";
  const setBlock = fnMatch.match(/update public\.managed_client_workspaces set([\s\S]*?)where id = p_workspace_id/)?.[1] ?? "";
  assert.ok(setBlock, "expected to find the UPDATE ... SET block");
  for (const identityColumn of ["tenant_id =", "client_id =", "business_id =", "brand_id =", "storefront_id =", "created_at ="]) {
    assert.ok(!setBlock.includes(identityColumn), `SET block must never assign ${identityColumn}`);
  }
});

test("migration: workspace initialize rejects an ambiguous (more than one) client match instead of guessing", async () => {
  const source = await readSource(MIGRATION);
  const fnMatch = source.match(/create function public\.admin_initialize_managed_client_workspace[\s\S]*?\$\$;/)?.[0] ?? "";
  assert.match(fnMatch, /WORKSPACE_INIT_CLIENT_AMBIGUOUS/);
  assert.match(fnMatch, /v_client_count > 1/);
});

test("migration: idempotency ledger is its own table, distinct from commerce.onboarding_operations, with no browser-facing grants", async () => {
  const source = await readSource(MIGRATION);
  assert.match(source, /create table public\.managed_brand_provisioning_operations/);
  // The header comment legitimately NAMES commerce.onboarding_operations
  // to explain why it is NOT reused (documentation, not reuse) - so this
  // checks the actual provisioning function body never reads/writes it,
  // not a blanket string ban across the whole file.
  const provisionFn = source.match(/create function public\.admin_provision_managed_brand[\s\S]*?\$\$;/)?.[0] ?? "";
  assert.ok(provisionFn, "expected to find admin_provision_managed_brand's body");
  assert.ok(!/commerce\.onboarding_operations/.test(provisionFn), "provisioning must not read/write the Commerce onboarding ledger");
  assert.match(provisionFn, /public\.managed_brand_provisioning_operations/, "provisioning must use its own ledger table");
  assert.match(source, /revoke all on public\.managed_brand_provisioning_operations from authenticated;/);
});

test("migration: the refined modern-tenant eligibility rule accepts a non-disabled (not just active) domain", async () => {
  const source = await readSource(MIGRATION);
  const helperMatch = source.match(/create function public\._is_eligible_managed_tenant[\s\S]*?\$\$;/)?.[0] ?? "";
  assert.match(helperMatch, /d\.status <> 'disabled'/, "eligibility must accept pending/verified/active, only excluding disabled");
  assert.ok(!/d\.status = 'active'/.test(helperMatch), "eligibility must not require status = active specifically");
});

test("migration (item 2, blocker): products capability requires the same structural eligibility as the read model, not just 'has a client'", async () => {
  const source = await readSource(MIGRATION);
  const capabilityFn = source.match(/create function public\.admin_set_managed_tenant_products_capability[\s\S]*?\$\$;/)?.[0] ?? "";
  assert.ok(capabilityFn, "expected to find admin_set_managed_tenant_products_capability's body");
  assert.match(
    capabilityFn,
    /if not public\._is_eligible_managed_tenant\(p_tenant_id\) then\s*\n\s*raise exception using errcode = 'P0001', message = 'MANAGED_BRAND_TENANT_NOT_MANAGED/,
    "capability toggle must reject with MANAGED_BRAND_TENANT_NOT_MANAGED when the tenant fails the shared eligibility check"
  );
  assert.ok(
    !/if not exists \(select 1 from public\.clients c where c\.tenant_id = p_tenant_id\) then/.test(capabilityFn),
    "the old 'has at least one client' check (too broad on its own) must be gone, superseded by _is_eligible_managed_tenant"
  );
});

test("migration (item 3, blocker): provisioning acquires a canonical-email advisory lock, in the documented idempotency-key -> slug -> email order, before re-checking the email conflict", async () => {
  const source = await readSource(MIGRATION);
  const provisionFn = source.match(/create function public\.admin_provision_managed_brand[\s\S]*?\$\$;/)?.[0] ?? "";
  assert.match(
    provisionFn,
    /pg_advisory_xact_lock\(hashtextextended\('managed_brand_email:' \|\| lower\(btrim\(v_client_email\)\), 0\)\)/,
    "provisioning must acquire an advisory lock keyed on the normalized (lower+trim) canonical email"
  );

  const idemLockIdx = provisionFn.indexOf("managed_brand_provision:");
  const slugLockIdx = provisionFn.indexOf("managed_brand_slug:");
  const emailLockIdx = provisionFn.indexOf("managed_brand_email:");
  assert.ok(idemLockIdx > -1 && slugLockIdx > -1 && emailLockIdx > -1, "all three lock namespaces must be present");
  assert.ok(idemLockIdx < slugLockIdx && slugLockIdx < emailLockIdx, "locks must be acquired in the documented deterministic order: idempotency-key -> slug -> email");

  // The email-conflict re-check must appear AFTER the email lock is
  // acquired, not before - otherwise the lock provides no protection for
  // that specific check.
  const emailConflictCheckIdx = provisionFn.indexOf("MANAGED_BRAND_CLIENT_EMAIL_TAKEN");
  assert.ok(emailConflictCheckIdx > emailLockIdx, "the client-email-conflict re-check must run after the email lock is acquired");
});

test("migration (item 5): provisioning sets clients.brand_name to the workspace/brand name, and the modern read-model brand_name prefers it over the contact name", async () => {
  const source = await readSource(MIGRATION);
  const provisionFn = source.match(/create function public\.admin_provision_managed_brand[\s\S]*?\$\$;/)?.[0] ?? "";
  assert.match(
    provisionFn,
    /insert into public\.clients \(tenant_id, name, brand_name, email, status\)\s*\n\s*values \(v_tenant_id, v_client_name, v_workspace_name, v_client_email, 'active'\)/,
    "clients.brand_name must be set to v_workspace_name (the brand), while name stays v_client_name (the contact)"
  );

  const readModelFn = source.match(/create or replace function public\.admin_list_managed_clients\(\)[\s\S]*?\$\$;/)?.[0] ?? "";
  assert.match(
    readModelFn,
    /'brand_name', coalesce\(pc\.brand_name, mt\.name, pc\.name\)/,
    "the modern-row brand_name fallback must prefer brand_name, then the tenant's own name, before falling back to the contact's name"
  );
  assert.ok(
    !/'brand_name', coalesce\(pc\.brand_name, pc\.name, mt\.name\)/.test(readModelFn),
    "the old fallback order (contact name before tenant name) must be gone"
  );
});

test("migration (item 8): provisioning validates initial_workspace against the shared workspace key allowlist before any insert", async () => {
  const source = await readSource(MIGRATION);
  const provisionFn = source.match(/create function public\.admin_provision_managed_brand[\s\S]*?\$\$;/)?.[0] ?? "";
  const validateIdx = provisionFn.indexOf("perform public._validate_managed_workspace_update_keys(v_workspace_fields);");
  const firstInsertIdx = provisionFn.indexOf("insert into public.tenants");
  assert.ok(validateIdx > -1, "provisioning must call the shared workspace-key validator on v_workspace_fields");
  assert.ok(firstInsertIdx > -1 && validateIdx < firstInsertIdx, "the validation must happen before the first insert (fail fast, zero partial state)");
});

test("SQL suite (item 1, regression guard): the disposable provisioning fixture slug is no longer a reserved token, and the suite asserts this itself at runtime", async () => {
  const source = await readSource(SQL_TEST_SUITE);
  assert.ok(!/'phase2-test-'/.test(source), "the old reserved-token fixture ('phase2-test-<rand>', which matches (^|-)(qa|demo|test)(-|$)) must not reappear");
  assert.match(source, /v_test_slug text := 'phase2-disposable-' \|\|/, "the happy-path fixture slug must use a non-reserved token");
  assert.match(
    source,
    /'disposable_fixture_slugs_are_not_reserved_tokens',\s*\n\s*v_test_slug !~\* '\(\^\|-\)\(qa\|demo\|test\)\(-\|\$\)'/,
    "the suite must assert its own fixture slugs are not reserved, so this cannot silently regress again"
  );
});
