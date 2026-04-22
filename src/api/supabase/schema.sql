-- ═══════════════════════════════════════════════════════════════════
--  SUPABASE DATABASE SCHEMA  —  Phase 1 Foundation
--  File: supabase/schema.sql
--
--  HOW TO RUN:
--    Supabase Dashboard → SQL Editor → New query → paste → Run
--
--  RULES:
--    ✅ This only CREATES new tables — nothing in Base44 is touched.
--    ✅ Run it on a fresh Supabase project (dev/staging first).
--    ✅ All tables use UUID primary keys and created_at / updated_at.
--    🚫 Do NOT run on a production DB that already has data until
--       you are ready for the full migration phase.
-- ═══════════════════════════════════════════════════════════════════


-- ── Extensions ───────────────────────────────────────────────────────
-- Required for gen_random_uuid() on older Postgres versions.
-- Supabase projects already have this enabled, but it is idempotent.
create extension if not exists "pgcrypto";


-- ── Helper: auto-update updated_at on every row change ───────────────
create or replace function handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;


-- ════════════════════════════════════════════════════════════════════
--  1. USERS  (maps to Base44 TeamMember entity)
--     Stores internal team members with roles / departments.
--     NOTE: This is separate from Supabase Auth users (auth.users).
--           Link via auth_user_id when you are ready to add login.
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.users (
  id              uuid primary key default gen_random_uuid(),

  -- Optionally link to a Supabase Auth user (nullable during migration)
  auth_user_id    uuid references auth.users(id) on delete set null,

  -- Core identity (mirrors TeamMember entity)
  user_email      text not null unique,
  full_name       text not null,
  role            text,                             -- e.g. "Head of Production"
  department      text check (department in (
                    'production', 'design', 'sales',
                    'operations', 'management', 'other'
                  )) default 'production',
  phone           text,
  avatar_url      text,
  bio             text,
  skills          text[]    default '{}',           -- array of skill strings
  is_active       boolean   default true,

  -- Timestamps
  created_at      timestamptz default now() not null,
  updated_at      timestamptz default now() not null
);

create trigger trg_users_updated_at
  before update on public.users
  for each row execute function handle_updated_at();

comment on table public.users is
  'Internal team members. Mirrors Base44 TeamMember entity.';


-- ════════════════════════════════════════════════════════════════════
--  2. ORDERS  (maps to Base44 Order entity)
--     Core business record — customer orders flowing from
--     X LAB / X1 Sample Pack into OPPS.
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.orders (
  id                    uuid primary key default gen_random_uuid(),

  -- Client info
  client_name           text not null,
  client_email          text,
  client_phone          text,

  -- Order identity
  order_number          text not null unique,

  -- Status workflow
  status                text not null default 'confirmed'
                          check (status in (
                            'confirmed', 'in_production', 'ready',
                            'shipped', 'delivered', 'cancelled'
                          )),
  priority              text not null default 'normal'
                          check (priority in ('low', 'normal', 'high', 'urgent')),

  -- Line items stored as JSONB  [{name, quantity, price, size, color}]
  products              jsonb default '[]',

  -- Financials
  total_amount          numeric(12, 2) default 0,
  deposit_paid          numeric(12, 2) default 0,

  -- Production details
  print_type            text check (print_type in (
                          'dtf', 'vinyl', 'embroidery', 'screen', 'none'
                        )),
  special_instructions  text,
  notes                 text,
  due_date              date,

  -- Shipping
  courier               text,
  tracking_number       text,

  -- File attachments (array of URLs)
  file_urls             text[] default '{}',

  -- Team assignment (array of user emails — mirrors Base44 behaviour)
  assigned_team         text[] default '{}',

  -- Relations
  linked_po_id          uuid,                        -- future: FK to purchase_orders

  -- Soft-delete / archiving (mirrors Base44 is_archived pattern)
  is_archived           boolean   default false,
  archived_at           timestamptz,
  archived_by           text,                        -- email of archiver

  -- Source tracking (helpful for multi-store setup)
  source                text default 'opps'          -- 'opps' | 'xlab' | 'x1_sample'
                          check (source in ('opps', 'xlab', 'x1_sample')),

  -- Timestamps
  created_at            timestamptz default now() not null,
  updated_at            timestamptz default now() not null
);

