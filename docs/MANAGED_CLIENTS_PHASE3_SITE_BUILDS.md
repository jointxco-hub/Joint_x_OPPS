# Managed Clients Phase 3 — Site & Template Provisioning + Generate Build Brief

Builds on the live Phase 0/1/2 control plane (see
`docs/MANAGED_CLIENTS_CONTROL_PLANE.md`) without editing any of it. Adds
a "Site Build" section to a modern Managed Client, a reusable site
template registry, and deterministic, versioned, model-agnostic
build-brief generation — the next step in the original product
direction: Managed Brand → Workspace → Site/template selection → Build
brief → Build → Preview → Review → Domain → Live → Monthly Management.
Phase 3 covers up to and including the reviewed build brief; it does not
deploy anything.

## Recovery note

Before writing any of this, the repo's full git history (all branches,
every commit message, every file ever added) and the broader local
Joint X workspace (including its archive/legacy-app folders) were
searched for an authoritative prior "site build"/"template registry"
implementation, given an earlier attempt had partially built this
capability. Nothing was found. Per the task brief's own explicit
instruction not to fabricate undocumented prior behavior, this phase
restores the capability cleanly on the current architecture rather than
guessing at lost code — the site template registry starts genuinely
empty; no placeholder/fake templates are seeded.

## Foundation-model neutrality

`admin_generate_managed_site_build_brief` is pure deterministic
SQL/plpgsql string composition over structured Joint X data. It never
calls an LLM, is not "Claude-specific" (or specific to any other coding
agent), and produces plain text meant to be pasted into whichever coding
agent the operator is using that day. Foundation models are treated as
replaceable; the structured Joint X data is the authority.

## Architectural boundary

