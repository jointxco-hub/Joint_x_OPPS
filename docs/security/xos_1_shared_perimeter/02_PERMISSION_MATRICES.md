# Permission matrices

Legend: `no` = no direct table access; `RPC` = bounded definer RPC only; `own` = explicitly owned customer rows/files; `staff` = `is_opps_staff()` plus existing tenant/role policy; `all` = backend/BYPASSRLS.

| Object/class | anon | auth outsider | XOS member | XOS owner/admin | OPPS staff | service_role | Classification |
|---|---:|---:|---:|---:|---:|---:|---|
| `clients` | no | no | RPC | RPC | staff | all | OPPS staff-only / narrow XOS identity RPC |
| `orders` | no | no | RPC read | RPC read | staff CRUD | all | XOS RPC-only |
| `products` | no | no | no | no | staff CRUD | all | OPPS staff-only; not XOS Commerce authority |
| `tenants` | no | no | RPC gate | RPC gate | staff | all | gate/helper mediated |
| `tenant_memberships` | no | no | RPC gate | RPC gate | staff | all | gate/helper mediated |
| `client_quote_requests` | no | no | RPC list/create | RPC list/create | existing admin/RPC | all | XOS RPC-only |
| `client_file_links`, `client_file_folders` | no | no | RPC | RPC | internal RPC | all | deny-by-default RPC-only |
| `client_products` family | public/customer policy only | own only | own only | own only | staff | all | preserve X LAB customer contracts |
| operational tenant tables | no | no | no | no | staff + tenant scope | all | OPPS staff-only |
| 19 Advisor tables | no | no | no | no | staff CRUD | all | OPPS staff-only |
| internal views | no | no | no | no | SELECT with caller RLS | all | OPPS staff-only |

The 19 Advisor tables are `bug_reports`, `calendar_events`, `goals`, `ideas`, `kpis`, `offer_scores`, `onboarding_flows`, `order_stages`, `personal_notes`, `qbrs`, `roles`, `sops`, `stage_role_rules`, `time_allocations`, `twelve_week_cycles`, `user_roles`, `users`, `weekly_scores`, and `weekly_tasks`.

## Storage

| Bucket/path | anon | auth outsider | XOS member/owner | OPPS staff | service_role |
|---|---:|---:|---:|---:|---:|
| `uploads/<tenant>/...` read | no | no | exact `client_file_links.file_url` only | tenant-scoped | all |
| `uploads` insert/update/delete | no | no | no | tenant-scoped | all |
| legacy unprefixed `uploads` read | no | no | no | yes | all |
| `public-assets` read | yes | yes | yes | yes | all |
| `public-assets` write | no | no | no | yes | all |
| `client-artwork`, `client-mockups` | no | own policy | own policy | tenant-scoped | all |
| `xlab-assets` | existing public/customer contract | existing | existing | existing | all |

The removed `Allow authenticated uploads 1va6avm_0` policy previously allowed any authenticated identity to insert anywhere in `uploads`; because policies combine with OR semantics it bypassed the tenant-prefix policy.

## Proposed client-safe fulfilment mapping (documentation only)

| Internal OPPS state examples | XOS client-safe state |
|---|---|
| draft, new, quote pending | Request received |
| awaiting payment, payment pending | Awaiting payment |
| approved, queued, scheduled | Confirmed |
| artwork, mockup, proof, client approval | Artwork & approval |
| production, printing, manufacturing | In production |
| quality control, packed, ready | Quality check / ready |
| dispatched, shipped, courier | On the way |
| delivered, complete, closed | Complete |
| hold, exception, blocked | Attention needed |

No enum, order row, or runtime display was changed.