create trigger trg_orders_updated_at
  before update on public.orders
  for each row execute function handle_updated_at();

-- Indexes for the most common query patterns
create index if not exists idx_orders_status      on public.orders(status);
create index if not exists idx_orders_client_name on public.orders(client_name);
create index if not exists idx_orders_due_date    on public.orders(due_date);
create index if not exists idx_orders_is_archived on public.orders(is_archived);
create index if not exists idx_orders_source      on public.orders(source);

comment on table public.orders is
  'Customer orders. Mirrors Base44 Order entity. Receives data from X LAB and X1 Sample Pack.';


-- ════════════════════════════════════════════════════════════════════
--  3. TASKS  (maps to Base44 Task entity)
--     Work items linked to orders and assigned to team members.
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.tasks (
  id                uuid primary key default gen_random_uuid(),

  -- Content
  title             text not null,
  description       text,

  -- Assignment
  assigned_to       text,                            -- user email
  assigned_to_name  text,
  assigned_user_id  uuid references public.users(id) on delete set null,

  -- Scheduling
  deadline          date,
  week_number       integer,

  -- Status & Priority
  status            text not null default 'pending'
                      check (status in ('pending', 'in_progress', 'done', 'overdue')),
  priority          text not null default 'medium'
                      check (priority in ('low', 'medium', 'high', 'urgent')),

  -- Classification
  department        text check (department in (
                      'operations', 'design', 'production',
                      'sales', 'finance', 'admin'
                    )),

  -- Relations
  linked_order_id   uuid references public.orders(id) on delete set null,
  linked_goal_id    uuid,                            -- future: FK to goals table

  -- Attachments & comments (JSONB for flexibility, mirrors Base44)
  file_urls         text[]  default '{}',
  comments          jsonb   default '[]',            -- [{author, text, timestamp}]

  -- Soft-delete
  is_archived       boolean     default false,
  archived_at       timestamptz,
  archived_by       text,

  -- Timestamps
  created_at        timestamptz default now() not null,
  updated_at        timestamptz default now() not null
);

create trigger trg_tasks_updated_at
  before update on public.tasks
  for each row execute function handle_updated_at();

create index if not exists idx_tasks_status         on public.tasks(status);
create index if not exists idx_tasks_assigned_to    on public.tasks(assigned_to);
create index if not exists idx_tasks_linked_order   on public.tasks(linked_order_id);
create index if not exists idx_tasks_is_archived    on public.tasks(is_archived);

comment on table public.tasks is
  'Work tasks linked to orders and team members. Mirrors Base44 Task entity.';


-- ════════════════════════════════════════════════════════════════════
--  4. INVENTORY  (maps to Base44 InventoryItem entity)
--     Raw materials, blanks, consumables, packaging stock.
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.inventory (
  id                    uuid primary key default gen_random_uuid(),

  -- Identity
  name                  text not null,
  sku                   text unique,

  -- Classification
  category              text not null
                          check (category in (
                            'tees', 'hoodies', 'sweaters', 'bottoms',
                            'headwear', 'accessories', 'vinyl', 'dtf_materials',
                            'embroidery_materials', 'ink', 'labels',
                            'packaging', 'other'
                          )),

  -- Stock levels
  current_stock         numeric(12, 3) default 0,
  unit                  text default 'pieces'
                          check (unit in ('meters', 'pieces', 'rolls', 'liters')),
  reorder_point         numeric(12, 3),
  reorder_quantity      numeric(12, 3),
  last_reorder_date     date,

  -- Garment-specific (nullable for non-garment items)
  sizes_available       text[] default '{}',
  colors_available      text[] default '{}',

  -- Pricing
  cost_price            numeric(12, 2),
  selling_price         numeric(12, 2),

  -- Relations
  preferred_supplier_id uuid,                        -- future: FK to suppliers
  location              text,

  -- Soft-delete
  is_archived           boolean     default false,
  archived_at           timestamptz,

  -- Timestamps
  created_at            timestamptz default now() not null,
  updated_at            timestamptz default now() not null
);

