-- ============================================================
-- Finance RLS Tighten
-- Run in: Supabase Dashboard → SQL Editor
-- Date: 2026-05-23
--
-- WHY THIS FILE EXISTS
-- The previous finance_upgrade migration created finance_budget_buckets
-- and finance_buying_items with permissive USING (true) policies,
-- allowing any authenticated user to read and write finance data.
-- This migration replaces those policies with admin-only access.
--
-- HOW ROLE CHECKING WORKS IN THIS PROJECT
-- App roles are stored in the `users` table (users.role) as text.
-- Values currently used: 'admin', 'user', 'investor', 'onboarding'.
-- They are NOT embedded in Supabase JWT claims — the JWT only carries
-- the built-in `role: "authenticated"` claim.
--
-- Therefore all role-based RLS must do a table lookup via a
-- SECURITY DEFINER function, which runs with postgres privileges
-- and can bypass RLS on the users table itself.
--
-- WHAT IS NOT CHANGED HERE (intentional)
-- The `transactions` table is shared with expense submission
-- (AddExpenseDrawer, TeamExpenses) and payment recording. Locking
-- it down to admin-only would break those features. The Finance page
-- itself is protected by: (a) adminOnly nav flag, (b) PIN screen.
-- TODO: Once Supabase custom JWT claims are wired (e.g. via a
-- DB webhook that sets app_role in jwt.claims), replace the
-- SECURITY DEFINER pattern with direct auth.jwt() -> 'app_role' checks
-- and add proper per-row RLS on the transactions table.
-- ============================================================


-- ── Step 1: Role-lookup helper (SECURITY DEFINER) ────────────
-- Reads the current authenticated user's app role from the users table.
-- SECURITY DEFINER bypasses RLS on the users table itself.
-- SET search_path is a security hardening measure against search_path injection.

CREATE OR REPLACE FUNCTION public.current_user_app_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role
  FROM public.users
  WHERE auth_user_id = auth.uid()
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.current_user_app_role() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.current_user_app_role() FROM anon;


-- ── Step 2: Admin check convenience function ─────────────────
-- Returns TRUE if the current user is an admin.
-- Two conditions (OR):
--   (a) users table role = 'admin'  — the normal DB-driven check
--   (b) email = owner email         — safety net if profile row missing

CREATE OR REPLACE FUNCTION public.is_app_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT (
    public.current_user_app_role() = 'admin'
    OR (auth.jwt() ->> 'email') = 'jointx.co@gmail.com'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_app_admin() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.is_app_admin() FROM anon;


-- ── Step 3: Finance-level check (for future roles) ───────────
-- Returns the finance access level for the current user:
--   1 = admin / owner
--   2 = finance_admin or manager (not yet used in DB)
--   3 = ops / operations (not yet used in DB)
--   4 = team / production (not yet used in DB)
--   0 = no finance access
--
-- Currently only level 1 (admin) exists in the users table.
-- Add cases here as new roles are introduced.

CREATE OR REPLACE FUNCTION public.user_finance_level()
RETURNS INT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT CASE public.current_user_app_role()
    WHEN 'admin'         THEN 1
    WHEN 'finance_admin' THEN 2
    WHEN 'finance'       THEN 2
    WHEN 'manager'       THEN 2
    WHEN 'ops'           THEN 3
    WHEN 'operations'    THEN 3
    WHEN 'ops_manager'   THEN 3
    WHEN 'team'          THEN 4
    WHEN 'production'    THEN 4
    WHEN 'staff'         THEN 4
    ELSE 0
  END
  -- Owner email override — always grants level 1
  | CASE WHEN (auth.jwt() ->> 'email') = 'jointx.co@gmail.com' THEN 1 ELSE 0 END;
$$;

GRANT EXECUTE ON FUNCTION public.user_finance_level() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.user_finance_level() FROM anon;


-- ── Step 4: Drop the permissive policies written in finance_upgrade ──

DROP POLICY IF EXISTS "authenticated_all_budget_buckets" ON finance_budget_buckets;
DROP POLICY IF EXISTS "authenticated_all_buying_items"   ON finance_buying_items;


-- ── Step 5: finance_budget_buckets — admin only ───────────────
-- Full CRUD is restricted to finance level >= 1 (admin / owner).
-- Non-admin users receive no rows and cannot write.

CREATE POLICY "finance_admin_read_budget_buckets"
  ON finance_budget_buckets
  FOR SELECT TO authenticated
  USING (public.is_app_admin());

CREATE POLICY "finance_admin_insert_budget_buckets"
  ON finance_budget_buckets
  FOR INSERT TO authenticated
  WITH CHECK (public.is_app_admin());

CREATE POLICY "finance_admin_update_budget_buckets"
  ON finance_budget_buckets
  FOR UPDATE TO authenticated
  USING (public.is_app_admin())
  WITH CHECK (public.is_app_admin());

CREATE POLICY "finance_admin_delete_budget_buckets"
  ON finance_budget_buckets
  FOR DELETE TO authenticated
  USING (public.is_app_admin());


-- ── Step 6: finance_buying_items — tiered access ──────────────
-- Level 1 (admin): full CRUD
-- Level 3-4 (ops/production): SELECT approved items only
--   → enabled via the second policy below
-- Level 0-2 non-admin: no write access (second policy is read-only)

-- Admin full CRUD
CREATE POLICY "finance_admin_all_buying_items"
  ON finance_buying_items
  FOR ALL TO authenticated
  USING (public.is_app_admin())
  WITH CHECK (public.is_app_admin());

-- Ops / Production: read approved items only
-- These roles do not exist in the DB yet, but the policy is ready.
-- When 'ops', 'production', etc. are assigned to users in the users table,
-- this policy will automatically grant them read access to approved items.
CREATE POLICY "finance_ops_read_approved_buying_items"
  ON finance_buying_items
  FOR SELECT TO authenticated
  USING (
    status = 'approved'
    AND public.user_finance_level() >= 3
  );

-- NOTE: The two SELECT policies are OR'd by Supabase, so:
--   admins see all rows (via first policy)
--   ops/production see only approved rows (via second policy)
--   everyone else sees nothing


-- ── Step 7: Verify RLS is still enabled ──────────────────────
-- (These are idempotent — safe to re-run)
ALTER TABLE finance_budget_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_buying_items   ENABLE ROW LEVEL SECURITY;


-- ── Step 8: transactions table note ─────────────────────────
-- transactions table is intentionally NOT changed here.
-- It is shared with:
--   • Expense submission (any authenticated user via AddExpenseDrawer)
--   • Team expenses page (reads own submitted expenses)
--   • Payment recording (synced from orders)
--
-- Finance-sensitive columns (is_test, excluded_from_reports, is_archived, etc.)
-- are only written/read by the Finance page, which is already protected
-- by: (a) adminOnly nav flag, (b) PIN screen, (c) Supabase anon key in-app.
--
-- TODO: When custom JWT role claims are available, add per-row RLS:
--   SELECT: own rows (submitted_by = auth.email()) OR admin
--   INSERT: authenticated (anyone can submit an expense)
--   UPDATE: own pending rows OR admin
--   DELETE: admin only
--
-- Until then, the application layer is the gate for finance data.
-- The Supabase anon key does not grant service-role level access.


-- ── Verify (run after applying) ──────────────────────────────
-- SELECT tablename, policyname, permissive, roles, cmd
-- FROM pg_policies
-- WHERE tablename IN ('finance_budget_buckets', 'finance_buying_items')
-- ORDER BY tablename, policyname;
