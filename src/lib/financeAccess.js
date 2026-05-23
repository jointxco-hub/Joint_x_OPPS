/**
 * Finance access control — frontend layer.
 *
 * Role values that currently exist in the `users` table:
 *   'admin'       → Owner / Super Admin (full finance access)
 *   'user'        → Regular team member (no finance access)
 *   'investor'    → Read-only observer (no finance access currently)
 *   'onboarding'  → New user not yet assigned a role (no finance access)
 *
 * Planned future roles (not yet in DB — add them to users table when ready):
 *   'finance_admin' → Finance manager (revenue + expenses, no delete)
 *   'manager'       → Same as finance_admin
 *   'ops'           → Operations (outstanding orders, approved buying items)
 *   'operations'    → Same as ops
 *   'team'          → Production team (approved buying items only)
 *   'production'    → Same as team
 *
 * IMPORTANT: Frontend checks alone are not sufficient security.
 * The Supabase `finance_budget_buckets` and `finance_buying_items` tables
 * are protected by RLS policies that use the `is_app_admin()` DB function.
 * See: supabase/migrations/20260523_finance_rls_tighten.sql
 *
 * The `transactions` table RLS is intentionally permissive (shared with
 * expense submission). Finance data there is protected by the PIN screen
 * and adminOnly nav flag. See the migration file for full TODO notes.
 */

import { isAdmin } from './admin.js';

// ── Finance level enum ────────────────────────────────────────
// 0 = no access
// 1 = full executive access (admin/owner) — the only level in active use
// 2 = finance manager — FUTURE (role not yet in DB)
// 3 = operations manager — FUTURE (role not yet in DB)
// 4 = team/production — FUTURE (role not yet in DB)

export function getFinanceLevel(user) {
  if (!user) return 0;

  // Level 1: Admin / Owner — the only finance-capable role currently in the DB
  if (isAdmin(user)) return 1;

  const r = (user.role || '').toLowerCase();

  // Level 2: Finance manager (add 'finance_admin' or 'manager' to users.role when ready)
  if (r === 'finance_admin' || r === 'finance' || r === 'manager') return 2;

  // Level 3: Ops manager (add 'ops' or 'operations' to users.role when ready)
  if (r === 'ops' || r === 'operations' || r === 'ops_manager') return 3;

  // Level 4: Team / Production (add 'team' or 'production' to users.role when ready)
  if (r === 'team' || r === 'production' || r === 'staff') return 4;

  // 'user', 'investor', 'onboarding' → no finance access
  return 0;
}

// ── Visibility checks ─────────────────────────────────────────

/** Full executive dashboard — revenue, profit, VAT, transaction history, insights */
export const canSeeFullFinance = (u) => getFinanceLevel(u) >= 1;

/** Finance summary — revenue + expenses. No profit/VAT/full history. */
export const canSeeFinanceSummary = (u) => getFinanceLevel(u) >= 2;

/** Operational finance — outstanding orders, approved budgets */
export const canSeeOperationalOnly = (u) => getFinanceLevel(u) >= 3;

/** Buying items list — approved items only for ops/production */
export const canSeeBuyingItems = (u) => getFinanceLevel(u) >= 4;

// ── Action checks ─────────────────────────────────────────────
// NOTE: These are frontend guards. Sensitive write actions are also
// enforced by Supabase RLS on the finance tables.

/** Hard delete a transaction — owner/admin only */
export const canDeleteTransactions = (u) => isAdmin(u);

/** Archive a transaction (soft delete) — admin currently; finance_admin when added */
export const canArchiveTransactions = (u) => isAdmin(u);

/** Mark a transaction as test / exclude from reports — admin currently */
export const canMarkTestTransactions = (u) => isAdmin(u);

/** Edit category or description on a transaction — admin currently */
export const canEditTransactions = (u) => isAdmin(u);

/** Submit an expense (not just admin) — any authenticated user via TeamExpenses */
export const canAddExpenses = (u) => Boolean(u);

/** Create / edit / archive budget buckets — admin; finance_admin when role added */
export const canManageBudgets = (u) => isAdmin(u);

/** Create / edit / archive buying items — admin; finance_admin when role added */
export const canManageBuyingItems = (u) => isAdmin(u);

/** Approve buying items — admin / owner only */
export const canApproveBuyingItems = (u) => isAdmin(u);
