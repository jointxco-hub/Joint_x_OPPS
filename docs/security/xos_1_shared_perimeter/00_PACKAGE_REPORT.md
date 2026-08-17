# XOS 1 shared database perimeter package

Status: **READY FOR SECURITY CUTOVER REVIEW**. This means reviewable and locally validated, not approved for production.

## Repository safety

- Source: `origin/main` at `1068a37d9f252283f2e552a61dc0463077b177c4`
- Branch: `agent/xos-security-perimeter-package`
- Isolated checkout: `C:\Users\Jasper Jai\Desktop\Joint_x\App Development\Alethea Brand OS™_files\Clients\God's Spoilt Brat\xos-security-package`
- The dirty/diverged `recovery/xlab-quote-approval` checkout was not edited, cleaned, reset, or rebased.

## Existing and new authority models

Existing tenant roles are `owner`, `admin`, and `member`; no parallel role enum or premature `viewer` role was added. `can_access_tenant(uuid)` remains a visibility/membership helper. It is no longer sufficient authority for direct OPPS operational CRUD.

`is_opps_staff()` is the new authority boundary. It requires all of:

1. the JWT `auth.uid()` maps to an active `public.users` row;
2. that auth identity has an active membership;
3. the membership belongs to the active tenant whose slug is `joint-x`.

The live read-only check found nine active `public.users` identities, all nine auth-mapped, and all nine with active Joint X membership. External tenant membership alone never satisfies this helper. Existing app-admin and tenant helpers remain intact.

## Package contents

- `20260817173001_xos_opps_staff_authority.sql`: staff authority and closed future default privileges.
- `20260817173002_xos_table_api_perimeter.sql`: RLS for 19 Advisor tables, restrictive staff gates for operational tables, safe grants, and corrected client-product staff policies.
- `20260817173003_xos_storage_perimeter.sql`: removes the broad `uploads` OR-bypass, makes writes staff-only, and allows external reads only for exact linked private files.
- `20260817173004_xos_view_function_api_perimeter.sql`: security-invoker internal views, explicit function execution, backend-only helpers, and invoker folder RPCs.
- Focused disposable database bootstrap and role/host matrix under `supabase/tests/`.

No application runtime file, PayFast object, production database, deployment, domain, or real client was changed.

## Security Advisor classification

Before (live, read-only):

- fixed by the package: 19 `rls_disabled_in_public` errors; three `security_definer_view` errors (`active_tasks`, `v_company_north_star`, `v_projects`); direct authenticated execution of `upsert_opps_conversation` and `xlab_bridge_file_ref_matches_tenant`;
- intentional: `client_file_folders` and `client_file_links` have RLS with no direct policies because access is RPC-mediated;
- intentionally retained: bounded XOS, client portal, customer-account, tracking, storefront and checkout definer RPCs;
- deferred/unrelated: legacy mutable-search-path warnings, leaked-password protection setting, and X LAB's existing public storefront/customer policies, including `xlab-assets` compatibility.

After (disposable database): catalog evidence confirms representative Advisor tables have RLS, all three flagged views are `security_invoker`, operational policies are restrictive, authenticated cannot execute the backend conversation helper, and service role can. A hosted Advisor cannot run against a local container, so the after result is catalog/assertion based and does not claim zero findings.

## Production readiness

The migrations are additive and passed isolated execution and the explicit role/host matrix. They have **not** been applied to production. Next step: peer-review this branch and run a production-target preflight/dry review against the reconciled live object list. Only after approval should the four migrations be applied in timestamp order during a monitored security cutover.
