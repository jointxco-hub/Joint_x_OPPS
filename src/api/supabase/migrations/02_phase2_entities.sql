-- ════════════════════════════════════════════════════════════════════
--  Migration: phase2_entities
--  Run: Supabase Dashboard → SQL Editor → New query → paste → Run
--
--  Pre-flight requirements:
--    ✅ handle_updated_at() function exists   (defined in schema.sql)
--    ✅ public.orders table exists            (defined in schema.sql)
--    ✅ public.users  table exists            (defined in schema.sql)
--    ✅ public.clients, public.projects,
--       public.suppliers tables exist         (confirmed working in dataClient.js)
--
--  What this migration does:
--    Adds the 20+ tables the existing UI already calls via dataClient but
--    which currently fall through to the in-memory localStore (wiped on
--    every refresh). After running this, Goals, Roles, WeeklyTasks, SOPs,
--    QBRs, OnboardingFlows, CalendarEvents, and the full Order Pipeline
--    will all persist to Supabase.
--
--  RLS: OFF — matches Phase 1 pattern. Enable before go-live.
--  Safe to re-run: every statement uses IF NOT EXISTS / ON CONFLICT.
-- ════════════════════════════════════════════════════════════════════


-- ══════════════════════════════════════════════════════════════════
--  PART 1: 12-WEEK YEAR CORE TABLES
-- ══════════════════════════════════════════════════════════════════

-- 12-week cycles (company, team, or personal)
create table if not exists public.twelve_week_cycles (
  id            uuid primary key default gen_random_uuid(),
  scope         text not null check (scope in ('company','team','personal')),
  team_name     text,
  owner_email   text,
  cycle_number  int not null,
  start_date    date not null,
  end_date      date not null,
  status        text not null default 'active'
                check (status in ('draft','active','completed','archived')),
  created_at    timestamptz default now() not null,
  updated_at    timestamptz default now() not null
);
create trigger trg_cycles_updated_at before update on public.twelve_week_cycles
  for each row execute function handle_updated_at();
create index if not exists idx_cycles_status on public.twelve_week_cycles(status);
create index if not exists idx_cycles_scope  on public.twelve_week_cycles(scope);

-- Goals — dataClient.entities.Goal already reads/writes here
create table if not exists public.goals (
  id                uuid primary key default gen_random_uuid(),
  cycle_id          uuid references public.twelve_week_cycles(id) on delete set null,
  parent_goal_id    uuid references public.goals(id) on delete set null,
  scope             text not null default 'personal'
                    check (scope in ('company','team','personal')),
  is_north_star     boolean default false,
  team_name         text,
  title             text not null,
  description       text,
  assigned_to       text,
  status            text default 'active'
                    check (status in ('active','at_risk','off_track','completed','archived')),
  progress          int default 0 check (progress between 0 and 100),
  start_date        date,
  end_date          date,
  is_archived       boolean default false,
  archived_at       timestamptz,
  created_at        timestamptz default now() not null,
  updated_at        timestamptz default now() not null
);
create trigger trg_goals_updated_at before update on public.goals
  for each row execute function handle_updated_at();
create index if not exists idx_goals_cycle    on public.goals(cycle_id);
create index if not exists idx_goals_assigned on public.goals(assigned_to);

-- Only one company North Star per active cycle
create unique index if not exists uniq_company_north_star
  on public.goals (cycle_id)
  where is_north_star = true and scope = 'company';

-- KPIs hanging off goals (lead/lag indicators)
create table if not exists public.kpis (
  id              uuid primary key default gen_random_uuid(),
  goal_id         uuid not null references public.goals(id) on delete cascade,
  name            text not null,
  kind            text not null check (kind in ('lead','lag')),
  target_value    numeric not null,
  current_value   numeric default 0,
  unit            text,
  frequency       text default 'weekly'
                  check (frequency in ('daily','weekly','biweekly','monthly')),
  last_updated_at timestamptz default now(),
  created_at      timestamptz default now() not null
);
create index if not exists idx_kpis_goal on public.kpis(goal_id);

