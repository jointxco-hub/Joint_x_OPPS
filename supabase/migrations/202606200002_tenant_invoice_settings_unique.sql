-- Export settings are tenant-owned, so the setting key is only unique inside a tenant.

alter table public.opps_invoice_export_settings
  drop constraint if exists opps_invoice_export_settings_setting_key_key;

create unique index if not exists idx_opps_invoice_export_settings_tenant_key
  on public.opps_invoice_export_settings(tenant_id, setting_key);
