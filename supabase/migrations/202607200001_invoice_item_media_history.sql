-- Persistent invoice-item media, client-specific reusable specifications, and audit history.
-- Additive only: existing invoice/order/payment workflows remain unchanged.

alter table public.opps_invoice_items
  add column if not exists line_key text,
  add column if not exists image_url text,
  add column if not exists specifications jsonb not null default '{}'::jsonb,
  add column if not exists proofs jsonb not null default '[]'::jsonb;

alter table public.opps_invoice_item_templates
  add column if not exists image_url text,
  add column if not exists specifications jsonb not null default '{}'::jsonb,
  add column if not exists proofs jsonb not null default '[]'::jsonb,
  add column if not exists current_version integer not null default 1;

create index if not exists idx_opps_invoice_items_line_key
  on public.opps_invoice_items(invoice_id, line_key);

create index if not exists idx_opps_invoice_item_templates_client_name
  on public.opps_invoice_item_templates(tenant_id, client_id, lower(name));

create table if not exists public.opps_invoice_item_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  client_id uuid references public.clients(id) on delete set null,
  invoice_id uuid references public.opps_invoices(id) on delete set null,
  invoice_item_template_id uuid references public.opps_invoice_item_templates(id) on delete set null,
  line_key text not null,
  version_number integer not null,
  change_reason text not null,
  snapshot jsonb not null default '{}'::jsonb,
  changed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_opps_invoice_item_versions_unique
  on public.opps_invoice_item_versions(tenant_id, line_key, version_number);

create index if not exists idx_opps_invoice_item_versions_client
  on public.opps_invoice_item_versions(tenant_id, client_id, created_at desc);

create index if not exists idx_opps_invoice_item_versions_invoice
  on public.opps_invoice_item_versions(invoice_id, created_at desc);

alter table public.opps_invoice_item_versions enable row level security;

drop policy if exists tenant_finance_manage_opps_invoice_item_versions on public.opps_invoice_item_versions;
create policy tenant_finance_manage_opps_invoice_item_versions
  on public.opps_invoice_item_versions for all to authenticated
  using ((public.is_app_admin() or public.user_finance_level() in (1, 2)) and public.can_access_tenant(tenant_id))
  with check ((public.is_app_admin() or public.user_finance_level() in (1, 2)) and public.can_access_tenant(tenant_id));

-- Existing reusable items are intentionally not guessed into client accounts.
-- They remain global until an invoice with a verified customer_id uses them; the
-- application then creates or updates the correct client-specific copy.
