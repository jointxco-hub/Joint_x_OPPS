# XOS 2.5 — Onboarding / Provisioning Runbook (Decision 3)

Reusable process for onboarding the next XOS client (first case study:
GSB — not performed yet). Deliberately a script + runbook, not a UI: at
current volume (a handful of tenants total, ever) building admin UI for
this now would be speculative. See docs/XOS_CONTROLLED_ONBOARDING_READINESS.md
for prior related context.

Script: `supabase/provisioning/xos_tenant_provisioning_template.sql`
(template — copy per onboarding, never run unfilled, never added to
`supabase/migrations/`).

## What the schema already supports (audited, not assumed)

- `clients.tenant_id` already exists and is the real client↔tenant link.
  Today it's mostly unused for actual multi-tenancy: 45 of 48 `clients`
  rows share the single "Joint X" tenant (`6d371f51-274c-4b49-8d59-2aeaf5e89088`),
  which is really the internal/default OPPS bucket, not per-client tenancy.
  Only 3 clients have their own dedicated tenant today: Demo XOS, Tenant A
  QA, Tenant B QA.
- **GSB does not exist as a `clients` row yet** (searched by name, brand
  name, company name — zero matches). Onboarding GSB starts one step
  earlier than "select existing client" — the client record itself has to
  be created, under a brand-new tenant, not the shared Joint X one.
- No admin UI exists anywhere in the codebase for creating a tenant,
  domain, membership, or client↔tenant link (grepped the whole frontend).
  No invite table exists. Every tenant/domain/membership row that exists
  today was hand-inserted via raw SQL during earlier XOS phases.
- DNS: `*.jointx.co.za` is already a wildcard ALIAS to Vercel's edge
  (confirmed via `vercel dns ls jointx.co.za`), and DNS wildcard rules
  cover multi-level subdomains like `<tenant>.xos.jointx.co.za` as long as
  no closer record exists — so no registrar/DNS work is needed per new
  client subdomain.

## Required inputs

| Input | Notes |
|---|---|
| Workspace display name | e.g. "God's Spoilt Brat" |
| Tenant slug | e.g. `gsb` — must be unique |
| Canonical client email | becomes `clients.email` **and** must match the owner's login email exactly (see invariant below) |
| Hostname | `<slug>.xos.jointx.co.za` — must be unique |
| Owner auth user id | the owner must already have a Supabase Auth account (password or Google, same flow as existing XOS sign-in) before running the script |
| Owner role | `owner` for the first onboarding |

## Temporary identity invariant

**For this first version of onboarding, the script requires the owner's
auth login email to match the canonical client email exactly
(case-insensitive), and refuses to provision otherwise.**

This is deliberate, not an oversight: `create_xos_request_for_host` links
a submitted request to a `clients` row purely by matching the
authenticated email to `clients.email`. A mismatch here is exactly what
caused the defect fixed in `20260818090001_xos_request_visibility_tenant_scope.sql`
— that fix stops a mismatch from making a request *invisible*, but a
mismatch still means the request arrives with `client_id = NULL` and no
proper client attribution in OPPS. Enforcing the match at onboarding time
is the cheapest way to avoid the situation entirely for every request a
new tenant's owner submits, rather than relying on the read-side fix alone.

