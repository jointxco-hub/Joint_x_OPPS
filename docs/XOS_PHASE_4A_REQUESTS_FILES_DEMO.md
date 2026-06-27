# XOS Phase 4A - Requests and Files Demo

## Status

Closed for engineering after signed Storage object repair. Final authenticated browser click-through should be confirmed from a real `demo-xos` member session.

Scope is intentionally small: make `demo.xos.jointx.co.za` useful with client-facing Requests and Files only, without exposing OPPS internals or onboarding a real client.

## Implementation

Migration:

- `supabase/migrations/202606270005_xos_requests_files_demo.sql`

Adds:

- `get_xos_requests_for_host(p_hostname, p_limit)`
- `get_xos_files_for_host(p_hostname, p_limit)`
- disposable `DEMO-XOS` request rows and file metadata for the existing `demo-xos` tenant

Frontend:

- `src/lib/xosModules.js`
- `src/pages/XOSAdminShell.jsx`

The XOS shell now shows:

- Requests list
- Files list
- Orders, Reports, and Store Settings as `Coming soon`

It still does not mount OPPS layout, sidebar, route table, tenant local-storage selection, or internal data clients.

## Data Contract

Requests return only:

- request id
- request type
- status
- title
- preview
- client display name
- source app
- created timestamp

Files return only:

- file id
- file display name/type/size
- folder display name
- source app
- created timestamp
- authenticated private file reference for immediate signed URL creation

No XOS RPC returns `tenant_id`, `client_id`, internal notes, staff assignment data, finance data, suppliers, purchase orders, production notes, inventory internals, raw private Storage URLs, or public tracking file arrays.

## Verification

Database:

- Initial migration run failed before completion because `storage.objects.path_tokens` is a generated column in the linked Supabase project.
- The migration was corrected to leave `path_tokens` database-generated.
- `supabase/migrations/202606270005_xos_requests_files_demo.sql` applied to the linked DB via controlled direct SQL.
- `supabase/tests/xos_requests_files_demo.sql` passed.
- `supabase/tests/private_uploads_signed_urls.sql` passed as a public/private file regression check.

Frontend:

- `npm.cmd run check:xos-boundary` passed.
- `npm.cmd run build` passed.
- `npm.cmd run lint` still fails on the existing repo-wide unused-import backlog.

Deployment:

- Production deployment URL: `https://joint-x-opps-3obp58v8b-joint-x.vercel.app`
- Vercel alias reported: `https://ops.jointx.co.za`

Live checks:

- `https://ops.jointx.co.za` returned 200.
- `https://ops.jointx.co.za/track` returned 200.
- `https://xlab.jointx.co.za/track` returned 200.
- `https://demo.xos.jointx.co.za` returned 200.
- Deployed XOS bundle contains `XOS_BOUNDARY_ACTIVE`.
- Deployed XOS bundle contains `get_xos_requests_for_host` and `get_xos_files_for_host`.
- Fresh browser DOM for `demo.xos.jointx.co.za` showed `XOS Boundary Active` and no OPPS dashboard/sidebar markers.
- Disposable live demo member SQL probe confirmed `demo.xos.jointx.co.za` returns seeded `DEMO-XOS` Requests and Files only through the host-scoped XOS RPCs.

Browser file click-through finding:

- Authenticated browser QA showed the XOS UI and Files module correctly, but opening a demo file returned `404 Not found` from a signed Supabase URL.
- Observed signed path: `/storage/v1/object/sign/uploads/8d4496f1-7c39-4f30-b6d4-45bded18a421/xos-demo/welcome-note.txt`.
- Root cause: `storage.objects` metadata rows existed for the disposable demo paths, but the object bodies were missing or unreadable.

Storage repair:

- Removed the broken disposable demo objects only:
  - `8d4496f1-7c39-4f30-b6d4-45bded18a421/xos-demo/welcome-note.txt`
  - `8d4496f1-7c39-4f30-b6d4-45bded18a421/xos-demo/brand-brief.pdf`
- Uploaded fresh disposable demo object bodies to the exact same paths.
- Download verification passed:
  - `welcome-note.txt` downloaded at 82 bytes.
  - `brand-brief.pdf` downloaded at 620 bytes.

Post-repair verification:

- `supabase/tests/xos_requests_files_demo.sql` passed.
- `supabase/tests/private_uploads_signed_urls.sql` passed.
- `npm.cmd run check:xos-boundary` passed.
- `npm.cmd run build` passed.
- No frontend deploy was required because the fix changed only Storage object bytes.

The file links continue to use the existing signed URL helper and the payload does not return raw signed URLs, tenant IDs, or public tracking file arrays.
