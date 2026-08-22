-- Fixes a confirmed cross-tenant RLS bypass on 5 tables. Each carried a
-- policy named "xos1_require_opps_staff" that was declared PERMISSIVE
-- FOR ALL USING (is_opps_staff()) — despite its name, Postgres ORs
-- permissive policies together, so this policy did not "require" staff
-- status in addition to tenant scoping; it granted an independent,
-- unconditional bypass. is_opps_staff() checks only "is this an active
-- member of the Joint X tenant" with no tenant_id parameter, so any
-- Joint X staff account (any tenant_role) could read/insert/update rows
-- belonging to any other tenant, verified live via a non-admin,
-- single-tenant test account with is_app_admin() = false and
-- can_access_tenant(foreign_tenant) = false that nonetheless inserted
-- into a foreign tenant's production_pricing_defaults.
--
-- Each of the 5 tables already carries its own correctly tenant-scoped
-- policies (can_access_tenant() for read, inventory_can_review_tenant()
-- or an explicit is_app_admin() OR can_access_tenant() check for
-- write) that fully encode the intended access model on their own.
-- Any user for whom is_opps_staff() is true necessarily already holds
-- an active tenant_memberships row for the Joint X tenant, so
-- can_access_tenant() already grants them read access to their own
-- tenant's rows without this policy — it was never adding legitimate
-- same-tenant access, only illegitimate cross-tenant access. No
-- replacement policy is required on any of the 5 tables.
drop policy if exists xos1_require_opps_staff on public.production_pricing_defaults;
drop policy if exists xos1_require_opps_staff on public.product_components;
drop policy if exists xos1_require_opps_staff on public.order_line_component_snapshots;
drop policy if exists xos1_require_opps_staff on public.order_line_production_tracking;
drop policy if exists xos1_require_opps_staff on public.inventory_variant_reservations;