**This is explicitly not the long-term design.** XOS should eventually
have its own explicit client-user/contact mapping (e.g. a table linking
`auth_user_id` → `client_id` directly, independent of email string
matching) rather than relying on two different email fields happening to
agree. That mapping is **not** being built in XOS 2.5 — no existing table
in this schema provides it, and building one is a bigger decision than
this phase's scope. Flagging it here so it isn't forgotten when a second
or third onboarded client's owner wants to use a different login email
than their stored contact email (e.g. logging in with Google using a
personal address while the business's canonical contact email differs).

## Provisioning safety

The script is a single transaction. Before any `INSERT`, it checks (and
`RAISE EXCEPTION`s, aborting the whole transaction, on any hit):

- tenant slug uniqueness
- hostname uniqueness
- client email conflict (a `clients` row with that email already existing
  — this workflow only creates a brand-new client under a brand-new
  tenant, it does not relink an existing one)
- the owner auth user id actually exists in `auth.users`
- the email invariant above

After inserting `tenants` → `clients` → `tenant_domains` → `tenant_memberships`
(in that dependency order), it re-checks all four rows exist and are
correctly linked before the file's final `commit;` is reached — if that
post-check ever fails, it raises and the transaction aborts, leaving
nothing behind.

**Validated (2026-08-18, read-only + disposable, nothing persisted):**
- Ran the full script against real data with a disposable, colliding email
  on purpose — the pre-flight "client email conflict" guard fired exactly
  as designed, proving the check works.
- Ran just the four `INSERT` statements in isolation, wrapped in
  `begin; ... rollback;`, against real foreign keys (a real test
  `auth.users` id) with fresh disposable slug/hostname/email — all four
  succeeded syntactically and referentially, then confirmed zero rows
  persisted afterward (`select count(*) from tenants where slug like
  'zz-syntax-test%'` → 0).

## Activation checklist

DB-verifiable (the script itself checks these before its final commit):

- [ ] tenant `status = 'active'`
- [ ] client belongs to the new tenant (`clients.tenant_id` matches)
- [ ] `tenant_domains` row active, `surface = 'xos_admin'`
- [ ] owner `tenant_memberships` row active
- [ ] email invariant satisfied

**Requires a live login — the script cannot check these, no local
Postgres/Docker was available in this environment to simulate a session
(same limitation the Part 1 live QA ran into):**

- [ ] `resolve_xos_admin_gate('<hostname>')` returns `allowed = true` for
      the owner's real session
- [ ] Orders/Requests/Files RPCs return cleanly (even if empty)
- [ ] A real request submission from the new workspace appears on the
      OPPS ClientRequests side (the exact check that surfaced the Decision
      1 defect — worth re-running deliberately for the first real client)
- [ ] No cross-tenant leakage (spot-check: does anything from another
      tenant show up anywhere in the new workspace?)

## Manual external step — Vercel domain

DNS wildcard coverage does not, by itself, make a new hostname servable —
Vercel's project routing still needs the exact hostname explicitly
attached. **Not performed. Documented only:**

```
add <tenant>.xos.jointx.co.za
to joint-x-opps production project
```

(`vercel domains add gsb.xos.jointx.co.za` + attach to production, or the
equivalent in the Vercel dashboard.) No DNS/registrar changes are needed —
confirmed the wildcard already resolves to Vercel's edge.

## Module flags — deferred

`tenants.settings` is `jsonb` and exists on every tenant row already, but
is unused everywhere in the current codebase (`{}` on all 4 existing
tenants; no code reads or writes it — `XOSWorkspaceLayout`'s nav is a fixed
hardcoded list). Introducing `settings.xos.modules.*` would be real
frontend work (reading it, filtering nav/routes), not just a data
decision. Since every tenant today would want all four current modules
(Overview/Orders/Requests/Files) anyway and Products is out of scope,
this is deferred rather than designed further now, per the task's own
guidance.

## Client onboarding UI — deferred

Explicitly not built now. After GSB (or whichever client goes first) is
provisioned once through this runbook, use that real, lived experience —
what was fiddly, what a form should have validated, what order the steps
actually needed to happen in — to design the eventual "Create Workspace →
Select/Create Client → Workspace → Owner → Domain → Review → Activate" UI
with real friction points in hand rather than speculative ones.

## Exact GSB steps (documented only — not performed)

1. Decide GSB's canonical contact email now — becomes both their `clients.email`
   and their required XOS login identity.
2. Have the GSB owner create (or confirm they already have) a Supabase
   Auth account using exactly that email.
3. Fill in `xos_tenant_provisioning_template.sql` (copy it, e.g.
   `xos_provision_gsb.sql`): workspace name "God's Spoilt Brat", slug
   `gsb`, hostname `gsb.xos.jointx.co.za`, the email from step 1, the
   owner's real `auth.users.id`, role `owner`.
4. Run it once (`supabase db query --linked --file xos_provision_gsb.sql`
   or psql) — it will raise and roll back cleanly if any precondition
   fails, or commit if everything checks out.
5. Add `gsb.xos.jointx.co.za` as a Domain on `joint-x-opps` in Vercel and
   attach it to production (the one manual step the script can't do).
6. Work through the "requires a live login" section of the Activation
   Checklist above with the real owner.
