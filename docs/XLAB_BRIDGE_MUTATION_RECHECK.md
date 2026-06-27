# X LAB Bridge Mutation Recheck

## Status

Closed for engineering.

Phase 3 XOS Host Gate and Phase 2C.1 Private Uploads + Signed URLs are closed for engineering. This pass rechecks the X LAB bridge RPCs that move request, message, and file metadata between X LAB client account surfaces and internal OPPS views.

## Scope

- `get_internal_client_requests`
- `update_internal_client_request_status`
- `add_internal_client_message_reply`
- `get_internal_client_file_library`
- `upsert_internal_client_file_folder`
- `upsert_internal_client_file_link`
- `copy_internal_client_file_link`
- `delete_internal_client_file_link`

## Finding

The request list/status wrappers and message reply RPCs were already tenant-scoped by the Phase 2 backend isolation work.

The older client file-library mutation RPCs still selected and mutated by client email, folder id, or file-link id without requiring the record tenant to be in `current_user_tenant_ids()`. That left a bridge mutation path that needed hardening before real client onboarding.

## Corrective Migration

- `supabase/migrations/202606270003_harden_xlab_bridge_mutations.sql`

The migration:

- resolves client file mutations only inside the caller's active tenant memberships;
- stamps created folders and links with the resolved tenant id;
- requires parent folders, target folders, updated links, copied links, linked orders, linked projects, and linked tech packs to match the resolved tenant;
- rejects private upload refs whose tenant UUID path prefix does not match the resolved tenant;
- rejects short-lived signed Storage URLs as persisted bridge metadata;
- keeps legacy public URLs and public media references readable.

## SQL Assertions

- `supabase/tests/xlab_bridge_mutation_recheck.sql`

Assertions cover:

- Tenant A sees and updates only Tenant A requests.
- Tenant B sees and updates only Tenant B requests.
- Cross-tenant request status mutation is denied.
- Reply creation lands in the caller's tenant.
- Parent-message linkage cannot action another tenant's parent message.
- Same client email in two tenants resolves according to membership.
- Tenant A cannot update Tenant B folders.
- Tenant A cannot store Tenant B private upload refs.
- Tenant A cannot persist short-lived signed URLs.
- Tenant A cannot copy or delete Tenant B file links.
- Internal file library returns only caller-tenant file metadata.
- Authenticated users cannot execute the legacy unscoped request RPCs.

## Verification

Both corrective migrations were applied to the linked DB via controlled direct SQL:

- `supabase/migrations/202606270003_harden_xlab_bridge_mutations.sql`
- `supabase/migrations/202606270004_revoke_xlab_unscoped_bridge_rpcs.sql`

Initial assertion run after `202606270003_harden_xlab_bridge_mutations.sql` failed correctly because the legacy unscoped request RPCs were still executable through PostgreSQL's default `PUBLIC` function privilege.

After `202606270004_revoke_xlab_unscoped_bridge_rpcs.sql`, verification passed:

- `supabase/tests/xlab_bridge_mutation_recheck.sql` passed.
- `supabase/tests/private_uploads_signed_urls.sql` passed as a public/private file regression check.

No frontend/app code changed in this pass, so `npm.cmd run build` was not required.

## Closure

The X LAB bridge mutation recheck is closed for engineering. The bridge now denies cross-tenant request mutation, cross-tenant parent-message actioning, cross-tenant file metadata mutation, cross-tenant private upload refs, persisted signed URLs, and direct authenticated execution of the legacy unscoped request RPCs.

Real client onboarding remains paused until the next onboarding checklist is approved.