-- Weekly tactics — dataClient.entities.WeeklyTask reads/writes here
create table if not exists public.weekly_tasks (
  id              uuid primary key default gen_random_uuid(),
  cycle_id        uuid references public.twelve_week_cycles(id) on delete set null,
  goal_id         uuid references public.goals(id) on delete set null,
  week_number     int not null check (week_number between 1 and 12),
  day_of_week     text check (day_of_week in
                  ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')),
  title           text not null,
  description     text,
  assigned_to     text[] default '{}',
  status          text default 'not_started'
                  check (status in ('not_started','in_progress','complete','on_hold')),
  priority        text default 'medium' check (priority in ('low','medium','high')),
  completed_at    timestamptz,
  notes           text,
  created_at      timestamptz default now() not null,
  updated_at      timestamptz default now() not null
);
create trigger trg_weekly_tasks_updated_at before update on public.weekly_tasks
  for each row execute function handle_updated_at();
create index if not exists idx_weekly_tasks_week on public.weekly_tasks(cycle_id, week_number);

-- Weekly execution scores (one row per user per week per cycle)
create table if not exists public.weekly_scores (
  id                uuid primary key default gen_random_uuid(),
  cycle_id          uuid not null references public.twelve_week_cycles(id) on delete cascade,
  user_email        text not null,
  week_number       int not null check (week_number between 1 and 12),
  tactics_planned   int default 0,
  tactics_completed int default 0,
  score_percentage  numeric generated always as (
                      case when tactics_planned = 0 then 0
                           else round((tactics_completed::numeric / tactics_planned) * 100, 1)
                      end
                    ) stored,
  wins              text,
  lessons           text,
  next_week_focus   text,
  submitted_at      timestamptz,
  created_at        timestamptz default now() not null,
  unique (cycle_id, user_email, week_number)
);


-- ══════════════════════════════════════════════════════════════════
--  PART 2: ROLES & ORGANISATION
-- ══════════════════════════════════════════════════════════════════

-- Roles — dataClient.entities.Role / RolesManagement.jsx writes here
create table if not exists public.roles (
  id                  uuid primary key default gen_random_uuid(),
  key                 text unique,
  name                text not null,
  emoji               text,
  color               text,
  purpose             text,
  success_definition  text,
  inputs              text,
  outputs             text,
  tools               jsonb default '[]'::jsonb,
  responsibilities    jsonb default '[]'::jsonb,
  queen_bee_role      text,
  fourD_target        jsonb,
  criticality         text default 'support'
                      check (criticality in ('critical','support','optional')),
  supports_qbr        boolean default true,
  is_active           boolean default true,
  created_at          timestamptz default now() not null,
  updated_at          timestamptz default now() not null
);
create trigger trg_roles_updated_at before update on public.roles
  for each row execute function handle_updated_at();

-- User ↔ Role mapping (one person can hold multiple roles)
create table if not exists public.user_roles (
  id           uuid primary key default gen_random_uuid(),
  user_email   text not null,
  role_key     text not null references public.roles(key) on delete cascade,
  is_primary   boolean default false,
  assigned_at  timestamptz default now() not null,
  unique (user_email, role_key)
);
create index if not exists idx_user_roles_email on public.user_roles(user_email);


-- ══════════════════════════════════════════════════════════════════
--  PART 3: OPERATIONAL TABLES
-- ══════════════════════════════════════════════════════════════════

-- QBR log — dataClient.entities.QBR / Operations.jsx reads here
create table if not exists public.qbrs (
  id            uuid primary key default gen_random_uuid(),
  user_email    text,
  role_key      text references public.roles(key),
  date          date not null default current_date,
  qbr_done      boolean default false,
  note          text,
  is_active     boolean default true,
  created_at    timestamptz default now() not null
);
create index if not exists idx_qbrs_user_date on public.qbrs(user_email, date desc);

-- Time allocation (4D mix — Clockwork framework)
create table if not exists public.time_allocations (
  id          uuid primary key default gen_random_uuid(),
  user_email  text not null,
  bucket      text not null check (bucket in ('doing','deciding','delegating','designing')),
  minutes     int not null,
  note        text,
  logged_at   timestamptz default now() not null
);
create index if not exists idx_time_alloc_user on public.time_allocations(user_email, logged_at desc);

-- SOPs — dataClient.entities.SOP / Operations.jsx SOPs tab reads here
create table if not exists public.sops (
  id                   uuid primary key default gen_random_uuid(),
  title                text not null,
  description          text,
  role_key             text references public.roles(key),
  owner_email          text,
  criticality          text default 'support'
                       check (criticality in ('critical','support','optional')),
  body                 text,
  video_url            text,
  last_verified_date   date,
  is_active            boolean default true,
  created_at           timestamptz default now() not null,
  updated_at           timestamptz default now() not null
);
create trigger trg_sops_updated_at before update on public.sops
  for each row execute function handle_updated_at();

-- Onboarding flows — dataClient.entities.OnboardingFlow reads here
create table if not exists public.onboarding_flows (
  id                       uuid primary key default gen_random_uuid(),
  user_email               text not null,
  role_key                 text references public.roles(key),
  status                   text default 'in_progress'
                           check (status in ('in_progress','complete','paused','cancelled')),
  completion_percentage    int default 0 check (completion_percentage between 0 and 100),
  started_at               timestamptz default now(),
  completed_at             timestamptz,
  created_at               timestamptz default now() not null,
  updated_at               timestamptz default now() not null
);
create trigger trg_onboarding_updated_at before update on public.onboarding_flows
  for each row execute function handle_updated_at();


-- ══════════════════════════════════════════════════════════════════
--  PART 4: CALENDAR EVENTS
-- ══════════════════════════════════════════════════════════════════

-- Calendar events — unifies tactics, drops, WAMs, production milestones
create table if not exists public.calendar_events (
  id              uuid primary key default gen_random_uuid(),
  owner_email     text,
  scope           text not null default 'personal'
                  check (scope in ('company','team','personal')),
  team_name       text,
  category        text not null check (category in
                    ('production','marketing','ops','wam','drop',
                     'milestone','tactic','personal','content_shoot')),
  reference_id    uuid,
  reference_type  text,
  title           text not null,
  description     text,
  start_at        timestamptz not null,
  end_at          timestamptz,
  all_day         boolean default false,
  color           text,
  recurring_rule  text,
  status          text default 'scheduled'
                  check (status in ('scheduled','done','cancelled')),
  created_at      timestamptz default now() not null,
  updated_at      timestamptz default now() not null
);
create trigger trg_events_updated_at before update on public.calendar_events
  for each row execute function handle_updated_at();
create index if not exists idx_events_range on public.calendar_events(start_at, end_at);
create index if not exists idx_events_owner on public.calendar_events(owner_email);


-- ══════════════════════════════════════════════════════════════════
--  PART 5: ORDER PIPELINE
--  NOTE: order_stages is seeded HERE (before the ALTER TABLE) so
--  that the DEFAULT 'received' FK reference is immediately valid.
-- ══════════════════════════════════════════════════════════════════

-- Detailed 13-stage pipeline (keeps existing orders.status enum untouched)
create table if not exists public.order_stages (
  key          text primary key,
  display_name text not null,
  sequence     int not null,
  is_exception boolean default false,
  color        text,
  sla_hours    int,
  legacy_status text check (legacy_status in
                ('confirmed','in_production','ready','shipped','delivered','cancelled'))
);

-- Seed order_stages BEFORE the ALTER TABLE so DEFAULT 'received' is valid
insert into public.order_stages (key, display_name, sequence, is_exception, color, sla_hours, legacy_status) values
  ('received',                 'Order received',          1,  false, '#94A3B8', 2,    'confirmed'),
  ('payment_pending',          'Awaiting payment',        2,  false, '#F59E0B', 24,   'confirmed'),
  ('paid',                     'Paid',                    3,  false, '#10B981', 4,    'confirmed'),
  ('design_in_progress',       'Designing',               4,  false, '#A855F7', 48,   'in_production'),
  ('design_pending_approval',  'Customer approval',       5,  false, '#EAB308', 72,   'in_production'),
  ('design_approved',          'Design approved',         6,  false, '#10B981', 4,    'in_production'),
  ('materials_check',          'Checking materials',      7,  false, '#3B82F6', 8,    'in_production'),
  ('production',               'In production',           8,  false, '#3B82F6', 96,   'in_production'),
  ('qa',                       'Quality check',           9,  false, '#3B82F6', 12,   'in_production'),
  ('ready_to_ship',            'Ready to ship',           10, false, '#10B981', 24,   'ready'),
  ('shipped',                  'Shipped',                 11, false, '#10B981', null, 'shipped'),
  ('delivered',                'Delivered',               12, false, '#10B981', null, 'delivered'),
  ('complete',                 'Complete',                13, false, '#475569', null, 'delivered'),
  ('materials_delayed',        'Materials delayed',       99, true,  '#EF4444', null, 'in_production'),
  ('design_revision_requested','Revision requested',      99, true,  '#F59E0B', null, 'in_production'),
  ('qa_failed',                'QA failed',               99, true,  '#EF4444', null, 'in_production'),
  ('customer_complaint',       'Customer complaint',      99, true,  '#EF4444', null, null),
  ('payment_failed',           'Payment failed',          99, true,  '#EF4444', null, null)
on conflict (key) do nothing;

-- Add pipeline columns to orders — 'received' is now safe as default
alter table public.orders add column if not exists pipeline_stage text
  references public.order_stages(key) default 'received';
alter table public.orders add column if not exists current_tags jsonb default '[]'::jsonb;

-- Stage → role auto-tag rules
create table if not exists public.stage_role_rules (
  id        uuid primary key default gen_random_uuid(),
  stage_key text references public.order_stages(key) on delete cascade,
  role_key  text references public.roles(key) on delete cascade,
  action    text not null default 'tag'
            check (action in ('tag','assign','notify','escalate')),
  unique (stage_key, role_key, action)
);

-- Order-level tags (open until resolved by stage change)
create table if not exists public.order_tags (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  role_key    text references public.roles(key),
  user_email  text,
  action      text not null,
  reason      text not null,
  context     jsonb,
  resolved_at timestamptz,
  resolved_by text,
  created_at  timestamptz default now() not null
);
create index if not exists idx_order_tags_role on public.order_tags(role_key) where resolved_at is null;
create index if not exists idx_order_tags_user on public.order_tags(user_email) where resolved_at is null;

-- Full stage transition history
create table if not exists public.order_stage_history (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  from_stage  text references public.order_stages(key),
  to_stage    text references public.order_stages(key) not null,
  changed_by  text,
  note        text,
  changed_at  timestamptz default now() not null
);
create index if not exists idx_stage_history_order on public.order_stage_history(order_id, changed_at desc);

-- Exception flags (materials_delayed, qa_failed, etc.)
create table if not exists public.order_exceptions (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references public.orders(id) on delete cascade,
  exception_type text not null references public.order_stages(key),
  severity       text default 'medium' check (severity in ('low','medium','high','critical')),
  description    text,
  raised_by      text,
  resolved_at    timestamptz,
  resolved_by    text,
  created_at     timestamptz default now() not null
);
create index if not exists idx_exceptions_order on public.order_exceptions(order_id);


-- ══════════════════════════════════════════════════════════════════
--  PART 6: BOOK FRAMEWORK TABLES (Hormozi)
-- ══════════════════════════════════════════════════════════════════

create table if not exists public.offer_scores (
  id                    uuid primary key default gen_random_uuid(),
  offer_key             text unique not null,
  offer_name            text not null,
  dream_outcome         int check (dream_outcome between 1 and 10),
  perceived_likelihood  int check (perceived_likelihood between 1 and 10),
  time_delay            int check (time_delay between 1 and 10),
  effort_sacrifice      int check (effort_sacrifice between 1 and 10),
  notes                 text,
  scored_at             timestamptz default now() not null
);

create table if not exists public.money_model_snapshots (
  id              uuid primary key default gen_random_uuid(),
  offer_key       text references public.offer_scores(offer_key) on delete cascade,
  period_start    date not null,
  period_end      date not null,
  units_sold      int default 0,
  revenue         numeric default 0,
  cogs            numeric default 0,
  ad_spend        numeric default 0,
  cac             numeric generated always as (
                    case when units_sold = 0 then 0 else ad_spend / units_sold end
                  ) stored,
  gross_profit    numeric generated always as (revenue - cogs) stored,
  payback_days    int,
  ltv_estimate    numeric,
  notes           text,
  created_at      timestamptz default now() not null
);
create index if not exists idx_money_model_offer on public.money_model_snapshots(offer_key);


-- ══════════════════════════════════════════════════════════════════
--  PART 7: FILE MANAGEMENT (v3 §22.4)
--  ClientAsset and Folder are in v2's §2.4 entity list — they need
--  tables before dataClient can route to Supabase.
-- ══════════════════════════════════════════════════════════════════

create table if not exists public.folders (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  color        text default 'slate',
  parent_id    uuid references public.folders(id) on delete cascade,
  client_id    uuid references public.clients(id) on delete set null,
  project_id   uuid references public.projects(id) on delete set null,
  order_id     uuid references public.orders(id) on delete set null,
  created_by   text,
  is_archived  boolean default false,
  archived_at  timestamptz,
  created_at   timestamptz default now() not null,
  updated_at   timestamptz default now() not null
);
create trigger trg_folders_updated_at before update on public.folders
  for each row execute function handle_updated_at();
create index if not exists idx_folders_client  on public.folders(client_id);
create index if not exists idx_folders_project on public.folders(project_id);
create index if not exists idx_folders_order   on public.folders(order_id);

create table if not exists public.client_assets (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  file_url        text not null,
  file_type       text,
  file_size       bigint,
  folder_id       uuid references public.folders(id) on delete set null,
  client_id       uuid references public.clients(id) on delete set null,
  order_id        uuid references public.orders(id) on delete set null,
  project_id      uuid references public.projects(id) on delete set null,
  uploaded_by     text,
  approval_status text default 'pending'
                  check (approval_status in ('pending','approved','needs_revision','rejected')),
  tags            text[] default '{}',
  notes           text,
  is_archived     boolean default false,
  archived_at     timestamptz,
  created_at      timestamptz default now() not null,
  updated_at      timestamptz default now() not null
);
create trigger trg_client_assets_updated_at before update on public.client_assets
  for each row execute function handle_updated_at();
create index if not exists idx_assets_folder  on public.client_assets(folder_id);
create index if not exists idx_assets_client  on public.client_assets(client_id);
create index if not exists idx_assets_order   on public.client_assets(order_id);


-- ══════════════════════════════════════════════════════════════════
--  PART 8: VIEWS & HELPER FUNCTIONS
-- ══════════════════════════════════════════════════════════════════

-- Single company North Star for the active cycle
create or replace view public.v_company_north_star as
select g.*, c.start_date as cycle_start, c.end_date as cycle_end, c.cycle_number
from public.goals g
join public.twelve_week_cycles c on c.id = g.cycle_id
where g.scope = 'company' and g.is_north_star = true and c.status = 'active'
order by c.start_date desc
limit 1;

-- Founder Dependency Score (Built to Sell metric)
create or replace view public.v_founder_dependency_score as
with last_30 as (
  select
    (select count(*) from public.order_tags
       where role_key = 'founder' and created_at > now() - interval '30 days') as founder_tags,
    (select count(*) from public.order_tags
       where created_at > now() - interval '30 days') as total_tags
)
select
  case when total_tags = 0 then 0
       else round((founder_tags::numeric / total_tags) * 100, 1)
  end as score_pct,
  founder_tags, total_tags
from last_30;

-- Current week number within a cycle (1–12, clamped)
create or replace function public.current_week_number(cycle uuid)
returns int language sql stable as $$
  select greatest(1, least(12,
    floor(extract(epoch from (now() - c.start_date::timestamptz)) / (7*24*3600))::int + 1
  ))
  from public.twelve_week_cycles c where c.id = cycle;
$$;


-- ══════════════════════════════════════════════════════════════════
--  PART 9: SEEDS
-- ══════════════════════════════════════════════════════════════════

-- 7 Joint_X roles (on conflict: update meta fields, preserve existing data)
insert into public.roles (key, name, emoji, color, purpose, queen_bee_role, fourD_target, criticality, supports_qbr)
values
  ('cx',          'Customer Experience & Invoicing', '💬', '#10B981',
   'Be the human voice of Joint_X and gate clean order intake.',
   'Inquiry-to-Order conversion',
   '{"doing":60,"deciding":15,"delegating":15,"designing":10}'::jsonb, 'critical', true),
  ('designer',    'Graphic Designer',                '🎨', '#A855F7',
   'Turn every order into print-ready, on-brand assets.',
   'Print-ready file delivery',
   '{"doing":70,"deciding":10,"delegating":5,"designing":15}'::jsonb,  'critical', true),
  ('photo',       'Visual Content Producer',         '📸', '#F97316',
   'Capture content that sells — clients and Joint_X.',
   'Drop-day capture',
   '{"doing":70,"deciding":10,"delegating":5,"designing":15}'::jsonb,  'support',  true),
  ('runner',      'Logistics & Field Ops',            '🏃', '#EAB308',
   'Keep production unblocked by moving physical things on time.',
   'On-time material runs',
   '{"doing":90,"deciding":5,"delegating":0,"designing":5}'::jsonb,    'support',  true),
  ('ops_manager', 'Operations Manager',              '⚙️', '#3B82F6',
   'Own the production pipeline end-to-end.',
   'Pipeline throughput',
   '{"doing":30,"deciding":30,"delegating":30,"designing":10}'::jsonb, 'critical', true),
  ('social',      'Social Media Manager',            '📱', '#EC4899',
   'Compound brand attention and convert it to demand.',
   'Weekly publishing cadence',
   '{"doing":60,"deciding":15,"delegating":10,"designing":15}'::jsonb, 'support',  true),
  ('founder',     'Founder / Operator',              '🚀', '#EF4444',
   'Build the business that runs without you.',
   'Closing deals + designing the system',
   '{"doing":10,"deciding":30,"delegating":30,"designing":30}'::jsonb, 'critical', true)
on conflict (key) do update set
  name           = excluded.name,
  emoji          = excluded.emoji,
  color          = excluded.color,
  purpose        = excluded.purpose,
  queen_bee_role = excluded.queen_bee_role,
  fourD_target   = excluded.fourD_target;

-- Stage → role auto-tag rules
insert into public.stage_role_rules (stage_key, role_key, action) values
  ('received',                  'designer',    'tag'),
  ('received',                  'ops_manager', 'tag'),
  ('payment_pending',           'cx',          'tag'),
  ('paid',                      'ops_manager', 'assign'),
  ('paid',                      'designer',    'assign'),
  ('design_in_progress',        'designer',    'assign'),
  ('design_pending_approval',   'cx',          'notify'),
  ('design_approved',           'ops_manager', 'assign'),
  ('materials_check',           'ops_manager', 'tag'),
  ('materials_check',           'runner',      'tag'),
  ('production',                'ops_manager', 'assign'),
  ('qa',                        'ops_manager', 'assign'),
  ('ready_to_ship',             'runner',      'tag'),
  ('ready_to_ship',             'cx',          'tag'),
  ('shipped',                   'cx',          'tag'),
  ('delivered',                 'cx',          'tag'),
  ('delivered',                 'social',      'tag'),
  ('delivered',                 'photo',       'tag'),
  ('complete',                  'founder',     'tag'),
  ('materials_delayed',         'ops_manager', 'escalate'),
  ('materials_delayed',         'runner',      'escalate'),
  ('materials_delayed',         'founder',     'escalate'),
  ('design_revision_requested', 'designer',    'tag'),
  ('design_revision_requested', 'cx',          'tag'),
  ('qa_failed',                 'ops_manager', 'escalate'),
  ('qa_failed',                 'designer',    'escalate'),
  ('customer_complaint',        'cx',          'escalate'),
  ('customer_complaint',        'founder',     'escalate'),
  ('payment_failed',            'cx',          'tag')
on conflict (stage_key, role_key, action) do nothing;

-- First company cycle (deterministic UUID so re-runs are idempotent)
insert into public.twelve_week_cycles (id, scope, cycle_number, start_date, end_date, status)
values (
  '00000000-0000-0000-0000-000000000c01'::uuid,
  'company', 1,
  current_date,
  current_date + interval '83 days',
  'active'
)
on conflict (id) do nothing;

-- Company North Star (only inserts if none exists yet)
insert into public.goals (cycle_id, scope, is_north_star, title, description, progress)
select
  '00000000-0000-0000-0000-000000000c01'::uuid,
  'company', true,
  'Ship 500 X1 packs and reach R750k revenue',
  'Single company 12 Week Year goal — everything cascades to this.',
  0
where not exists (
  select 1 from public.goals where is_north_star = true and scope = 'company'
);

-- Lock jointx.co@gmail.com as admin from day 0
insert into public.users (user_email, full_name, role, is_active)
values ('jointx.co@gmail.com', 'Founder', 'admin', true)
on conflict (user_email) do update set role = 'admin';


-- ══════════════════════════════════════════════════════════════════
--  PART 10: BUSINESS LOGIC TRIGGERS
-- ══════════════════════════════════════════════════════════════════

-- Auto-tag roles when an order's pipeline_stage changes
create or replace function public.auto_tag_on_stage_change()
returns trigger language plpgsql as $$
declare rule record;
begin
  if (tg_op = 'INSERT') or (new.pipeline_stage is distinct from old.pipeline_stage) then

    -- Log the transition
    insert into public.order_stage_history (order_id, from_stage, to_stage)
    values (
      new.id,
      case when tg_op = 'INSERT' then null else old.pipeline_stage end,
      new.pipeline_stage
    );

    -- Resolve all open tags from the previous stage
    update public.order_tags
       set resolved_at = now()
     where order_id = new.id and resolved_at is null;

    -- Create new tags per rule
    for rule in
      select role_key, action from public.stage_role_rules where stage_key = new.pipeline_stage
    loop
      insert into public.order_tags (order_id, role_key, action, reason, context)
      values (
        new.id,
        rule.role_key,
        rule.action,
        'auto:stage_change',
        jsonb_build_object(
          'stage',      new.pipeline_stage,
          'from_stage', case when tg_op = 'INSERT' then null else old.pipeline_stage end
        )
      );
    end loop;

    -- Snapshot open tags onto the order row for fast reads
    update public.orders set current_tags = (
      select coalesce(jsonb_agg(distinct role_key), '[]'::jsonb)
      from public.order_tags
      where order_id = new.id and resolved_at is null
    ) where id = new.id;

  end if;
  return new;
end;
$$;

drop trigger if exists trg_auto_tag_orders on public.orders;
create trigger trg_auto_tag_orders
  after insert or update of pipeline_stage on public.orders
  for each row execute function public.auto_tag_on_stage_change();

-- Sync weekly_tasks → calendar_events when day_of_week is set
create or replace function public.sync_weekly_task_to_event()
returns trigger language plpgsql as $$
declare
  evt_start timestamptz;
  map_day   int;
begin
  if new.day_of_week is null or new.cycle_id is null then return new; end if;

  select case new.day_of_week
    when 'monday'    then 1
    when 'tuesday'   then 2
    when 'wednesday' then 3
    when 'thursday'  then 4
    when 'friday'    then 5
    when 'saturday'  then 6
    when 'sunday'    then 7
  end into map_day;

  select c.start_date::timestamptz
       + ((new.week_number - 1) * 7 + (map_day - 1)) * interval '1 day'
    into evt_start
  from public.twelve_week_cycles c where c.id = new.cycle_id;

  if tg_op = 'INSERT' then
    insert into public.calendar_events
      (owner_email, scope, category, reference_id, reference_type,
       title, start_at, end_at, all_day, status)
    values (
      coalesce(new.assigned_to[1], null), 'personal', 'tactic',
      new.id, 'weekly_task',
      new.title, evt_start, evt_start, true, 'scheduled'
    );
  elsif tg_op = 'UPDATE' then
    update public.calendar_events set
      title    = new.title,
      start_at = evt_start,
      end_at   = evt_start,
      status   = case when new.status = 'complete' then 'done' else 'scheduled' end
    where reference_id = new.id and reference_type = 'weekly_task';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_weekly_task_event on public.weekly_tasks;
create trigger trg_sync_weekly_task_event
  after insert or update on public.weekly_tasks
  for each row execute function public.sync_weekly_task_to_event();


-- ════════════════════════════════════════════════════════════════════
--  RLS (Phase 1: disabled — enable before go-live)
-- ════════════════════════════════════════════════════════════════════
-- alter table public.goals enable row level security;
-- alter table public.weekly_tasks enable row level security;
-- alter table public.roles enable row level security;
-- ... (enable per table when cross-app RLS audit is complete)
-- ════════════════════════════════════════════════════════════════════
