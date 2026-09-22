# OPPS Team Identity — Phase 2C candidate audit (Employee / My Hub)

Scope note: Phase 2B (this branch) migrated task/goal/idea/bug-report/order
assignment identity from email to `auth_user_id`, dual-writing both during
the compatibility window. It deliberately did **not** touch the employee
operating-system layer below — My Hub, daily closeout, weekly reports,
12-week KPIs, and staff activity attribution are a distinct system with
different risk (report/KPI generation, not just display), and converting
them wasn't attempted in this pass. This document is the map for that next
piece of work (Phase 2C), not a conversion.

## Systems audited

| System | Table(s) | Identity key today | Category | Notes |
|---|---|---|---|---|
| `useMyRole` | `user_roles` → `roles` | `user_email` | **identity** (query key) + **display** (joined `name`/`color`/`icon`/`focus_areas`) | Operational role assignment (e.g. "Designer", "Shift Lead") — a *third* role concept, distinct from `tenant_memberships.tenant_role` (owner/admin/member) and Phase 2A's `tenant_access_roles.name`. Converting the query key to `auth_user_id` is a same-shape change to what Phase 2B already did for Goals/Tasks; the joined display fields need no change. |
| `useMyTags` / `MyTagsInbox` | `order_tags` → `orders` | `user_email` | **identity** | "Tag me on this order" — assignment-*like*, but a genuinely separate table from `orders.assigned_to`/`assigned_team` and was never in Phase 2B's explicit scope list. `MyTagsInbox.jsx` itself is pure display/prop-consumer, no independent identity logic. |
| `weekly_scores` (WAM, read in `UserDashboard.jsx`) | `weekly_scores` | `user_email` | **identity**, feeds **KPI aggregation** | Per-person, per-cycle-week score row (`tactics_planned`/`tactics_completed`/`score_percentage` — the last is a Postgres `generated always as` column). **Flag**: converting the identity key here directly affects `score_percentage` aggregation and any rollup reporting built on `weekly_scores.user_email` — needs its own careful pass with report-generation in mind, not a drive-by rename. |
| `DailyQbrCheck` | `qbrs` | `user_email` | **identity** | Daily closeout check-in, one row per person per day. Same shape as the other identity conversions, but changing the key affects the daily-streak logic (`.eq('user_email', userEmail).eq('date', today)`) — needs a matching backfill so historical streaks don't appear to reset. |
| KPIs (`dataClient.entities.KPI`, shown in `UserDashboard.jsx`) | `kpis` | none directly — scoped by `goal_id` | **tenant-role lookup / derived** | KPIs have no person field of their own; person-attribution flows through the linked Goal's assignee. Phase 2B already converted `goals.assigned_auth_user_id` — KPI attribution inherits that for free once a KPI's Goal is resolved. No independent action needed here. |
| `order_stage_history.changed_by` | `order_stage_history` | free-text (email or name) | **historical attribution** | Immutable log of who moved an order between pipeline stages. Per instruction, **not** a migration candidate — this is audit/report readability text, not a live identity relationship that needs resolving back to a person for access control or filtering. |
| Operator/designer/VA/shift-lead dashboards, production/QC activity, handover/blocker attribution | not independently audited this pass | — | — | Named in the request but not traced to specific files/tables in this audit — flagging that this table is **not exhaustive** rather than asserting these are clean. Phase 2C should start with a fresh `grep` for `user_email`/`.eq('assigned_to'` style patterns scoped to `src/components/hub/`, `src/pages/*Dashboard*`, and any `production`/`qc`/`handover` named files, the same way this Phase 2B pass started. |

## Categorization key (as requested)

- **identity** — a live relationship used for access/filtering/ownership; the real Phase 2C conversion candidates.
- **historical attribution** — immutable audit/log text; explicitly *not* to be migrated (`order_stage_history.changed_by`).
- **display** — resolved name/role/avatar shown to a user; must keep resolving through the tenant-scoped directory (Phase 2A's `list_opps_team_directory`) or a purpose-built reporting projection, never broad `public.users` access.
- **tenant-role lookup** — role/permission resolution via `tenant_memberships`/`tenant_access_roles`, separate from personal identity.

## What would break if these were converted carelessly

- `weekly_scores` and `qbrs`: both have `generated`/streak-style logic keyed on the identity column combined with a date/week number. A naive rename without backfill would make every existing row invisible to "my" queries, silently zeroing out KPI history and closeout streaks — not a display bug, a reporting-correctness bug.
- `useMyRole`: role display feeds `MyRoleCard`/dashboard chrome directly; safe to convert (same shape as Phase 2B's other single-identity fields) but should keep the joined display fields resolving through the directory projection, not a raw `public.users` join, consistent with Phase 2A's intent.
- `order_tags`: closest in spirit to file-comment mentions (Phase 2B item 8's open blocker) — worth deciding both together rather than solving `order_tags` in isolation while mentions stay blocked.

This document is scoped to be the starting map for Phase 2C — it does not implement any of the above.
