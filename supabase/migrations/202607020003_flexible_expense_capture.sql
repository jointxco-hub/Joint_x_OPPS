-- Expand OPPS expense capture beyond supplier-only production purchases.
-- Additive and nullable so existing transactions and supplier expenses keep working.

alter table public.transactions
  add column if not exists vendor_id uuid references public.suppliers(id) on delete set null,
  add column if not exists paid_to_name text,
  add column if not exists expense_type text default 'supplier_purchase',
  add column if not exists status text default 'captured',
  add column if not exists paid_by text,
  add column if not exists link_type text default 'none',
  add column if not exists linked_client_id uuid references public.clients(id) on delete set null,
  add column if not exists linked_project_id uuid references public.projects(id) on delete set null,
  add column if not exists linked_order_id uuid references public.orders(id) on delete set null,
  add column if not exists linked_invoice_id uuid,
  add column if not exists linked_production_job_id uuid references public.ops_tasks(id) on delete set null,
  add column if not exists is_reimbursable boolean default false,
  add column if not exists reimbursement_status text default 'not_reimbursable',
  add column if not exists is_client_recoverable boolean default false,
  add column if not exists recovery_status text default 'not_recoverable',
  add column if not exists attachment_paths text[] default '{}',
  add column if not exists capture_source text default 'full_form',
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by text;

update public.transactions
set
  paid_to_name = coalesce(paid_to_name, vendor),
  expense_type = coalesce(expense_type, 'supplier_purchase'),
  status = coalesce(status, case when approval_status = 'approved' then 'approved' when approval_status = 'submitted' then 'captured' else 'captured' end),
  link_type = coalesce(link_type, case when order_id is not null then 'order' when project_id is not null then 'project' when client_id is not null then 'client' else 'none' end),
  linked_client_id = coalesce(linked_client_id, client_id),
  linked_project_id = coalesce(linked_project_id, project_id),
  linked_order_id = coalesce(linked_order_id, order_id),
  recovery_status = coalesce(recovery_status, case when is_client_recoverable then 'recoverable' else 'not_recoverable' end),
  reimbursement_status = coalesce(reimbursement_status, case when is_reimbursable then 'pending' else 'not_reimbursable' end),
  capture_source = coalesce(capture_source, 'full_form')
where type = 'expense';

do $$
declare constraint_name text;
begin
  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.transactions'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%expense_category%'
  loop
    execute format('alter table public.transactions drop constraint %I', constraint_name);
  end loop;
end$$;

alter table public.transactions
  add constraint transactions_expense_category_check
  check (expense_category is null or expense_category in (
    'unsorted', 'production', 'raw_materials', 'packaging', 'shipping',
    'transport', 'petty_cash', 'marketing', 'software', 'rent_utilities',
    'wages', 'admin', 'owner_drawings'
  ));

do $$
declare constraint_name text;
begin
  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.transactions'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%payment_method%'
  loop
    execute format('alter table public.transactions drop constraint %I', constraint_name);
  end loop;
end$$;

alter table public.transactions
  add constraint transactions_payment_method_check
  check (payment_method is null or payment_method in ('cash', 'card', 'eft', 'credit', 'bank_transfer', 'paypal', 'other'));

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'transactions_expense_type_check') then
    alter table public.transactions add constraint transactions_expense_type_check
    check (expense_type is null or expense_type in (
      'supplier_purchase', 'transport', 'petty_cash', 'staff_runner', 'courier',
      'airtime_data', 'office', 'production', 'client_related', 'other'
    ));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'transactions_expense_status_check') then
    alter table public.transactions add constraint transactions_expense_status_check
    check (status is null or status in ('draft', 'captured', 'needs_review', 'approved', 'rejected', 'reimbursed', 'archived'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'transactions_expense_link_type_check') then
    alter table public.transactions add constraint transactions_expense_link_type_check
    check (link_type is null or link_type in ('none', 'client', 'project', 'order', 'invoice', 'production_job'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'transactions_expense_recovery_status_check') then
    alter table public.transactions add constraint transactions_expense_recovery_status_check
    check (recovery_status is null or recovery_status in ('not_recoverable', 'recoverable', 'billed', 'credited', 'written_off'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'transactions_expense_reimbursement_status_check') then
    alter table public.transactions add constraint transactions_expense_reimbursement_status_check
    check (reimbursement_status is null or reimbursement_status in ('not_reimbursable', 'pending', 'submitted', 'reimbursed', 'rejected'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'transactions_expense_capture_source_check') then
    alter table public.transactions add constraint transactions_expense_capture_source_check
    check (capture_source is null or capture_source in ('full_form', 'quick_capture', 'mobile_camera', 'upload'));
  end if;
end$$;

create table if not exists public.expense_attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete restrict,
  expense_id uuid references public.transactions(id) on delete cascade,
  capture_id uuid,
  file_id uuid,
  storage_path text not null,
  filename text,
  mime_type text,
  uploaded_by text,
  created_at timestamptz default now() not null,
  constraint expense_attachments_owner_check check (expense_id is not null or capture_id is not null)
);

update public.expense_attachments
set tenant_id = (select id from public.tenants where slug = 'joint-x')
where tenant_id is null;

create index if not exists idx_transactions_expense_status on public.transactions(type, status);
create index if not exists idx_transactions_expense_type on public.transactions(type, expense_type);
create index if not exists idx_transactions_expense_recovery on public.transactions(type, recovery_status);
create index if not exists idx_transactions_expense_vendor_id on public.transactions(vendor_id);
create index if not exists idx_transactions_linked_client on public.transactions(linked_client_id);
create index if not exists idx_transactions_linked_project on public.transactions(linked_project_id);
create index if not exists idx_transactions_linked_order on public.transactions(linked_order_id);
create index if not exists idx_expense_attachments_tenant on public.expense_attachments(tenant_id);
create index if not exists idx_expense_attachments_expense on public.expense_attachments(expense_id);

alter table public.expense_attachments enable row level security;

drop policy if exists tenant_expense_attachments_access on public.expense_attachments;
create policy tenant_expense_attachments_access
  on public.expense_attachments for all to authenticated
  using (public.can_access_tenant(tenant_id))
  with check (public.can_access_tenant(tenant_id));

create or replace view public.expenses with (security_invoker = true) as
select * from public.transactions where type = 'expense';
