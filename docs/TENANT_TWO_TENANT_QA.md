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
| Clients and orders | blocked | blocked | blocked | blocked | pending |
| Invoices and sequences | blocked | blocked | blocked | blocked | pending |
| Transactions and order support | blocked | blocked | blocked | blocked | pending |
| Projects, tasks, ops tasks | blocked | blocked | blocked | blocked | pending |
| Folders and asset metadata | blocked | blocked | blocked | blocked | pending |
| Suppliers, inventory, purchase orders | blocked | blocked | blocked | blocked | pending |
| Finance and reporting | blocked | blocked | blocked | blocked | pending |
| X LAB bridge RPCs | blocked | blocked | blocked | blocked | pending |

## QA Run Results: 2026-06-21

- Passed: Tenant A and Tenant B were seeded through OPPS with the core client, order, invoice, transaction, project, ops task, folder/asset, purchasing, and finance records.
- Passed: simulated Tenant A access saw zero Tenant B records across clients, orders, invoices, transactions, projects, ops tasks, folders, assets, suppliers, inventory, purchase orders, finance buckets, buying items, and money model snapshots.
- Passed: the same read-isolation result held from Tenant B against Tenant A.
- Passed: each tenant saw only its own income row through the `income` security-invoker view; no cross-tenant expense rows were visible.
- Found and fixed: Tenant A could initially create a Tenant A order linked to Tenant B's client. The transaction rolled back; no record persisted. Commit `8200f84` adds database parent-tenant guards for orders and invoices.
- Passed after fix: the same cross-client order probe is rejected by the database.
- Needs manual follow-up: the current Tasks UI creates `ops_tasks`; no browser create path was found for the legacy `tasks` table.
- Pending: cross-tenant mutation/parent-link probes, public tracking lookup variants, invoice sequence negative probe, X LAB bridge UI/RPC checks, and direct uploads URL limitation confirmation.

## Public Tracking

- Test an order number, courier tracking number, and invoice number for each QA tenant.
- Confirm the response contains exactly one matching order.
- Confirm no task, project, finance, purchase, inventory, client asset, or sequence data is returned.

## Reporting And Invoice Checks

- `income`, `expenses`, and `v_founder_dependency_score` show only the signed-in tenant's rows/aggregate.
- Joint X invoices remain unchanged and the next Joint X invoice continues after `OPPS-INV-2026-0006`.
- Tenant A and Tenant B can independently generate the same formatted number when their counters begin at the same value.
- Tenant A cannot call `next_opps_invoice_number` with Tenant B's tenant ID.

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

## Current Automated Evidence

- Passed: temporary two-tenant production simulation showed zero Joint X clients, orders, invoices, and X LAB requests to a member assigned only to a second tenant.
- Passed: anonymous tracking returns one requested order through `get_public_order_tracking`.
- Blocked: no `tenant-a-qa` / `tenant-b-qa` tenants or disposable Auth users existed in production when this drill was started on 2026-06-21.
- Pending manual browser verification: each matrix row above, report views, invoice continuity, uploads URL limitation, and real UI create/update/delete flows.
