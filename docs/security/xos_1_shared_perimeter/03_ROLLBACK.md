# Safe rollback strategy

Rollback is a monitored migration, not an instruction to restore broad `anon`/`authenticated` grants.

1. If staff access fails, first replace `is_opps_staff()` with the compatibility definition “active `public.users.auth_user_id = auth.uid()`”. This restores mapped internal users while continuing to exclude external XOS identities that have no `public.users` row.
2. Keep RLS enabled on the 19 internal tables. Never roll back by disabling RLS.
3. Keep `TRUNCATE`, `REFERENCES`, and `TRIGGER` revoked from browser roles.
4. Keep `orders`, `clients`, `products`, tenants and operational tables protected by a restrictive internal-user policy. Change only the helper definition if staff recovery is needed.
5. Keep the broad `uploads` insert policy deleted. If a staff upload regression occurs, grant the staff-only policy through the compatibility helper; do not restore an authenticated-wide policy.
6. Keep external private-file reads exact-link based. A temporary service-side signed-read route is safer than broadening Storage SELECT.
7. Security-invoker views should remain invoker views. If an OPPS screen needs compatibility, add a bounded staff-only RPC rather than restore definer-view exposure.
8. Re-grant a function only to its documented named role. `upsert_opps_conversation` remains service-only; XOS/customer/public contracts remain explicit.
9. Re-run the complete role/host matrix before ending rollback mode.

Emergency compatibility helper body:

```sql
create or replace function public.is_opps_staff()
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$
  select coalesce(exists (
    select 1 from public.users u
    where u.auth_user_id = auth.uid() and coalesce(u.is_active, true)
  ), false)
$$;
```

This is deliberately not an automatic down migration: the old state exposed external identities and is not a safe rollback target.
