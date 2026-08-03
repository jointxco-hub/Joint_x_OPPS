-- BOOTSTRAP-ONLY ROLLBACK - PROPOSED, UNEXECUTED.
-- Run only immediately after bootstrap-only validation, before repository
-- migrations. It intentionally refuses a database where tenant migrations ran.

begin;

do $$
begin
  if current_setting('opps.phase0a_disposable_bootstrap', true)
       is distinct from 'approved-local-only' then
    raise exception 'Disposable bootstrap guard is not enabled.';
  end if;
  if to_regclass('public.tenants') is not null then
    raise exception 'Repository migrations are present; bootstrap-only rollback refused.';
  end if;
end;
$$;

drop view public.v_purchase_orders;
drop view public.v_orders;
drop view public.active_orders;

alter table public.orders drop constraint orders_linked_po_legacy_fk;
drop table public.client_contract_acceptances;
drop table public.client_contract_templates;
drop table public.client_approvals;
drop table public.client_special_instructions;
drop table public.client_tech_packs;
drop table public.client_tech_pack_templates;
drop table public.client_profile_requests;
drop table public.client_messages;
drop table public.client_quote_requests;
drop table public.money_model_snapshots;
drop table public.client_assets;
drop table public.folders;
drop table public.tasks;
drop table public.ops_tasks;
drop table public.order_stage_history;
drop table public.order_exceptions;
drop table public.order_tags;
drop table public.order_stages;
drop table public.finance_buying_items;
drop table public.finance_budget_buckets;
drop table public.transactions;
drop table public.inventory;
drop table public.purchase_orders;
drop table public.suppliers;
drop table public.orders;
drop table public.projects;
drop table public.clients;
drop table public.users;

-- pgcrypto is shared Supabase infrastructure and is never removed here.
commit;


