# Two-Tenant Isolation QA

## Scope

Run this before enabling tenant switching or onboarding a client brand. Use two disposable Auth users and never use real client details.

## Setup

Create two disposable Supabase Auth users, then replace the two email values below. Run in the SQL editor as an administrator.

```sql
-- Register internal profiles if they do not already exist.
insert into public.users (auth_user_id, user_email, full_name, role, is_active)
select id, email, 'Tenant A QA', 'admin', true
from auth.users
where email = 'tenant-a-qa@example.com'
  and not exists (select 1 from public.users u where u.auth_user_id = auth.users.id);

insert into public.users (auth_user_id, user_email, full_name, role, is_active)
select id, email, 'Tenant B QA', 'admin', true
from auth.users
where email = 'tenant-b-qa@example.com'
  and not exists (select 1 from public.users u where u.auth_user_id = auth.users.id);

insert into public.tenants (slug, name)
values ('tenant-a-qa', 'Tenant A QA'), ('tenant-b-qa', 'Tenant B QA')
on conflict (slug) do nothing;

insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role)
select tenant.id, auth_user.id, 'admin'
from public.tenants tenant
join auth.users auth_user on (tenant.slug = 'tenant-a-qa' and auth_user.email = 'tenant-a-qa@example.com')
  or (tenant.slug = 'tenant-b-qa' and auth_user.email = 'tenant-b-qa@example.com')
on conflict (tenant_id, auth_user_id) do update set status = 'active', tenant_role = excluded.tenant_role;
```

Each QA user must belong only to its matching QA tenant. Do not add either user to `joint-x`.

## Seed Data

Sign in as each QA user separately and create the following through OPPS. This proves the real application write paths stamp tenant context correctly.

- Client and order
- Invoice, export setting, and CSV/PDF output
- Payment or expense transaction
- Project, task, and ops task
- Folder and client asset metadata
- Supplier, inventory item, and purchase order
- Budget bucket, buying item, and money model snapshot
- Order tag, exception, stage change, and readiness check
- X LAB request/message/file bridge record where that flow is available

Use the visible prefix `TENANT-A-QA` or `TENANT-B-QA` on every test record.

## Isolation Matrix

Run every row as both Tenant A and Tenant B, targeting the other tenant's record IDs/URLs where possible.

| Domain | List | Read by ID | Update/Delete | Cross-parent create | Result |
| --- | --- | --- | --- | --- | --- |
| Clients and orders | passed | passed | passed | fixed, then passed | passed after `8200f84` |
| Invoices and sequences | passed | passed | passed | passed | passed |
| Transactions and order support | passed | passed | passed for transactions | passed for transactions | needs follow-up for tag/exception/history UI paths |
| Projects, tasks, ops tasks | passed | passed | passed | passed for projects and ops tasks | passed; legacy `tasks` direct probe passed |
| Folders and asset metadata | passed | passed | passed | passed | passed |
| Suppliers, inventory, purchase orders | passed | passed | passed for purchase orders | passed for purchase orders | passed; inventory link variants need follow-up |
| Finance and reporting | passed | passed | passed where parent links exist | needs follow-up | passed for reporting; unsupported parent-link variants deferred |
| X LAB bridge RPCs | passed for prior read simulation | passed for prior read simulation | blocked | blocked | blocked: live RPC probe needs an authenticated CLI session |

## QA Run Results: 2026-06-21

