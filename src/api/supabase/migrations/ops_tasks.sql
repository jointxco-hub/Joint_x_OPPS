-- ════════════════════════════════════════════════════════════════════
--  Migration: ops_tasks
--  Run: Supabase Dashboard → SQL Editor → New query → paste → Run
--
--  Pre-flight requirements (both must be true before running):
--    ✅ handle_updated_at() function exists  (confirmed via pg_proc check)
--    ✅ public.orders table exists           (referenced by order_id FK)
--
--  RLS: OFF — matches Phase 1 pattern in schema.sql.
--       Enable and add policies before go-live.
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.ops_tasks (
  id                  uuid primary key default gen_random_uuid(),

  -- Core content
  title               text not null,
  description         text,

  -- OpsTask-specific classification.
  -- Intentionally separate from public.tasks — status values are different.
  production_type     text check (production_type in (
                        'single', 'bulk', 'x1_sample_pack', 'alethea'
                      )),
  production_stage    text check (production_stage in (
                        'design', 'sourcing', 'sampling', 'cutting',
                        'printing', 'pressing', 'finishing', 'packing',
                        'delivery', 'other'
                      )),

  -- Status enum — different from public.tasks on purpose
  status              text not null default 'not_started'
                        check (status in (
                          'not_started', 'in_progress', 'on_hold',
                          'complete', 'archived'
                        )),
  priority            text not null default 'medium'
                        check (priority in ('low', 'medium', 'high', 'urgent')),

  -- Scheduling
  start_date          date,
  deadline            date,           -- form field due_date is serialized → deadline
  week_number         integer check (week_number between 1 and 53),
  day_of_week         text check (day_of_week in (
                        'monday', 'tuesday', 'wednesday', 'thursday',
                        'friday', 'saturday', 'sunday'
                      )),

  -- Assignment (text[] of user emails — mirrors orders.assigned_team pattern)
  assigned_to         text[] not null default '{}',

  -- Relations
  -- order_id: hard FK (orders table exists)
  -- client_id, project_id, alethea_project_id: soft UUIDs (tables not yet created)
  order_id            uuid references public.orders(id) on delete set null,
  client_id           uuid,
  client_name         text,
  project_id          uuid,           -- future FK: projects
  alethea_project_id  uuid,           -- future FK: alethea_projects

  -- Content
  deliverables        text,
  notes               text,

  -- JSONB arrays (mirrors tasks.comments pattern)
  supporting_files    jsonb not null default '[]',  -- [{name, url, type}]
  subtasks            jsonb not null default '[]',
  comments            jsonb not null default '[]',  -- [{id, author_email, author_name, text, created_at}]

  -- Timestamps
  created_at          timestamptz default now() not null,
  updated_at          timestamptz default now() not null
);

-- Auto-update updated_at on every row change (function already exists)
create trigger trg_ops_tasks_updated_at
  before update on public.ops_tasks
  for each row execute function handle_updated_at();

-- Indexes covering the four main query shapes used in OpsCalendar
create index if not exists idx_ops_tasks_status      on public.ops_tasks(status);
create index if not exists idx_ops_tasks_deadline    on public.ops_tasks(deadline);
create index if not exists idx_ops_tasks_week_number on public.ops_tasks(week_number);
create index if not exists idx_ops_tasks_order_id    on public.ops_tasks(order_id);

comment on table public.ops_tasks is
  'Ops Calendar work items — production, team, and communication tasks.';

-- ════════════════════════════════════════════════════════════════════
--  RLS (Phase 1: disabled — enable before go-live)
-- ════════════════════════════════════════════════════════════════════
-- alter table public.ops_tasks enable row level security;
--
-- Example policy (allow authenticated users full access):
-- create policy "Authenticated users can manage ops_tasks"
--   on public.ops_tasks for all
--   to authenticated
--   using (true)
--   with check (true);
-- ════════════════════════════════════════════════════════════════════
