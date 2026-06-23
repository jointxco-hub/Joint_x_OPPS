-- Named work ownership and lightweight operating reports.
alter table public.orders
  add column if not exists assigned_to text,
  add column if not exists assigned_to_name text,
  add column if not exists assigned_at timestamptz,
  add column if not exists acknowledged_at timestamptz;

create index if not exists idx_orders_assigned_to_active
  on public.orders (tenant_id, assigned_to)
  where coalesce(is_archived, false) = false;

create table if not exists public.opps_work_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  order_id uuid references public.orders(id) on delete cascade,
  task_id uuid references public.ops_tasks(id) on delete cascade,
  user_email text not null,
  user_name text,
  acknowledged_at timestamptz not null default now(),
  note text,
  check (num_nonnulls(order_id, task_id) = 1)
);

create unique index if not exists opps_work_ack_order_user_unique
  on public.opps_work_acknowledgements (order_id, lower(user_email)) where order_id is not null;
create unique index if not exists opps_work_ack_task_user_unique
  on public.opps_work_acknowledgements (task_id, lower(user_email)) where task_id is not null;

create table if not exists public.opps_activity_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  actor_email text not null,
  actor_name text,
  event_type text not null,
  entity_type text not null,
  entity_id uuid,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_opps_activity_events_tenant_created
  on public.opps_activity_events (tenant_id, created_at desc);

create table if not exists public.opps_work_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  user_email text not null,
  user_name text,
  role_key text,
  report_type text not null check (report_type in ('daily', 'weekly')),
  period_start date not null,
  wins text,
  priorities text,
  blockers text,
  support_needed text,
  metrics jsonb not null default '{}'::jsonb,
  submitted_at timestamptz not null default now(),
  unique (user_email, report_type, period_start)
);

alter table public.opps_work_acknowledgements enable row level security;
alter table public.opps_activity_events enable row level security;
alter table public.opps_work_reports enable row level security;

drop policy if exists tenant_members_manage_work_acknowledgements on public.opps_work_acknowledgements;
create policy tenant_members_manage_work_acknowledgements on public.opps_work_acknowledgements
  for all to authenticated using (public.can_access_tenant(tenant_id)) with check (public.can_access_tenant(tenant_id));

drop policy if exists tenant_members_read_work_activity on public.opps_activity_events;
create policy tenant_members_read_work_activity on public.opps_activity_events
  for select to authenticated using (public.can_access_tenant(tenant_id));
drop policy if exists tenant_members_create_work_activity on public.opps_activity_events;
create policy tenant_members_create_work_activity on public.opps_activity_events
  for insert to authenticated with check (public.can_access_tenant(tenant_id));

drop policy if exists tenant_members_manage_work_reports on public.opps_work_reports;
create policy tenant_members_manage_work_reports on public.opps_work_reports
  for all to authenticated using (public.can_access_tenant(tenant_id)) with check (public.can_access_tenant(tenant_id));