create trigger trg_inventory_updated_at
  before update on public.inventory
  for each row execute function handle_updated_at();

create index if not exists idx_inventory_category    on public.inventory(category);
create index if not exists idx_inventory_is_archived on public.inventory(is_archived);

comment on table public.inventory is
  'Stock items — blanks, materials, consumables. Mirrors Base44 InventoryItem entity.';


-- ════════════════════════════════════════════════════════════════════
--  5. TRANSACTIONS  (unified table for Base44 Payment + Expense)
--     A single table with type = 'income' | 'expense' keeps finance
--     reporting simple.  All original fields from both entities are
--     preserved; columns that don't apply to a given type are NULL.
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.transactions (
  id              uuid primary key default gen_random_uuid(),

  -- Which side of the ledger
  type            text not null
                    check (type in ('income', 'expense')),

  -- ── INCOME fields (mirrors Base44 Payment entity) ─────────────
  order_id        uuid references public.orders(id) on delete set null,
  order_number    text,
  client_name     text,
  invoice_number  text,
  payment_date    date,
  payment_status  text check (payment_status in (
                    'pending', 'completed', 'failed', 'refunded'
                  )),
  payment_method  text check (payment_method in (
                    'cash', 'card', 'eft', 'bank_transfer', 'paypal', 'other'
                  )),
  tax_amount      numeric(12, 2) default 0,
  is_offline      boolean default false,
  synced          boolean default true,

  -- ── EXPENSE fields (mirrors Base44 Expense entity) ────────────
  expense_date    date,
  vendor          text,
  expense_category text check (expense_category in (
                    'production', 'raw_materials', 'packaging', 'shipping',
                    'marketing', 'software', 'rent_utilities', 'wages',
                    'admin', 'owner_drawings'
                  )),
  vat_type        text check (vat_type in ('vatable', 'zero_rated', 'non_vat')),
  vat_amount      numeric(12, 2) default 0,
  receipt_urls    text[] default '{}',
  project_id      uuid,                              -- future: FK to projects
  client_id       uuid,                              -- future: FK to clients

  -- ── SHARED fields ─────────────────────────────────────────────
  amount          numeric(12, 2) not null,
  notes           text,

  -- Timestamps
  created_at      timestamptz default now() not null,
  updated_at      timestamptz default now() not null
);

create trigger trg_transactions_updated_at
  before update on public.transactions
  for each row execute function handle_updated_at();

create index if not exists idx_transactions_type       on public.transactions(type);
create index if not exists idx_transactions_order_id   on public.transactions(order_id);
create index if not exists idx_transactions_payment_date on public.transactions(payment_date);

comment on table public.transactions is
  'Unified ledger: income (Base44 Payment) and expenses (Base44 Expense).';


-- ════════════════════════════════════════════════════════════════════
--  CONVENIENCE VIEWS
-- ════════════════════════════════════════════════════════════════════

-- Active (non-archived) orders only
create or replace view public.active_orders as
  select * from public.orders where is_archived = false;

-- Active tasks only
create or replace view public.active_tasks as
  select * from public.tasks where is_archived = false;

-- Income transactions only
create or replace view public.income as
  select * from public.transactions where type = 'income';

-- Expense transactions only
create or replace view public.expenses as
  select * from public.transactions where type = 'expense';


-- ════════════════════════════════════════════════════════════════════
--  ROW LEVEL SECURITY  (Phase 1: disabled — enable before go-live)
-- ════════════════════════════════════════════════════════════════════
-- Leave RLS OFF during Phase 1 so you can test CRUD freely
-- with the anon key.  Before production, enable and write policies:
--
-- alter table public.orders     enable row level security;
-- alter table public.tasks      enable row level security;
-- alter table public.users      enable row level security;
-- alter table public.inventory  enable row level security;
-- alter table public.transactions enable row level security;
--
-- Example policy (allow authenticated users to read orders):
-- create policy "Authenticated users can read orders"
--   on public.orders for select
--   to authenticated
--   using (true);
-- ════════════════════════════════════════════════════════════════════
