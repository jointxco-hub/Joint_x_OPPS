# Multi-Tenant Rollout

## Phase 1: Ownership Foundation

- Create tenants and tenant memberships.
- Seed the existing Joint X tenant.
- Backfill tenant ownership onto core OPPS and X LAB records.
- Do not alter live application access patterns yet.

## Phase 2: Tenant Context

- Add tenant selection/context to internal applications.
- Ensure every create writes the selected tenant ID.
- Scope read queries by tenant ID.
- Keep X LAB's application source separate from tenant ownership.

## Phase 3: RLS Enforcement

- Enable tenant-scoped RLS table by table after the corresponding app queries are scoped.
- Test owner, member, unrelated member, and super-admin access for each table.
- Enforce non-null tenant IDs only after all historical and new records are scoped.

## Phase 4: Cross-App Contracts

- Decide whether X LAB is a tenant or a connected application inside a tenant.
- Define tenant-aware contracts for customer identity, orders, files, requests, and payment health.
- Add tenant-aware audit events and operational reporting.

## Current Decision

Joint X is the first tenant. OPPS and X LAB remain connected applications inside that tenant until a product decision explicitly separates X LAB into its own tenant.

## Isolation Verification

- 2026-06-21: passed a transaction-only second-tenant simulation in production.
- An admin-role account assigned exclusively to the temporary tenant saw zero Joint X clients, orders, invoices, and X LAB requests.
- The tenant, membership changes, and probe all rolled back with no persisted production data.
