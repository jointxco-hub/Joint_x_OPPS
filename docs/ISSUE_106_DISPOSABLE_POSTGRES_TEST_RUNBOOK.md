# Issue #106 — disposable PostgreSQL verification

Do not execute these steps on staging or production; they are **destructive to the selected test database**. Use a newly created disposable database. The fixture uses synthetic UUIDs and contains no customer or PayFast data.

## Preflight

The target database must have PostgreSQL 15+ with roles `anon` and `authenticated`. A fresh Supabase local database typically has those roles; a vanilla PostgreSQL container may not. For a **new disposable database only**, the bootstrap below creates minimum stubs.

The draft SQL is **not** a production migration, and has not been validated in a real PostgreSQL runtime in this session. Review the SQL first.

## Bootstrap in a new empty disposable database

```sql
create role anon nologin;
create role authenticated nologin;
create table public.tenants (id uuid primary key);
insert into public.tenants(id) values ('22222222-2222-4222-8222-222222222222');
```

If the two roles already exist, omit their CREATE ROLE statements. Apply:

```
psql -X -v ON_ERROR_STOP=1 -d <DISPOSABLE_DB> -f docs/ISSUE_106_QR_PRIVATE_SCHEMA_DRAFT.sql
psql -X -v ON_ERROR_STOP=1 -d <DISPOSABLE_DB> -f tests/fixtures/issue-106-qr-private-schema-smoke.sql
node --test tests/issue-106-qr-lifecycle.test.mjs tests/issue-106-pg-qr-store.test.mjs tests/issue-106-invoice-payable-resolver.test.mjs tests/issue-106-qr-presentation.test.mjs
```

The SQL test runs inside a transaction and rolls back all fixture records. It tests unique active request, operation-key uniqueness, exception de-duplication, settled-reference constraints, and direct schema-role access.

## Mandatory integration checks after isolated schema tests

- Confirm the new schema can be accessed only through a dedicated reviewed backend role. FORCE RLS with no policies blocks ordinary users **and table owners**; do not disable RLS merely to make the adapter run.
- Confirm transaction-bound real invoice row locks under concurrent staff payments.
- Confirm `resolveCafeInvoicePayable` works with the exact intended tenant membership and allowed invoice statuses; it intentionally rejects Café counter order target and any actor without a server-verified identity marker.
- Confirm the service uses a **trusted** auth session and never allows the browser to choose its own user ID, tenant, amount, callback validity, or gateway status.
- Do not expose the JS `verified:true` settlement parameter as a public API. Only a complete PayFast validation handler may call it.
- Build the verified PayFast callback adapter and business-safe handling of captured funds after stale/expired QR checkout. This is not finished.
- Run concurrent PostgreSQL sessions for actual locking and real PayFast sandbox tests before production.

## Verification record (9 November 2026)

- Read-only staging database metadata and function-definition inspection completed.
- 12 isolated JavaScript resolver checks passed against the exact committed source using a mocked query interface.
- Previous adapter smoke checks passed with mocks. These **do not replace** a running PostgreSQL test.
- A real disposable PostgreSQL instance could not be started here because PostgreSQL binaries were absent and package installation was inaccessible.
- No staging/production schema mutations, Edge Function deployments, or actual payment initiations were performed.
