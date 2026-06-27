# Host-Aware Public Tracking Phase 2 Verification

Date: 2026-06-27
Project ref: `slhcvyeuqsduaglddqdb`

## Scope

Phase 2 makes public order tracking tenant-aware by host while preserving the existing one-order minimal public payload.

Not included in this phase:
- real client tenant onboarding
- XOS admin shell
- tenant switcher UI
- uploads bucket privacy changes
- X LAB storefront/CMS/catalog/payment/analytics tenant-scope changes

## Applied

- Migration applied directly with Supabase CLI:
  - `supabase/migrations/202606240001_host_aware_public_tracking.sql`
- Migration history repaired for this version only:
  - `202606240001` marked applied remotely

`supabase db push` was not used because the remote migration history has existing drift for older migrations that are known to be present from prior production verification.

## SQL Assertions

Executed:

```powershell
supabase.exe db query --linked --file supabase\tests\host_aware_public_tracking.sql --output table
```

Result: passed with no exceptions.

Covered:
- `ops.jointx.co.za` resolves Joint X tracking.
- `xlab.jointx.co.za` resolves mapped Joint X tracking.
- unknown hosts return no order.
- malformed/path/port/trailing-dot hosts return no order.
- Tenant A and Tenant B disposable `public_tracking` hosts cannot cross-return orders.
- the same order number can exist in two tenants and resolves according to host.
- query parameters cannot override the host-resolved tenant.
- legacy `get_public_order_tracking(...)` cannot be used as a hostless tenant selector.
- payload remains minimal and excludes protected tenant, membership, mapping, internal notes, task, finance, project, purchasing, inventory, asset, and sequence data.
- disposable Tenant A/B fixtures were removed after the assertions.

## Targeted Production Checks

Additional production checks returned `true` for:
- active `public_tracking` mapping for `ops.jointx.co.za`
- active `public_tracking` mapping for `xlab.jointx.co.za`
- host-aware RPC returns one JSON object for a real Joint X sample order on `ops.jointx.co.za`
- unknown host rejected
- path host rejected
- port host rejected
- trailing-dot host rejected
- query-param host rejected
- protected payload keys absent
- disposable test tenants, domains, and orders cleaned up

Payload keys observed:

```text
client_name
courier
deposit_paid
due_date
id
invoice_files
order_number
pep_code
pipeline_stage
portal_attention_items
portal_message
portal_show_balance
portal_show_files
portal_visible_file_urls
production_client_update
production_detail_stage
production_method
status
total_amount
tracking_number
```

## Public Route Checks

Route checks:
- `https://ops.jointx.co.za/track` returned `200`
- `https://xlab.jointx.co.za/track` returned `200`

## Frontend Deploy

The frontend host-aware tracking helper was deployed to production after the database migration/tests passed.

Deploy command:

```powershell
npx.cmd vercel --prod --yes
```

Result:
- deployment id: `dpl_EXXX9fVrDhjdjZAdQJA4jobtiLNK`
- deployment URL: `https://joint-x-opps-baw5b9kqm-joint-x.vercel.app`
- production alias reported by Vercel: `https://ops.jointx.co.za`

Post-deploy route checks:
- `https://ops.jointx.co.za/track` returned `200`
- `https://xlab.jointx.co.za/track` returned `200`
## App Checks

Previously run after browser code changes:
- `npm.cmd run build`: passed
- `npm.cmd run lint`: failed on existing repo-wide unused import issues, including pre-existing unused imports in `TrackOrder.jsx`

No lint cleanup was performed as part of Phase 2.

