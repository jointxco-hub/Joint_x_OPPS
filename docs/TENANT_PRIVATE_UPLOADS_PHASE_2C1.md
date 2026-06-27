# Phase 2C.1 - Private Uploads and Signed URLs

## Status

Phase 2C.1 is closed for engineering.

Controlled DB verification passed after a corrective hardening migration.

Applied to the linked DB via controlled direct SQL because migration history has existing drift that makes broad `db push` unsafe for this phase:

- `supabase/migrations/202606270001_private_uploads_signed_urls.sql`
- `supabase/migrations/202606270002_harden_private_upload_path_access.sql`

Initial SQL assertion run failed correctly with: `Tenant A path spoofing bypassed tenant-prefix isolation.` Root cause: the first `is_private_upload_path_accessible(...)` implementation let parser-null slash paths fall through to app-admin recovery. The corrective migration now denies malformed slash paths before any admin fallback.

Verification completed:

- `supabase/tests/private_uploads_signed_urls.sql` passed after the corrective migration.
- `npm.cmd run build` passed.
- `npm.cmd run check:xos-boundary` passed.
- `npm.cmd run lint` remains blocked by the existing repo-wide unused-import backlog.

Frontend deployment completed: `https://joint-x-opps-mg4d2wi15-joint-x.vercel.app` and aliased to `https://ops.jointx.co.za`.

Live smoke checks after deploy:

- `https://ops.jointx.co.za` returned 200.
- `https://ops.jointx.co.za/track` returned 200.
- `https://xlab.jointx.co.za/track` returned 200.
- `https://demo.xos.jointx.co.za` returned 200 and served JS containing `XOS_BOUNDARY_ACTIVE`, `XOS Boundary Active`, `resolve_xos_admin_gate`, `private-upload://`, and `createSignedUrl`.

Authenticated OPPS browser-session smoke passed on production as a Joint X admin:

- Existing order file preview opens in-app.
- Direct file click opens through a signed Supabase Storage URL under `/storage/v1/object/sign/uploads/...`.
- Client account modal `Files & Invoices` links still load.
- Public tracking pages remain clean with no `private-upload://` refs and no `tenant_id`.
- `https://demo.xos.jointx.co.za` still shows `XOS Boundary Active` and no OPPS fallthrough.

Real client onboarding remains blocked until the next onboarding checklist is approved and legacy public upload backfill/recovery is planned.

## Current Risk Audit

The app historically uploaded files through `dataClient.integrations.Core.UploadFile` into the Supabase Storage `uploads` bucket and returned `getPublicUrl(...)`. That meant tenant metadata could be isolated while the object URL itself remained public.

Sensitive or tenant-scoped references are stored in:

- `orders.file_urls`
- `orders.portal_visible_file_urls`
- `orders.invoice_files`
- `client_assets.file_url`
- `client_file_links.file_url`
- `folders` / folder metadata
- `ops_tasks.supporting_files`
- legacy task `file_urls`
- expense receipt URLs
- notes/message attachment payloads

Screens depending on those URLs include:

- OPPS order drawer file tabs, invoice tabs, quick print sheets, and readiness checks
- File Manager and client asset panels
- Client Requests previews and persistent account files
- Task drawer, ops task cards, and task modal support files
- Expense receipt uploads
- Public tracking file display, which is now hardened to return no private file refs

Intentionally public media remains separate:

- Catalog/product/CMS media
- Profile/public display assets
- Future public storefront-safe assets

## Safe Model

New private uploads use:

- Bucket: `uploads`
- Bucket privacy: private
- Path shape: `<tenant_id>/<yyyy>/<mm>/<random>-<filename>`
- Stored app reference: `private-upload://uploads/<tenant_id>/<path>`
- Runtime access: short-lived Supabase signed URLs

Public media uses:

- Bucket: `public-assets`
- Bucket privacy: public
- Explicit `visibility: "public"` upload calls only

Access rules:

- The storage path tenant UUID is parsed from the first path segment.
- Paths with missing tenant prefix, missing child segment, backslashes, `.`, `..`, `/./`, `//`, leading slash, or malformed slash prefixes are rejected.
- Storage RLS uses `public.can_access_tenant(...)`.
- Cross-tenant reads/writes are rejected by storage policies.
- Legacy root-level `uploads` objects are not tenant-readable; app admins may recover them if needed.
- Public tracking never receives private file refs.

## Implementation

Migration:

- `supabase/migrations/202606270001_private_uploads_signed_urls.sql`
- `supabase/migrations/202606270002_harden_private_upload_path_access.sql`

Adds:

- Private `uploads` bucket setting
- Public `public-assets` bucket
- `private_upload_path_tenant_id(p_path text)`
- `is_private_upload_path_accessible(p_path text)`
- Storage policies for private tenant uploads
- Public tracking RPC hardening so file arrays are empty and `portal_show_files` is false

Frontend:

- `src/lib/privateFiles.js`
- `src/components/common/SignedFileLink.jsx`
- Private uploads now return `private-upload://...` refs
- Public catalog/profile uploads are explicitly routed to `public-assets`
- OPPS previews/downloads resolve signed URLs at runtime
- Raw private image previews are suppressed where async signing is not suitable, such as print thumbnail surfaces

## Tests

SQL:

- `supabase/tests/private_uploads_signed_urls.sql`

Assertions include:

- `uploads` is private
- `public-assets` remains public
- Tenant A can access Tenant A path
- Tenant A cannot access Tenant B path
- Tenant B cannot access Tenant A path
- XOS-style tenant member can access only its tenant path
- traversal-like path spoofing and malformed slash paths are rejected
- public tracking does not expose private file refs
- unknown and malformed tracking hosts return no order
- expected storage policy exists

Build:

- `npm.cmd run build` passed.

Lint:

- `npm.cmd run lint` failed on the existing repo-wide unused-import backlog; keep that as a separate cleanup slice unless intentionally addressed.

## Remaining Limitations

- The migration does not rewrite historical public URLs already stored in database fields.
- Existing public object URLs may stop loading once `uploads` becomes private; affected legacy files need a controlled backfill or admin recovery flow.
- SQL can assert path access and policies, but signed URL expiry is enforced through Supabase Storage API calls and the frontend helper.
- XOS file modules are not built in this phase.
- Real client onboarding remains blocked until the next onboarding checklist is approved and legacy public upload backfill/recovery is planned.