- Passed: Tenant A and Tenant B were seeded through OPPS with the core client, order, invoice, transaction, project, ops task, folder/asset, purchasing, and finance records.
- Passed: simulated Tenant A access saw zero Tenant B records across clients, orders, invoices, transactions, projects, ops tasks, folders, assets, suppliers, inventory, purchase orders, finance buckets, buying items, and money model snapshots.
- Passed: the same read-isolation result held from Tenant B against Tenant A.
- Passed: each tenant saw only its own income row through the `income` security-invoker view; no cross-tenant expense rows were visible.
- Found and fixed: Tenant A could initially create a Tenant A order linked to Tenant B's client. The transaction rolled back; no record persisted. Commit `8200f84` adds database parent-tenant guards for orders and invoices.
- Passed after fix: the same cross-client order probe is rejected by the database.
- Passed: Tenant A cross-parent update probes were rejected for transactions, projects, ops tasks, folders, client assets, purchase orders, and invoices.
- Passed: Tenant A could not update or delete a Tenant B record by ID.
- Passed: Tenant A could not call `next_opps_invoice_number` with Tenant B's tenant ID.
- Passed: sequence rows are independent: Joint X 2026 remains at `6`; Tenant A and Tenant B are each at `1`.
- Passed: a direct legacy `tasks` RLS probe inserted a rollback-only Tenant A task; Tenant B received zero rows for list/read, update, and delete. The legacy table is tenant-isolated even though the current UI creates `ops_tasks`.
- Blocked: the current public tracker deliberately hard-codes the Joint X tenant. It remains safe for Joint X, but Tenant A/B public tracking variants cannot be tested until tenant/host routing exists.
- Blocked: the final live X LAB bridge-RPC mutation probe could not run because the local Supabase CLI session expired. Earlier production simulation already confirmed zero cross-tenant X LAB request reads; list/read/update/reply/status wrapper verification remains required after re-authentication.
- Deferred: copied `uploads` public URLs may remain accessible even though folder and asset metadata is tenant-isolated. Private bucket and signed-URL hardening is Phase 2C.1 and was not changed here.

## Public Tracking

- Passed: anonymous `get_public_order_tracking` returns one requested Joint X order, not an order list.
- Passed: the public result does not include task, project, finance, purchase, inventory, asset, or sequence data.
- Blocked: order-number, courier-number, and invoice-number variants for Tenant A/B are intentionally unavailable until tenant/host routing determines the tenant before lookup.

## Reporting And Invoice Checks

- Passed: `income` returned only the signed-in tenant's row through the security-invoker view; no cross-tenant expense rows were visible.
- Needs follow-up: direct aggregate verification for `expenses` and `v_founder_dependency_score` remains outstanding.
- Passed: Joint X invoices remain unchanged and its 2026 sequence remains at `6` after `OPPS-INV-2026-0006`.
- Passed: Tenant A and Tenant B each own an independent 2026 sequence at `1`.
- Passed: Tenant A cannot call `next_opps_invoice_number` with Tenant B's tenant ID.

## Known File Limitation

Folder and asset metadata is tenant-isolated. The existing `uploads` bucket still uses public URLs, so a copied direct URL may remain accessible. Record this as a known limitation; private bucket/signed URL work is Phase 2C.1 and is out of scope here.

## Cleanup

Delete or archive QA records in the application first. Then remove memberships and tenants:

```sql
delete from public.tenant_memberships
where tenant_id in (select id from public.tenants where slug in ('tenant-a-qa', 'tenant-b-qa'));

delete from public.tenants
where slug in ('tenant-a-qa', 'tenant-b-qa');
```

If deletion is blocked, tenant-owned QA records remain. Remove those records first; do not use cascading deletes against production data.

## Closure Decision

**Conditional go for the next engineering phase; no-go for real client onboarding yet.**

- Passed: two disposable tenants can coexist with read isolation, mutation denial, parent-link protection, tenant-aware invoice sequences, reporting row isolation, and file metadata isolation.
- Fixed: the one discovered cross-tenant create defect was contained, rolled back, and corrected in commit `8200f84`; its regression probe now passes.
- Blocked before onboarding: tenant/host routing is required for client-tenant public tracking.
- Deferred before onboarding: Phase 2C.1 must make uploads private and issue signed URLs.
- Needs follow-up: complete the live X LAB bridge RPC mutation probe after Supabase CLI re-authentication; verify the remaining aggregate views and the niche order-support/inventory link variants.

## Current Automated Evidence

- Passed: QA tenants, Auth users, and tenant-only memberships exist in production for this controlled drill.
- Passed: temporary two-tenant production simulations showed zero cross-tenant clients, orders, invoices, transactions, projects, tasks, assets, purchasing, finance records, and X LAB request reads.
- Passed: anonymous Joint X tracking returns one requested order through `get_public_order_tracking`.
- Blocked/deferred items are listed in the closure decision above; no unrecorded pending QA work remains.
