# Tenant Phase 2 Audit

## Already Tenant-Isolated

- `clients`, `orders`, and OPPS invoice tables.
- X LAB request, message, profile, and file bridge tables.
- `xlab_orders` and `transactions` have tenant ownership but still need policy/query review.

## Safe Next Candidates

These are internal operational records and should inherit the active tenant directly or from their linked order/client:

- `transactions`
- `projects`, `tasks`, `ops_tasks`
- `folders`, `client_assets`
- `purchase_orders`, `suppliers`, `inventory`
- `order_tags`, `order_exceptions`, `order_stage_history`, `order_production_readiness_checks`
- finance records and reporting snapshots

## Shared Or Product-Decision Areas

Do not add tenant ownership until ownership is confirmed:

- Internal identity/configuration: `users`, `roles`, `user_roles`, `admin_users`, notification preferences.
- Personal records: `personal_notes`, onboarding, QBR, weekly scores, time allocation.
- X1 public site CMS tables.
- X LAB storefront/CMS/catalog/payment tables including `xlab_products`, collections, pages, CMS settings, payments, discounts, and analytics.

## Risks Requiring Manual Review

- Public storefront/catalog queries must remain intentionally public or become tenant-host scoped before RLS changes.
- Finance reporting views must be rebuilt with tenant filters; view access must not bypass tenant-scoped source tables.
- Legacy direct Supabase clients in `src/api/supabase/orders.ts` need tenant context before they are used for new writes.
- `opps_invoice_number_sequences` is currently global. It does not expose invoice rows, but numbering must be made tenant-aware before multiple tenants issue invoices.

## Two-Tenant QA

1. Create a disposable tenant and a disposable member.
2. Seed one client, order, invoice, transaction, project, task, file, and X LAB request in each tenant.
3. Verify member A cannot list, read by ID, update, delete, export, or reach related RPC data for tenant B.
4. Verify anonymous tracking returns one matching public order only.
5. Verify a super-admin is granted explicit membership to each tenant rather than relying on a cross-tenant bypass.
6. Roll back or delete all probe data and accounts after QA.
