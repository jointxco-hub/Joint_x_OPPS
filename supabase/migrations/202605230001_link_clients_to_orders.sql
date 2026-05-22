-- Link OPS orders to client accounts without duplicating files or storing heavy rollups.

alter table if exists public.clients
  add column if not exists brand_name text,
  add column if not exists whatsapp text,
  add column if not exists delivery_address text,
  add column if not exists status text default 'lead',
  add column if not exists total_orders integer not null default 0,
  add column if not exists total_revenue numeric(12, 2) not null default 0,
  add column if not exists last_activity_date date,
  add column if not exists portal_enabled boolean not null default false,
  add column if not exists xlab_auth_user_id uuid references auth.users(id) on delete set null,
  add column if not exists xlab_customer_id text;

alter table if exists public.orders
  add column if not exists client_id uuid references public.clients(id) on delete set null;

create index if not exists idx_clients_email_lower
  on public.clients (lower(trim(email)))
  where email is not null and trim(email) <> '';

create index if not exists idx_clients_name_lower
  on public.clients (lower(trim(name)));

create index if not exists idx_orders_client_id
  on public.orders (client_id);

create index if not exists idx_orders_client_email_lower
  on public.orders (lower(trim(client_email)))
  where client_email is not null and trim(client_email) <> '';

with ranked_matches as (
  select
    o.id as order_id,
    c.id as client_id,
    row_number() over (
      partition by o.id
      order by
        case
          when o.client_email is not null
            and c.email is not null
            and lower(trim(o.client_email)) = lower(trim(c.email))
          then 0
          else 1
        end,
        c.updated_at desc nulls last,
        c.created_at desc nulls last
    ) as match_rank
  from public.orders o
  join public.clients c
    on (
      o.client_email is not null
      and c.email is not null
      and lower(trim(o.client_email)) = lower(trim(c.email))
    )
    or (
      (o.client_email is null or trim(o.client_email) = '')
      and lower(trim(o.client_name)) = lower(trim(c.name))
    )
  where o.client_id is null
)
update public.orders o
set client_id = ranked_matches.client_id
from ranked_matches
where o.id = ranked_matches.order_id
  and ranked_matches.match_rank = 1;

with rollups as (
  select
    c.id as client_id,
    count(o.id)::integer as total_orders,
    coalesce(sum(o.total_amount), 0)::numeric(12, 2) as total_revenue,
    max(o.updated_at)::date as last_activity_date,
    case
      when count(o.id) = 0 then 'lead'
      when count(o.id) filter (where o.status in ('confirmed', 'in_production', 'ready', 'shipped')) > 0 then 'active'
      when count(o.id) filter (where o.status = 'delivered') > 0 then 'completed'
      else coalesce(c.status, 'lead')
    end as status
  from public.clients c
  left join public.orders o
    on o.client_id = c.id
    and coalesce(o.is_archived, false) = false
  group by c.id
)
update public.clients c
set
  total_orders = rollups.total_orders,
  total_revenue = rollups.total_revenue,
  last_activity_date = rollups.last_activity_date,
  status = rollups.status
from rollups
where c.id = rollups.client_id;
