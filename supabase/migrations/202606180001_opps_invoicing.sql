-- OPPS invoicing foundation.
-- Additive only: creates isolated invoice tables, a race-safe invoice number RPC,
-- and finance/admin-only RLS policies.

create extension if not exists "pgcrypto";

create or replace function public.opps_invoicing_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.opps_invoice_number_sequences (
  year integer primary key,
  last_number integer not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

drop trigger if exists trg_opps_invoice_number_sequences_updated_at on public.opps_invoice_number_sequences;
create trigger trg_opps_invoice_number_sequences_updated_at
  before update on public.opps_invoice_number_sequences
  for each row execute function public.opps_invoicing_touch_updated_at();

create table if not exists public.opps_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text unique not null,
  customer_id uuid,
  customer_name text not null,
  customer_email text,
  customer_phone text,
  customer_billing_address text,
  source_order_id uuid,
  invoice_date date not null,
  due_date date,
  payment_terms text,
  currency_code text default 'ZAR',
  status text default 'draft'
    check (status in ('draft', 'approved', 'exported', 'imported_to_zoho', 'paid', 'partially_paid', 'overdue', 'void')),
  reference_number text,
  salesperson_name text,
  subtotal numeric default 0,
  discount_total numeric default 0,
  shipping_charge numeric default 0,
  adjustment numeric default 0,
  tax_total numeric default 0,
  total numeric default 0,
  amount_paid numeric default 0,
  balance_due numeric default 0,
  notes text,
  terms text,
  internal_notes text,
  zoho_exported_at timestamptz,
  zoho_imported_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

drop trigger if exists trg_opps_invoices_updated_at on public.opps_invoices;
create trigger trg_opps_invoices_updated_at
  before update on public.opps_invoices
  for each row execute function public.opps_invoicing_touch_updated_at();

create table if not exists public.opps_invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references public.opps_invoices(id) on delete cascade,
  line_number integer not null,
  item_name text not null,
  item_description text,
  item_type text default 'goods' check (item_type in ('goods', 'services')),
  quantity numeric not null,
  unit text,
  rate numeric not null,
  discount numeric default 0,
  tax_name text,
  tax_percentage numeric default 0,
  account_name text,
  item_total numeric not null,
  source_order_item_id uuid,
  created_at timestamptz default now()
);

create table if not exists public.opps_invoice_exports (
  id uuid primary key default gen_random_uuid(),
  export_type text not null default 'zoho_books_invoices',
  exported_by uuid references auth.users(id) on delete set null,
  exported_at timestamptz default now(),
  invoice_count integer default 0,
  row_count integer default 0,
  date_from date,
  date_to date,
  status text default 'created',
  file_name text,
  file_path text,
  checksum text,
  notes text,
  export_filters jsonb default '{}'::jsonb,
  template_version text
);

create index if not exists idx_opps_invoices_status on public.opps_invoices(status);
create index if not exists idx_opps_invoices_invoice_date on public.opps_invoices(invoice_date);
create index if not exists idx_opps_invoices_customer_name on public.opps_invoices(customer_name);
create index if not exists idx_opps_invoices_source_order_id on public.opps_invoices(source_order_id);
create index if not exists idx_opps_invoice_items_invoice_id on public.opps_invoice_items(invoice_id);
create index if not exists idx_opps_invoice_exports_exported_at on public.opps_invoice_exports(exported_at);

create or replace function public.next_opps_invoice_number()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  invoice_year integer := extract(year from now())::integer;
  next_number integer;
begin
  insert into public.opps_invoice_number_sequences (year, last_number)
  values (invoice_year, 1)
  on conflict (year) do update
    set last_number = public.opps_invoice_number_sequences.last_number + 1,
        updated_at = now()
  returning last_number into next_number;

  return 'OPPS-INV-' || invoice_year::text || '-' || lpad(next_number::text, 4, '0');
end;
$$;

grant execute on function public.next_opps_invoice_number() to authenticated;
revoke execute on function public.next_opps_invoice_number() from anon;

alter table public.opps_invoice_number_sequences enable row level security;
alter table public.opps_invoices enable row level security;
alter table public.opps_invoice_items enable row level security;
alter table public.opps_invoice_exports enable row level security;

do $$
declare
  v_table_name text;
  v_policy_name text;
begin
  foreach v_table_name in array array[
    'opps_invoice_number_sequences',
    'opps_invoices',
    'opps_invoice_items',
    'opps_invoice_exports'
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
