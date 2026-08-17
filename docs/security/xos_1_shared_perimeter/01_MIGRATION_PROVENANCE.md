# Migration baseline reconciliation

Captured read-only on 2026-08-17. Canonical Git contained 78 migration files; live `supabase_migrations.schema_migrations` contained 76 entries. Existing history was not edited or repaired.

## Structural hazards

- Git has duplicate version prefixes `20260523` and `202606020001`.
- Two Git files are remote-history placeholders (`20260428`, `20260501`), not original deployed SQL.
- Several same-purpose migrations have different local/live timestamps.
- Therefore a full canonical `db reset` is not a trustworthy production-schema reproduction. XOS 1 uses fresh unique versions and a focused sanitized disposable bootstrap.

## Git-only exact entries

- `20260428_remote_history_placeholder`
- `20260501_remote_history_placeholder`
- `20260523_finance_upgrade`
- `20260523_finance_rls_tighten`
- `202606020001_xlab_order_payment_health_columns` (live purpose recorded at `202606020002`)
- `202608080001_client_order_asset_folder_provisioning` (live `20260808204956`)
- `202608080002_client_file_library_refinement` (live `20260809081602`)
- `202608050003_order_products_lock` (live `20260807212706`)
- `202608020001_invoice_item_atomic_persistence` (live `20260807223140`)
- local order-primary-image entry whose live version/name encoding differs
- quote-approval regression guard/order lookup, hide-draft-requests, X LAB orders-awaiting-payment, X LAB quote-approval, and four inventory migrations with no exact live metadata match.

## Live-only exact entries

- `20260428_add_rls_read_policies`
- `20260501_xlab_page_templates_write_policy`
- `202605230002_customer_account_portal`
- `202605230003_fix_customer_account_file_types`
- the differently timestamped equivalents listed above
- `202607040001_business_registry_foundation`
- `202607090001_managed_client_workspaces`
- `202607210001_social_studio_mvp`
- `20260809083448_xlab_payfast_payment_state`
- `20260810080733_opps_mirror_xlab_source_guard`
- `20260810135206_202608100001_order_primary_image`
- `20260811071656_202608100002_order_product_line_identity`

Source copies for several live-only changes exist in adjacent local project/deployment folders, but were not imported or rewritten. The PayFast migration was inventoried only and remains untouched.

## Sequencing decision

The package starts at `20260817173001`, after every observed live entry, and uses four unique monotonically increasing versions. Every migration is additive or replaces only a current helper/policy contract; no table data or production migration metadata is mutated.
