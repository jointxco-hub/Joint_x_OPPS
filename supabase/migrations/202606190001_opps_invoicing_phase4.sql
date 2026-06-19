-- OPPS invoicing Phase 4.
-- Additive only: persistent export/template settings and invoice activity history.

create table if not exists public.opps_invoice_export_settings (
  id uuid primary key default gen_random_uuid(),
  setting_key text unique not null,
  setting_value jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

drop trigger if exists trg_opps_invoice_export_settings_updated_at on public.opps_invoice_export_settings;
create trigger trg_opps_invoice_export_settings_updated_at
  before update on public.opps_invoice_export_settings
  for each row execute function public.opps_invoicing_touch_updated_at();

create table if not exists public.opps_invoice_activity (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references public.opps_invoices(id) on delete cascade,
  activity_type text not null,
  activity_label text not null,
  activity_note text,
  from_status text,
  to_status text,
  metadata jsonb default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);

create index if not exists idx_opps_invoice_activity_invoice_id_created_at
  on public.opps_invoice_activity(invoice_id, created_at desc);

create index if not exists idx_opps_invoice_export_settings_key
  on public.opps_invoice_export_settings(setting_key);

alter table public.opps_invoice_export_settings enable row level security;
alter table public.opps_invoice_activity enable row level security;

do $$
declare
  v_table_name text;
  v_policy_name text;
begin
  foreach v_table_name in array array[
    'opps_invoice_export_settings',
    'opps_invoice_activity'
  ]
  loop
    v_policy_name := 'finance_admin_manage_' || v_table_name;
    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = v_table_name
        and policyname = v_policy_name
    ) then
      execute format(
        'create policy %I on public.%I for all to authenticated using (public.is_app_admin() or public.user_finance_level() in (1, 2)) with check (public.is_app_admin() or public.user_finance_level() in (1, 2))',
        v_policy_name,
        v_table_name
      );
    end if;
  end loop;
end$$;
