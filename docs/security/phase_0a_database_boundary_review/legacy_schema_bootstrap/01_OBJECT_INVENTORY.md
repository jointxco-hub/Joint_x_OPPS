# Legacy Bootstrap Object Inventory

## Bootstrap-created relations

All column definitions, primary keys, defaults, and nullable boundaries are enumerated in file 02. `Confirmed` means the object or named columns were observed in checked-in SQL or the finalized redacted remote audit. `Inferred` means only the minimum compile/test shape is known.

| Object | Type | Why required | Source | Missing from chain | Decision |
| --- | --- | --- | --- | --- | --- |
| `public.users` | table | Role helpers, admin trigger, test admin profile | Checked-in SQL; remote helper audit | Yes | Create inferred minimum |
| `public.clients` | table | Orders, request RPCs, invoice and project parents | Checked-in SQL | Yes | Create inferred minimum |
| `public.projects` | table | `v_orders`, purchasing guard, task/file ownership | Checked-in SQL; remote view audit | Yes | Create inferred minimum |
| `public.orders` | table | Core Phase 0A views, RLS and ordinary-operation tests | Checked-in SQL; confirmed 25/33-column view contracts | Yes | Create minimum contract shape |
| `public.suppliers` | table | Purchasing trigger, PO view, inventory preferred supplier | Confirmed remote audit; checked-in SQL | Yes | Create confirmed minimum plus inferred nullable metadata |
| `public.inventory` | table | Purchasing trigger and ordinary-operation tests | Checked-in SQL; redacted inventory audit | Yes | Create inferred Phase 0A minimum only |
| `public.purchase_orders` | table | PO tests and confirmed 16-column view | Confirmed remote audit plus incomplete checked-in create | Partially | Pre-create minimum confirmed shape |
| `public.transactions` | table | Finance migration, readiness RPC, tenant reporting | Checked-in SQL | Yes | Create inferred minimum later migrations extend |
| `public.finance_budget_buckets`, `public.finance_buying_items` | tables | Finance RLS file sorts before the finance create file | Exact checked-in create definitions | Ordering gap | Pre-create exact checked-in shapes |
| `public.tasks`, `public.ops_tasks` | tables | Tenant work-item migration and accountability FK | Checked-in SQL | Yes | Create inferred minimum |
| `public.folders`, `public.client_assets` | tables | Tenant file-metadata migration | Checked-in SQL | Yes | Create inferred minimum |
| `public.order_stages` | table | Merch detail-stage seed/upsert | Checked-in SQL | Yes | Create inferred minimum |
| `public.order_tags` | table | Tenant support migration and founder report view | Checked-in SQL | Yes | Create inferred minimum |
| `public.order_exceptions`, `public.order_stage_history` | tables | Dynamic tenant support migration | Checked-in SQL | Yes | Create inferred minimum |
| `public.money_model_snapshots` | table | Tenant finance loop and policy | Checked-in SQL | Yes | Create inferred minimum |
| `public.client_quote_requests` | table | Internal/XOS request functions and checked-in demo migration | Checked-in SQL | Yes | Create inferred minimum |
| `public.client_messages` | table | Internal reply and XOS request functions | Checked-in SQL | Yes | Create inferred minimum |
| `public.client_profile_requests` | table | Internal/XOS request functions | Checked-in SQL | Yes | Create inferred minimum |
| `public.client_tech_pack_templates`, `public.client_tech_packs` | tables | Readiness and request functions | Checked-in SQL | Yes | Create inferred minimum |
| `public.client_special_instructions`, `public.client_approvals` | tables | Readiness and request functions | Checked-in SQL | Yes | Create inferred minimum |
| `public.client_contract_templates`, `public.client_contract_acceptances` | tables | Readiness and request functions | Checked-in SQL | Yes | Create inferred minimum |
| `public.active_orders` | view | Phase 0A preflight and compatibility contract | Confirmed remote catalog definition | Yes | Create exact 25-column contract |
| `public.v_orders` | view | Phase 0A preflight and compatibility contract | Confirmed remote catalog definition | Yes | Create exact 33-column contract |
| `public.v_purchase_orders` | view | Phase 0A preflight and compatibility contract | Confirmed remote catalog definition | Yes | Create exact 16-column contract |

## Bootstrap-created constraints and indexes

- Primary keys: every bootstrap table uses its named `id` UUID primary key except `order_stages`, whose primary key is `key`.
- Unique constraints: `orders.order_number`, `purchase_orders.po_number`, and `order_tags(order_id, role_key)`.
- Check constraints: supplier type is deliberately not constrained because the remote expression was not captured; `order_stages.key` and required identity columns are non-null.
- Foreign keys are limited to compile-safe, unambiguous parents in file 02. Cross-links that would introduce order/PO cycles are left to reviewed repository or future reconciliation migrations.
- Indexes created here: `idx_legacy_orders_status`, `idx_legacy_orders_project_id`, `idx_legacy_purchase_orders_supplier_id`, `idx_legacy_inventory_preferred_supplier`, and `idx_legacy_transactions_order_id`.

## Intentionally reproduced pre-remediation grants

The three legacy views receive `ALL PRIVILEGES` for `anon`, `authenticated`, and `service_role`. These grants are intentionally insecure test state, clearly isolated behind the disposable guard. Phase 0A must revoke them and restore only authenticated/service-role SELECT.

No underlying legacy table is granted to `anon` by the bootstrap.

## Left to checked-in migrations or Supabase

| Objects | Owner |
| --- | --- |
| `auth.users`, `auth.uid()`, JWT helpers, `anon`, `authenticated`, `service_role`, storage schemas | Local Supabase baseline |
| `pgcrypto` | Bootstrap verifies/creates extension; never removed by rollback |
| `products`, purchase-order patch columns, readiness checks, client file tables | Existing migrations |
| Invoice, tenant, domain, WhatsApp, notification, accountability, expense attachment, and invoice-template tables | Existing migrations |
| Tenant columns/indexes/triggers/RLS policies on legacy tables | Existing tenant migrations |
| RLS helper functions, purchasing helper, storefront RPC | Existing migrations, then hardened by Phase 0A |
| `income`, `expenses`, `v_founder_dependency_score` | Existing migrations |

## Absent object categories

- Sequences: none; UUID defaults are used.
- Enums and domains: none required by the confirmed contracts.
- Bootstrap policies: none. Policies are installed by checked-in migrations.
- Bootstrap triggers/functions: none. The staged validation confirms the checked-in chain installs the required helpers and triggers.



