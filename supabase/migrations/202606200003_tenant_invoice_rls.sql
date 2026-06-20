-- Enforce tenant membership for all tenant-owned invoice records.
-- The invoicing UI now scopes every create/read path before this policy change.

do $$
declare
  v_table_name text;
  v_legacy_policy_name text;
  v_tenant_policy_name text;
begin
  foreach v_table_name in array array[
    'opps_invoices',
    'opps_invoice_items',
    'opps_invoice_exports',
    'opps_invoice_export_settings',
    'opps_invoice_activity'
  ]
  loop
    v_legacy_policy_name := 'finance_admin_manage_' || v_table_name;
    v_tenant_policy_name := 'tenant_finance_manage_' || v_table_name;

    execute format('drop policy if exists %I on public.%I', v_legacy_policy_name, v_table_name);
    execute format('drop policy if exists %I on public.%I', v_tenant_policy_name, v_table_name);
    execute format(
      'create policy %I on public.%I for all to authenticated using ((public.is_app_admin() or public.user_finance_level() in (1, 2)) and public.can_access_tenant(tenant_id)) with check ((public.is_app_admin() or public.user_finance_level() in (1, 2)) and public.can_access_tenant(tenant_id))',
      v_tenant_policy_name,
      v_table_name
    );
  end loop;
end$$;
