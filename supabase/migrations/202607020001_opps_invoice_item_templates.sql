-- Saved invoice line templates for repeat billing work.
-- Additive only: keeps invoice/order/payment workflows intact.

create table if not exists public.opps_invoice_item_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  name text not null,
  description text,
  item_type text default 'goods' check (item_type in ('goods', 'services')),
  unit text,
  rate numeric default 0,
  tax_name text,
  tax_percentage numeric default 0,
  account_name text,
  category text,
  client_id uuid references public.clients(id) on delete set null,
  catalog_item_id uuid,
  inventory_item_id uuid,
  metadata jsonb default '{}'::jsonb,
  usage_count integer not null default 0,
  last_used_at timestamptz,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.opps_invoice_items
  add column if not exists invoice_item_template_id uuid references public.opps_invoice_item_templates(id) on delete set null,
  add column if not exists catalog_item_id uuid,
  add column if not exists inventory_item_id uuid,
  add column if not exists source_metadata jsonb default '{}'::jsonb;

drop trigger if exists trg_opps_invoice_item_templates_updated_at on public.opps_invoice_item_templates;
create trigger trg_opps_invoice_item_templates_updated_at
  before update on public.opps_invoice_item_templates
  for each row execute function public.opps_invoicing_touch_updated_at();

create index if not exists idx_opps_invoice_item_templates_tenant_active
  on public.opps_invoice_item_templates(tenant_id, is_active, updated_at desc);

create index if not exists idx_opps_invoice_item_templates_tenant_name
  on public.opps_invoice_item_templates(tenant_id, lower(name));

create index if not exists idx_opps_invoice_items_template_id
  on public.opps_invoice_items(invoice_item_template_id);

alter table public.opps_invoice_item_templates enable row level security;

drop policy if exists tenant_finance_manage_opps_invoice_item_templates on public.opps_invoice_item_templates;
create policy tenant_finance_manage_opps_invoice_item_templates
  on public.opps_invoice_item_templates for all to authenticated
  using ((public.is_app_admin() or public.user_finance_level() in (1, 2)) and public.can_access_tenant(tenant_id))
  with check ((public.is_app_admin() or public.user_finance_level() in (1, 2)) and public.can_access_tenant(tenant_id));
