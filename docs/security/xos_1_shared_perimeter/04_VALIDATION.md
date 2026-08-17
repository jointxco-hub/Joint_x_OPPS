# Validation report

## Disposable database

Image: locally cached `public.ecr.aws/supabase/postgres:17.6.1.143`. No project link and no production SQL execution were used.

All four migrations applied in order with `ON_ERROR_STOP=1`. Assertions passed for:

- valid member and owner host gates;
- unknown host, inactive tenant, non-member, outsider and cross-tenant denial;
- bounded XOS order RPC success with direct order SELECT/INSERT denial;
- request RPC creation with direct delete filtered by RLS;
- direct clients/products/internal-users denial;
- exact linked private-file read, guessed-file and cross-tenant denial;
- external `uploads` insert denial and staff tenant-path insert success;
- OPPS staff tenant-scoped read/write preservation;
- security-invoker view staff access and anon denial;
- service-role RLS bypass and backend helper execution;
- authenticated denial of backend-only helper execution.

Catalog after-state showed RLS enabled for representative Advisor tables, `{security_invoker=true}` on all three formerly flagged views, and restrictive (`polpermissive = false`) operational staff policies.

## OPPS regression

- `npm run build`: passed (45 seconds); only stale Browserslist/baseline data warnings.
- Focused Node suite: 263 passed, 0 failed. Covered order folders/files, ClientAsset/file library, primary/private images, quote-request calculations, order/invoice sync, and catalog/file-gallery behavior.
- No runtime source changed, so authentication/host runtime behavior remains the previously accepted implementation; the database matrix exercises its exact authority boundary.

## Existing unrelated/tooling failures

- `npm run check:xos-boundary` fails on the checkout's CRLF line endings with `XosOnlyApp must render XOSAdminShell.` The runtime markers are present; the parser's `\n`-specific regex is the known defect. It was not modified because this package was completed without a runtime/tool-file rewrite.
- Full lint/typecheck were not used as exit gates because the repository has acknowledged unrelated failures.
- Hosted Security Advisor cannot target the disposable local container; after-state is catalog/assertion based.

## Repeat sequence

Run the prelude, bootstrap, platform-equivalent grant fixtures, four migrations, role matrix, and service matrix in filename order with `psql -v ON_ERROR_STOP=1 -f <file>`. Destroy the container afterward.
