-- Device subscriptions and notification preferences for tenant-scoped web push.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  user_email text not null,
  endpoint text not null unique,
  auth text not null,
  p256dh text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_push_subscriptions_tenant_user on public.push_subscriptions (tenant_id, lower(user_email));

create table if not exists public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  user_email text not null,
  push_enabled boolean not null default true,
  assignment_alerts boolean not null default true,
  acknowledgement_alerts boolean not null default true,
  due_alerts boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_email)
);

alter table public.push_subscriptions enable row level security;
alter table public.notification_preferences enable row level security;

drop policy if exists users_manage_own_push_subscriptions on public.push_subscriptions;
create policy users_manage_own_push_subscriptions on public.push_subscriptions
  for all to authenticated
  using (lower(user_email) = lower(coalesce(auth.jwt() ->> 'email', '')) and public.can_access_tenant(tenant_id))
  with check (lower(user_email) = lower(coalesce(auth.jwt() ->> 'email', '')) and public.can_access_tenant(tenant_id));

drop policy if exists users_manage_own_notification_preferences on public.notification_preferences;
create policy users_manage_own_notification_preferences on public.notification_preferences
  for all to authenticated
  using (lower(user_email) = lower(coalesce(auth.jwt() ->> 'email', '')) and public.can_access_tenant(tenant_id))
  with check (lower(user_email) = lower(coalesce(auth.jwt() ->> 'email', '')) and public.can_access_tenant(tenant_id));