`public.managed_client_workspaces` (Phase 0-2) remains the high-level
operational workspace record — `client_type`, `site_type`,
`onboarding_stage`, readiness statuses, `preview_url`/`live_url`/
`domain_name`/`site_repo_url`, next action. It is **not** extended with
site-build detail fields; that is a separate, normalized domain (this
phase's three new tables). `onboarding_stage` is never mutated by
anything in this phase — generating a build brief changes only
`managed_site_builds.status` (its own narrower track, see below), never
the overall client lifecycle stage.

## Part A — Site template registry

`public.managed_site_templates` — metadata only: `template_key` (unique),
`name`, `description`, `supported_site_types` (`text[]`), `repository_url`,
`preview_url`, `framework`, `status` (`active`/`archived`),
`default_pages`/`default_features` (`jsonb`), `build_instructions`.
**Never** stores repository/Vercel/Supabase tokens, environment secrets,
or passwords — there is no column shape for any of that, and the JS
static test suite asserts this structurally.

Templates are **archive-only** — there is no delete RPC. A template
already referenced by a `managed_site_builds.template_id` can therefore
never be removed out from under it. `admin_list_managed_site_templates()`
returns every template (active and archived, for the admin management
screen); the Site Build configuration UI filters to `status = 'active'`
client-side for its own selector.

Managed via `src/pages/ManagedSiteTemplates.jsx` ("Manage Site
Templates", admin-only nav entry) — Add / Edit / Archive only.

## Part B — Managed site build

`public.managed_site_builds` — `tenant_id`/`client_id`/`workspace_id`
(all server-resolved, never browser-supplied — see Security below),
`template_id` (nullable — a build may explicitly have no template,
i.e. "custom build"), a narrow `status` track (see below), and the
structured configuration fields: `primary_goal`, `brand_summary`,
`target_audience`, `visual_direction`, `tone_of_voice`,
`required_pages`/`required_features`/`integrations`/`reference_urls`
(`jsonb` arrays of plain strings), `content_notes`, `product_notes`,
`technical_notes`, `deployment_notes`.

**At most one non-archived build per workspace**, enforced by a partial
unique index (`managed_site_builds_one_active_per_workspace`), not
application logic alone — a genuinely fresh build can still be started
later once an old one is archived.

**Template compatibility**: selecting a template requires it to be
`active`, and — when the workspace has a `site_type` set and the
template declares a non-empty `supported_site_types` — the workspace's
site type must appear in that list. A template with an empty
`supported_site_types` array is treated as "not yet scoped" and never
rejected on that basis alone.

### Build status vs. onboarding stage

`managed_client_workspaces.onboarding_stage` remains the overall client
lifecycle (`01 Intake` … `10 Monthly Management`) — untouched by
anything in this phase. `managed_site_builds.status` is a narrower,
site-build-specific track: `draft` → `brief_ready` → `building` →
`preview_ready` → `review` → `live` → `archived`. Only the
`draft` → `brief_ready` transition happens automatically (on the first
successful brief generation); every other transition is future,
operator/deployment-driven work outside this phase's scope.

## Part C — Build brief versions

`public.managed_site_build_briefs` — immutable, versioned artifacts.
`unique (site_build_id, version)`. A new generation **always** inserts a
new version; existing versions are never updated or overwritten, so a
brief a coding agent was actually handed stays reproducible even after
later regeneration. `generated_by` follows the established audit
convention used throughout this codebase (a text email, e.g.
`opps_activity_events.actor_email`), never a raw `auth_user_id`.

### Why snapshot

`source_snapshot` (`jsonb`) captures the safe source values a brief was
actually generated from — brand identity, client type, site type,
workspace readiness statuses, site-build configuration, selected
template metadata, and safe Commerce product summaries. It **never**
includes auth metadata, private file contents, internal costs, supplier
prices, tokens, secrets, or private conversation content. This is what
makes a brief reproducible and auditable independent of whatever the
live data looks like later.

## Part D — Fingerprint / staleness

`source_fingerprint = md5(source_snapshot::text)`, computed by a single
shared helper, `public._compute_managed_site_build_snapshot(...)`, that
takes already-resolved rows (build, workspace, tenant, client, template)
rather than re-querying by id. Both `admin_get_managed_site_build`
(read-only — computes the CURRENT fingerprint and compares it to the
latest generated version's stored one, exposing `brief_stale: boolean`,
without generating anything) and `admin_generate_managed_site_build_brief`
(writes a new version) call this same function — "is this brief stale"
and "what does a fresh generation actually capture" can never drift
apart, because they are the same computation.

The fingerprint changes when template, site type, brand summary, goal,
audience, design direction, required pages/features/integrations,
reference URLs, relevant workspace readiness fields, or the tenant's
active Commerce product catalog changes. It does **not** change for
unrelated OPPS data — the snapshot object only ever contains the fields
listed above, so nothing else can affect it.

The UI ("Site Build" section) shows an explicit "Build brief out of
date" banner and never silently presents an old brief as current.

## Part F — Readiness

`public._managed_site_build_readiness(...)` returns `{ state,
missing_inputs }`. `state` is one of:

- **`blocked`** — reserved for structural errors only: an invalid or
  archived template reference. (Tenant/workspace/client structural
  problems are already fail-fast rejected earlier, by
  `public._resolve_active_managed_workspace`, and never reach this
  function.)
- **`ready_with_missing_inputs`** — anything else missing (site type,
  primary goal, brand summary, no pages/features configured, unknown
  assets/content status). Generation is still allowed — the brief's own
  "Missing Inputs" section (13) states exactly what's missing instead of
  fabricating content.
- **`ready`** — nothing missing.

Only `blocked` prevents `admin_generate_managed_site_build_brief` from
running at all (`SITE_BUILD_BLOCKED`).

## Safe Commerce context

`commerce.products`/`commerce.product_variants` (established by XOS
3A/3B) have no internal production-cost column at all — they are already
the customer-facing catalog projection, so selecting `name`,
`description`, `price`, `sale_price`, `currency`, `availability`,
`primary_image_url` (products) and `title`/`size`/`color`/`availability`
(variants) directly can never leak supplier/production cost. Included in
section 7 of the brief only when the tenant has at least one active
product; when the Products capability is enabled but the catalog is
empty, or disabled entirely, the brief says so explicitly rather than
fabricating catalog content.

## GSB behavior

GSB currently has a modern tenant, active XOS, enabled Products
capability, and one real Commerce product ("GSB Tes" — untouched by this
phase) — but no `managed_client_workspaces` row yet. Its Site Build
section therefore shows "Set up workspace before configuring the managed
site build." and nothing else; the workspace is **not** initialized by
this phase (that remains a separate, explicit Phase 2 operator action).
Once initialized, Site Build becomes available immediately, and the
brief generator may use GSB Tes as safe catalog context during QA of the
generated output.

## Security

Every Phase 3 RPC requires `public.is_app_admin()` (now NULL-safe and
`search_path`-hardened — see `20260824090200_app_admin_null_safety_and_phase2_regrant.sql`),
never `is_opps_staff()` alone — the same class of high-impact operation
as Phase 2's provisioning RPCs. `SECURITY DEFINER`, fixed
`search_path = pg_catalog, public`, `PUBLIC`/`anon` revoked,
`authenticated` granted. All three new tables have RLS enabled with zero
policies — reachable only through the RPC surface, no direct browser
table access. Tenant/client/workspace identity is always resolved and
verified server-side (`public._resolve_active_managed_workspace`,
plus a defensive re-verification inside the brief generator) — the
browser only ever supplies a `tenant_id` (to the build RPCs) or a
`site_build_id` (to the brief RPCs), never a `client_id`/`workspace_id`
directly.

## Future work (explicitly out of scope for Phase 3)

- **Deployment**: no Vercel API integration, no repository creation, no
  DNS changes, no automatic deploy action anywhere in this phase's UI or
  database layer. The reviewed build brief is the phase's output — it is
  what will make those later actions deterministic once built.
- **Build-task checklist**: the earlier Managed Clients implementation
  also had the idea of generating build-checklist tasks, but had a known
  visibility problem (tasks could be queued yet never appear in the
  normal Tasks surface). Phase 3 does not ship a task-creation
  integration — no local/offline task queue exists, and no
  `View Tasks` action was added to the Site Build UI. Wiring this up
  requires first proving end-to-end that generated tasks are inserted
  into the canonical OPPS task authority and appear immediately in the
  normal Tasks surface; that verification (and the feature itself) is
  deferred to Phase 3B.

## Tests

**SQL (`supabase/tests/managed_clients_phase3_site_builds.sql`)** —
rollback-wrapped; performs real application-table writes (templates, a
disposable tenant/client/workspace fixture, a site build, brief
versions) inside a single `begin;`/`rollback;`. GSB is used **only** for
read-only assertions (its Commerce product, its workspace-absence) and
as a deliberate rejection probe (proving `admin_upsert_managed_site_build`
correctly refuses it for having no workspace) — never as a write target.
Covers non-admin denial for every mutation; archived/nonexistent/
incompatible-site-type template rejection; tenant/client/workspace
identity agreement; structured field persistence and unknown-key
rejection; brief version sequencing (v1, then v2, old versions
unchanged); fingerprint determinism, and that it changes for
template/config/Commerce-catalog changes but not for unrelated OPPS
data; that the brief never contains `auth_user_id`, internal/supplier
cost language, or token/secret language; and that GSB and its one real
Commerce product are unchanged after every write above. **Not executed
against production** — read-only during implementation/review, same as
every prior phase; the migration has not been applied either.

**JS (`tests/managed-clients-phase3-site-builds.test.mjs`)** — static
source-inspection tests, same convention as the Phase 2 suite: every RPC
gates on `is_app_admin()`; every new table has RLS enabled with zero
policies; `managed_client_workspaces` is never mutated by this
migration; templates are archive-only; the one-active-build-per-workspace
partial unique index exists; template selection enforces both
active-status and site-type compatibility; tenant/client/workspace
identity is always server-resolved; the brief generator re-verifies
identity agreement; staleness detection and generation share the same
snapshot helper; generation only ever refuses on a structural `blocked`
state; brief generation never touches `onboarding_stage`; brief versions
are unique and monotonically incrementing; the safe Commerce snapshot
never selects an internal-cost-shaped column; the template registry has
no secret-shaped column; the SQL suite never uses GSB as a write
fixture; and the frontend states/actions described in "Site Build UI"
below all exist in source. All pass.
