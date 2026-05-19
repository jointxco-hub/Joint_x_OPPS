# OPPS Upgrade — v2 (aligned to your real codebase)
**For Alethea Brand OS™ / Joint_X — Hand to Claude Code**

> This supersedes v1. v1 was written without seeing the project. After reading the real `Joint_x_OPPS` zip, most of the conceptual scaffolding is already there — pages, sidebar entries, basic data flows. The real problem is narrower than I thought, and so is the fix.

---

## 0. The actual root cause (read this first)

Every page in the app uses `dataClient.entities.{X}.list()` etc. Inside `src/api/dataClient.js`, only **12** entities are mapped to Supabase tables:

```
Client, Project, Order, Task, OpsTask, InventoryItem,
User, TeamMember, Supplier, PurchaseOrder, Payment, Expense
```

But the codebase already calls **20 more entities** that aren't mapped:

```
AletheaPhase, AletheaProject, AletheaStep, AletheaTask,
BugReport, CatalogItem, ClientAsset, ClientOrder, FileComment,
Folder, Goal, Idea, Invoice, OnboardingFlow, QBR, Role,
SOP, SOPVersion, SOPVideo, WeeklyTask
```

When code calls e.g. `dataClient.entities.Goal.list()`, the `createEntityApi` function detects `ENTITY_CONFIG.Goal` is missing and falls through to `handleLocalEntity`, which warns once in the console:

> `[dataClient] Goal is not in the current Supabase Phase 1 schema. Using local fallback only.`

…and stores rows in an in-memory `localStore = new Map()` that is **wiped on every refresh.**

That's why:
- `My Hub` shows goals/weekly tasks but they vanish.
- `RolesManagement` lets you create roles that disappear.
- `Operations` page's QBR / SOPs / Onboarding tabs read empty arrays.
- `WeeklyCalendar` (the existing 12-week view) doesn't persist anything.

**Everything else is fine.** The pages, components, sidebar wiring, auth, query layer (`@tanstack/react-query`), shadcn/ui design system — all good.

So the v2 plan is: **persist the missing entities, then upgrade — don't replace — the surfaces.**

---

## 1. What changes vs. v1

| v1 said | v2 says (because of the actual code) |
|---|---|
| Build new `MyHubPage`, `MyHub.jsx` | Extend the existing `src/pages/UserDashboard.jsx` (already labeled "My Hub" in `Layout.jsx`) |
| Build new `OpsCalendarPage` + `TwelveWeekView` | Rebuild `src/pages/OpsCalendar.jsx` in place, add a `TwelveWeekView` mode alongside its existing `calendar` and `list` modes |
| Create new tables `twelve_week_goals`, `kpis`, `tactics` | Use existing tables `goals`, `weekly_tasks` — extend them with the missing columns |
| Invent `roles` table from scratch | Use existing `roles` table that `RolesManagement.jsx` already targets — extend it |
| New `OrdersKanban` page | Add a Kanban *view mode* to existing `src/pages/Orders.jsx` (keep list view as default) |
| Replace order status enum | Keep existing `confirmed/in_production/ready/shipped/delivered` for backward compat, ADD a new `pipeline_stage` column for the 13-stage detailed flow |
| New routes `/opps/hub`, `/opps/calendar` | The app uses `/UserDashboard`, `/OpsCalendar` already — don't touch routing |

The shape of v1's ideas is right. The naming and integration approach was wrong.

---

## 2. Phase 0 — Persist the missing entities (the unblocker)

Until this phase ships, no other work matters. Goals, roles, weekly tasks, etc. will keep evaporating.

### 2.1 The migration

Create `src/api/supabase/migrations/02_phase2_entities.sql`. Use the same conventions as the existing `ops_tasks.sql` migration (no RLS yet, `handle_updated_at()` trigger, etc.).

```sql
-- ════════════════════════════════════════════════════════════════════
--  Migration: phase2_entities
--  Adds the tables the existing UI already expects but currently fall
--  back to in-memory storage. RLS deliberately OFF — match Phase 1 pattern.
-- ════════════════════════════════════════════════════════════════════

-- 12 Week Year cycles
create table if not exists public.twelve_week_cycles (
  id            uuid primary key default gen_random_uuid(),
  scope         text not null check (scope in ('company','team','personal')),
  team_name     text,
  owner_email   text,                       -- mirrors users.user_email
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

-- Goals (the existing UI calls dataClient.entities.Goal — backed by THIS table)
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
  assigned_to       text,                   -- email — matches existing UI
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
create index if not exists idx_goals_cycle on public.goals(cycle_id);
create index if not exists idx_goals_assigned on public.goals(assigned_to);

-- Only one company North Star per active cycle
create unique index if not exists uniq_company_north_star
  on public.goals (cycle_id)
  where is_north_star = true and scope = 'company';

-- KPIs hanging off goals (lead/lag from §15.x of the original spec)
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

-- WeeklyTask (existing UI calls dataClient.entities.WeeklyTask)
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

-- Weekly Execution Score (computed nightly OR live from weekly_tasks)
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

-- Roles (existing RolesManagement.jsx writes to this — extend with QBR/4D/color)
create table if not exists public.roles (
  id                  uuid primary key default gen_random_uuid(),
  key                 text unique,                 -- 'cx','designer','photo','runner','ops_manager','social','founder'
  name                text not null,
  emoji               text,
  color               text,
  purpose             text,                        -- existing field
  success_definition  text,                        -- existing
  inputs              text,                        -- existing
  outputs             text,                        -- existing
  tools               jsonb default '[]'::jsonb,   -- existing
  responsibilities    jsonb default '[]'::jsonb,   -- new
  queen_bee_role      text,                        -- new (Clockwork QBR)
  fourD_target        jsonb,                       -- new {doing,deciding,delegating,designing}
  criticality         text default 'support'
                      check (criticality in ('critical','support','optional')),
  supports_qbr        boolean default true,        -- existing
  is_active           boolean default true,
  created_at          timestamptz default now() not null,
  updated_at          timestamptz default now() not null
);
create trigger trg_roles_updated_at before update on public.roles
  for each row execute function handle_updated_at();

-- One person can hold multiple roles, one is primary
create table if not exists public.user_roles (
  user_email   text not null,
  role_key     text not null references public.roles(key) on delete cascade,
  is_primary   boolean default false,
  assigned_at  timestamptz default now() not null,
  primary key (user_email, role_key)
);

-- QBR (existing Operations.jsx queries dataClient.entities.QBR)
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

-- Time allocation (4D mix — used by Clockwork dashboard)
create table if not exists public.time_allocations (
  id          uuid primary key default gen_random_uuid(),
  user_email  text not null,
  bucket      text not null check (bucket in ('doing','deciding','delegating','designing')),
  minutes     int not null,
  note        text,
  logged_at   timestamptz default now() not null
);
create index if not exists idx_time_alloc_user on public.time_allocations(user_email, logged_at desc);

-- SOPs (Operations + SOPLibrary + SOPEditor all read this)
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

-- Onboarding flows
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

-- Calendar events (unify production milestones, drops, WAMs, marketing posts)
create table if not exists public.calendar_events (
  id              uuid primary key default gen_random_uuid(),
  owner_email     text,
  scope           text not null default 'personal'
                  check (scope in ('company','team','personal')),
  team_name       text,
  category        text not null check (category in
                    ('production','marketing','ops','wam','drop',
                     'milestone','tactic','personal','content_shoot')),
  reference_id    uuid,                              -- e.g. weekly_task.id
  reference_type  text,                              -- 'weekly_task' | 'order' | 'goal' | null
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

-- =============================================================
-- ORDER PIPELINE EXTENSIONS
-- =============================================================

-- Detailed pipeline stages — keeps existing orders.status enum alone
create table if not exists public.order_stages (
  key          text primary key,
  display_name text not null,
  sequence     int not null,
  is_exception boolean default false,
  color        text,
  sla_hours    int,
  -- Maps to the simpler 5-stage existing flow used in OrderDrawer.jsx
  legacy_status text check (legacy_status in
                ('confirmed','in_production','ready','shipped','delivered','cancelled'))
);

-- Add pipeline_stage to orders WITHOUT removing status (back-compat)
alter table public.orders add column if not exists pipeline_stage text
  references public.order_stages(key) default 'received';
alter table public.orders add column if not exists current_tags jsonb default '[]'::jsonb;

-- Stage → role rules
create table if not exists public.stage_role_rules (
  id        uuid primary key default gen_random_uuid(),
  stage_key text references public.order_stages(key) on delete cascade,
  role_key  text references public.roles(key) on delete cascade,
  action    text not null default 'tag'
            check (action in ('tag','assign','notify','escalate')),
  unique (stage_key, role_key, action)
);

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

create table if not exists public.order_stage_history (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  from_stage  text references public.order_stages(key),
  to_stage    text references public.order_stages(key) not null,
  changed_by  text,
  note        text,
  changed_at  timestamptz default now() not null
);

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

-- =============================================================
-- BOOK FRAMEWORK TABLES
-- =============================================================

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

-- =============================================================
-- VIEWS / FUNCTIONS
-- =============================================================

-- Single company North Star
create or replace view public.v_company_north_star as
select g.*, c.start_date as cycle_start, c.end_date as cycle_end, c.cycle_number
from public.goals g
join public.twelve_week_cycles c on c.id = g.cycle_id
where g.scope = 'company' and g.is_north_star = true and c.status = 'active'
order by c.start_date desc
limit 1;

-- Founder Dependency Score (Built-to-Sell)
create or replace view public.v_founder_dependency_score as
with last_30 as (
  select
    (select count(*) from public.order_tags
       where role_key='founder' and created_at > now() - interval '30 days') as founder_tags,
    (select count(*) from public.order_tags
       where created_at > now() - interval '30 days') as total_tags
)
select
  case when total_tags = 0 then 0
       else round((founder_tags::numeric / total_tags) * 100, 1)
  end as score_pct,
  founder_tags, total_tags
from last_30;

-- Current week of an active cycle
create or replace function public.current_week_number(cycle uuid)
returns int language sql stable as $$
  select greatest(1, least(12,
    floor(extract(epoch from (now() - c.start_date::timestamptz)) / (7*24*3600))::int + 1
  ))
  from public.twelve_week_cycles c where c.id = cycle;
$$;
```

### 2.2 Seed (run once after migration)

```sql
-- Roles
insert into public.roles (key, name, emoji, color, purpose, queen_bee_role, fourD_target, criticality, supports_qbr)
values
  ('cx','Customer Experience & Invoicing','💬','#10B981',
    'Be the human voice of Joint_X and gate clean order intake.',
    'Inquiry-to-Order conversion',
    '{"doing":60,"deciding":15,"delegating":15,"designing":10}'::jsonb,'critical',true),
  ('designer','Graphic Designer','🎨','#A855F7',
    'Turn every order into print-ready, on-brand assets.',
    'Print-ready file delivery',
    '{"doing":70,"deciding":10,"delegating":5,"designing":15}'::jsonb,'critical',true),
  ('photo','Visual Content Producer','📸','#F97316',
    'Capture content that sells — clients and Joint_X.',
    'Drop-day capture',
    '{"doing":70,"deciding":10,"delegating":5,"designing":15}'::jsonb,'support',true),
  ('runner','Logistics & Field Ops','🏃','#EAB308',
    'Keep production unblocked by moving physical things on time.',
    'On-time material runs',
    '{"doing":90,"deciding":5,"delegating":0,"designing":5}'::jsonb,'support',true),
  ('ops_manager','Operations Manager','⚙️','#3B82F6',
    'Own the production pipeline end-to-end.',
    'Pipeline throughput',
    '{"doing":30,"deciding":30,"delegating":30,"designing":10}'::jsonb,'critical',true),
  ('social','Social Media Manager','📱','#EC4899',
    'Compound brand attention and convert it to demand.',
    'Weekly publishing cadence',
    '{"doing":60,"deciding":15,"delegating":10,"designing":15}'::jsonb,'support',true),
  ('founder','Founder / Operator','🚀','#EF4444',
    'Build the business that runs without you.',
    'Closing deals + designing the system',
    '{"doing":10,"deciding":30,"delegating":30,"designing":30}'::jsonb,'critical',true)
on conflict (key) do update set
  name=excluded.name, emoji=excluded.emoji, color=excluded.color,
  purpose=excluded.purpose, queen_bee_role=excluded.queen_bee_role,
  fourD_target=excluded.fourD_target;

-- Pipeline stages (keep legacy_status mapped to existing 5-stage flow)
insert into public.order_stages (key, display_name, sequence, is_exception, color, sla_hours, legacy_status) values
  ('received',                'Order received',         1,  false, '#94A3B8', 2,  'confirmed'),
  ('payment_pending',         'Awaiting payment',       2,  false, '#F59E0B', 24, 'confirmed'),
  ('paid',                    'Paid',                   3,  false, '#10B981', 4,  'confirmed'),
  ('design_in_progress',      'Designing',              4,  false, '#A855F7', 48, 'in_production'),
  ('design_pending_approval', 'Customer approval',      5,  false, '#EAB308', 72, 'in_production'),
  ('design_approved',         'Design approved',        6,  false, '#10B981', 4,  'in_production'),
  ('materials_check',         'Checking materials',     7,  false, '#3B82F6', 8,  'in_production'),
  ('production',              'In production',          8,  false, '#3B82F6', 96, 'in_production'),
  ('qa',                      'Quality check',          9,  false, '#3B82F6', 12, 'in_production'),
  ('ready_to_ship',           'Ready to ship',          10, false, '#10B981', 24, 'ready'),
  ('shipped',                 'Shipped',                11, false, '#10B981', null, 'shipped'),
  ('delivered',               'Delivered',              12, false, '#10B981', null, 'delivered'),
  ('complete',                'Complete',               13, false, '#475569', null, 'delivered'),
  ('materials_delayed',       'Materials delayed',      99, true,  '#EF4444', null, 'in_production'),
  ('design_revision_requested','Revision requested',    99, true,  '#F59E0B', null, 'in_production'),
  ('qa_failed',               'QA failed',              99, true,  '#EF4444', null, 'in_production'),
  ('customer_complaint',      'Customer complaint',     99, true,  '#EF4444', null, null),
  ('payment_failed',          'Payment failed',         99, true,  '#EF4444', null, null)
on conflict (key) do nothing;

-- Stage → role rules (the auto-tag matrix)
insert into public.stage_role_rules (stage_key, role_key, action) values
  ('received','designer','tag'),       ('received','ops_manager','tag'),
  ('payment_pending','cx','tag'),
  ('paid','ops_manager','assign'),     ('paid','designer','assign'),
  ('design_in_progress','designer','assign'),
  ('design_pending_approval','cx','notify'),
  ('design_approved','ops_manager','assign'),
  ('materials_check','ops_manager','tag'), ('materials_check','runner','tag'),
  ('production','ops_manager','assign'),
  ('qa','ops_manager','assign'),
  ('ready_to_ship','runner','tag'),    ('ready_to_ship','cx','tag'),
  ('shipped','cx','tag'),
  ('delivered','cx','tag'),            ('delivered','social','tag'),    ('delivered','photo','tag'),
  ('complete','founder','tag'),
  ('materials_delayed','ops_manager','escalate'),
  ('materials_delayed','runner','escalate'),
  ('materials_delayed','founder','escalate'),
  ('design_revision_requested','designer','tag'),
  ('design_revision_requested','cx','tag'),
  ('qa_failed','ops_manager','escalate'),
  ('qa_failed','designer','escalate'),
  ('customer_complaint','cx','escalate'),
  ('customer_complaint','founder','escalate'),
  ('payment_failed','cx','tag')
on conflict (stage_key, role_key, action) do nothing;

-- First company cycle + North Star (adjust dates to today's actual start)
insert into public.twelve_week_cycles (id, scope, cycle_number, start_date, end_date, status)
values ('00000000-0000-0000-0000-000000000c01', 'company', 1,
        current_date, current_date + interval '83 days', 'active')
on conflict (id) do nothing;

insert into public.goals (cycle_id, scope, is_north_star, title, description, progress)
select '00000000-0000-0000-0000-000000000c01', 'company', true,
       'Ship 500 X1 packs and reach R750k revenue',
       'Single company 12 Week Year goal — everything cascades to this.', 0
where not exists (
  select 1 from public.goals where is_north_star and scope='company'
);
```

### 2.3 Triggers (auto-tagging on stage change)

```sql
create or replace function public.auto_tag_on_stage_change()
returns trigger language plpgsql as $$
declare rule record;
begin
  if (tg_op = 'INSERT') or (new.pipeline_stage is distinct from old.pipeline_stage) then
    insert into public.order_stage_history (order_id, from_stage, to_stage)
    values (new.id, case when tg_op='INSERT' then null else old.pipeline_stage end, new.pipeline_stage);

    update public.order_tags
       set resolved_at = now()
     where order_id = new.id and resolved_at is null;

    for rule in
      select role_key, action from public.stage_role_rules where stage_key = new.pipeline_stage
    loop
      insert into public.order_tags (order_id, role_key, action, reason, context)
      values (new.id, rule.role_key, rule.action, 'auto:stage_change',
              jsonb_build_object('stage', new.pipeline_stage,
                                 'from_stage', case when tg_op='INSERT' then null else old.pipeline_stage end));
    end loop;

    update public.orders set current_tags = (
      select coalesce(jsonb_agg(distinct role_key), '[]'::jsonb)
      from public.order_tags
      where order_id = new.id and resolved_at is null
    ) where id = new.id;
  end if;
  return new;
end; $$;

drop trigger if exists trg_auto_tag_orders on public.orders;
create trigger trg_auto_tag_orders
  after insert or update of pipeline_stage on public.orders
  for each row execute function public.auto_tag_on_stage_change();

-- Sync weekly_tasks → calendar_events
create or replace function public.sync_weekly_task_to_event()
returns trigger language plpgsql as $$
declare evt_start timestamptz; map_day int;
begin
  if new.day_of_week is null or new.cycle_id is null then return new; end if;
  -- Find that day in the appropriate week
  select case new.day_of_week
    when 'monday' then 1 when 'tuesday' then 2 when 'wednesday' then 3 when 'thursday' then 4
    when 'friday' then 5 when 'saturday' then 6 when 'sunday' then 7 end into map_day;

  select c.start_date::timestamptz + ((new.week_number-1)*7 + (map_day-1)) * interval '1 day'
    into evt_start
  from public.twelve_week_cycles c where c.id = new.cycle_id;

  if tg_op = 'INSERT' then
    insert into public.calendar_events (owner_email, scope, category, reference_id, reference_type,
                                        title, start_at, end_at, all_day, status)
    values (coalesce(new.assigned_to[1], null), 'personal', 'tactic', new.id, 'weekly_task',
            new.title, evt_start, evt_start, true, 'scheduled');
  elsif tg_op = 'UPDATE' then
    update public.calendar_events
      set title=new.title, start_at=evt_start, end_at=evt_start,
          status = case when new.status='complete' then 'done' else 'scheduled' end
      where reference_id = new.id and reference_type = 'weekly_task';
  end if;
  return new;
end; $$;

drop trigger if exists trg_sync_weekly_task_event on public.weekly_tasks;
create trigger trg_sync_weekly_task_event
  after insert or update on public.weekly_tasks
  for each row execute function public.sync_weekly_task_to_event();
```

### 2.4 Wire entities into `dataClient.js`

Open `src/api/dataClient.js`. Inside the `ENTITY_CONFIG = { … }` object, add the entries below. Pattern to follow is the existing `Client`/`Project` entries — `table`, `sortMap`, `filterMap`, `normalize`, `serialize`.

Add entries for: `Goal`, `WeeklyTask`, `Role`, `QBR`, `SOP`, `OnboardingFlow`, `Cycle`, `KPI`, `WeeklyScore`, `TimeAllocation`, `CalendarEvent`, `OrderTag`, `OrderStage`, `StageRoleRule`, `OrderException`, `OrderStageHistory`, `OfferScore`, `MoneyModel`, `UserRole`, `AletheaProject`, `AletheaPhase`, `AletheaStep`, `AletheaTask`, `ClientAsset`, `Invoice`, `CatalogItem`, `Folder`, `FileComment`, `Idea`, `BugReport`, `SOPVersion`, `SOPVideo`, `ClientOrder`.

Minimal pattern for any entity that doesn't need field renaming:

```js
Goal: {
  table: 'goals',
  sortMap: { created_date: 'created_at', updated_date: 'updated_at' },
  filterMap: { created_date: 'created_at', updated_date: 'updated_at' },
  normalize(row) {
    return {
      ...row,
      created_date: row.created_at,
      updated_date: row.updated_at,
    };
  },
  serialize(payload) {
    return compactObject({
      cycle_id: payload.cycle_id,
      parent_goal_id: payload.parent_goal_id,
      scope: payload.scope,
      is_north_star: payload.is_north_star,
      team_name: payload.team_name,
      title: payload.title,
      description: payload.description,
      assigned_to: payload.assigned_to,
      status: payload.status,
      progress: payload.progress,
      start_date: payload.start_date,
      end_date: payload.end_date,
      is_archived: payload.is_archived,
      archived_at: payload.archived_at,
    });
  },
},
```

Repeat for each. Use existing column names — schema in §2.1 was designed to match.

For `Role` — the existing UI sends `name`, `purpose`, `success_definition`, `inputs`, `outputs`, `tools`, `criticality`, `supports_qbr`, `is_active`. All present in the schema. The new fields (`key`, `emoji`, `color`, `responsibilities`, `queen_bee_role`, `fourD_target`) are additive and won't break the existing `RolesManagement.jsx`.

### 2.5 Acceptance for Phase 0

- [ ] Open the app, create a goal in `/UserDashboard` → refresh → goal still there.
- [ ] Open `/RolesManagement` → 7 seeded roles render.
- [ ] Open `/Operations` → QBR/Roles/SOPs tabs load (no console warnings about "local fallback").
- [ ] In Supabase SQL editor, run `select * from public.v_company_north_star;` → returns the seeded North Star.
- [ ] In SQL editor: `update orders set pipeline_stage = 'paid' where id = ...;` → check `select * from order_tags where order_id = ...;` → ops_manager + designer rows present.

---

## 3. Phase 1 — Upgrade `UserDashboard.jsx` (My Hub)

The existing file is 266 lines and has a profile header, 3 stat cards, goals panel, weekly tasks panel, my tasks panel. **Don't replace — extend.** Add new sections in this order, above the existing content:

### 3.1 New components (under `src/components/hub/`)

```
src/components/hub/
├── NorthStarBanner.jsx          # company 12WY goal, sticky top
├── CycleProgressBar.jsx         # "Week N of 12 · X days remaining"
├── ExecutionScoreCard.jsx       # %, color-coded, sparkline of last 4 weeks
├── MyRoleCard.jsx               # primary role, mission, QBR, 4D mix
├── MyTagsInbox.jsx              # open order_tags @-mentions
├── WamPanel.jsx                 # weekly accountability meeting form
├── KpiTile.jsx                  # single KPI (lead/lag), inline update
├── DailyQbrCheck.jsx            # one-tap "did your QBR today?"
└── GoalCascadeDialog.jsx        # company → team → personal tree (modal)
```

Each component is small (50–120 lines). They use shadcn/ui primitives from `src/components/ui/` and `dataClient.entities.{X}`.

### 3.2 Helper module

`src/lib/twelveWeekYear.js`:
```js
import { differenceInDays, addWeeks, startOfDay } from 'date-fns';
export const CYCLE_LENGTH_DAYS = 84;

export function getWeekNumber(cycleStart, today = new Date()) {
  const days = differenceInDays(startOfDay(today), startOfDay(new Date(cycleStart)));
  if (days < 0) return 0;
  if (days >= CYCLE_LENGTH_DAYS) return 13;
  return Math.floor(days / 7) + 1;
}
export const getCycleEnd = (start) => addWeeks(new Date(start), 12);
export const getDaysRemaining = (start, today = new Date()) =>
  Math.max(0, differenceInDays(getCycleEnd(start), today));
export function calculateExecutionScore(tasks) {
  if (!tasks?.length) return 0;
  return Math.round((tasks.filter(t => t.status === 'complete').length / tasks.length) * 100 * 10) / 10;
}
export const scoreColor = (s) => s >= 85 ? 'green' : s >= 70 ? 'amber' : 'red';
```

### 3.3 Hooks (under `src/hooks/`)

- `useCompanyNorthStar.js` — wraps `dataClient.entities.Goal.filter({ is_north_star: true, scope: 'company' })`
- `useActiveCompanyCycle.js`
- `useMyRole.js` — joins `user_roles` + `roles` for the current user
- `useMyTags.js` — open `order_tags` where `role_key` ∈ my roles OR `user_email = me`
- `useMyExecutionScore.js` — current week's `weekly_scores` row + last 4 weeks for sparkline

### 3.4 New layout for `UserDashboard.jsx`

Order from top to bottom:

1. `<NorthStarBanner />` — full-width, sticky
2. Existing profile header (keep as-is)
3. `<CycleProgressBar />`
4. Three-column grid: `<ExecutionScoreCard />` · `<MyRoleCard />` · `<DailyQbrCheck />`
5. Existing 3 stat cards (Today / Overdue / Active Goals) — keep
6. Two-column grid: My Goals (existing) · Week N Tasks (existing)
7. `<MyTagsInbox />` — full width, new
8. `<KpiTile />` grid (lead | lag) — new
9. Existing My Tasks panel — keep
10. `<WamPanel />` — full width, emphasized Fri–Sun

The existing `weekScore` calc on line 92 should be replaced with a call to `calculateExecutionScore(myWeekTasks)` from the helper.

### 3.5 Acceptance

- [ ] North Star renders at top of `/UserDashboard`.
- [ ] Cycle progress bar shows correct week (e.g., week 1 if migration ran today).
- [ ] My Role Card shows the user's primary role (e.g., "🚀 Founder / Operator") + 4D mix with target.
- [ ] My Tags Inbox shows any open `order_tags` for my role(s).
- [ ] Daily QBR check writes to `qbrs` table; refresh keeps the checked state.
- [ ] WAM panel writes to `weekly_scores` and visibly highlighted Fri–Sun.

---

## 4. Phase 2 — Rebuild `OpsCalendar.jsx`

The existing file has `viewMode` switching between `calendar` and `list`. Add a third mode `twelveWeek` and unify all events through `calendar_events` instead of just `OpsTask`.

### 4.1 Components (under `src/components/calendar/`)

```
src/components/calendar/
├── CalendarToolbar.jsx     # view switcher + category filters + new event
├── DayView.jsx
├── WeekView.jsx
├── MonthView.jsx           # the existing calendar mode, refactored out
├── TwelveWeekView.jsx      # NEW: 12 cols × 7 rows, current week highlighted
├── EventChip.jsx           # category-colored pill
├── EventModal.jsx          # create/edit
└── eventColors.js          # category → color
```

`eventColors.js`:
```js
export const eventColors = {
  production:    { bg:'#FEF3C7', fg:'#92400E', dot:'#D97706' },
  marketing:     { bg:'#DBEAFE', fg:'#1E3A8A', dot:'#2563EB' },
  ops:           { bg:'#E0E7FF', fg:'#3730A3', dot:'#4F46E5' },
  wam:           { bg:'#FCE7F3', fg:'#9D174D', dot:'#DB2777' },
  drop:          { bg:'#DCFCE7', fg:'#14532D', dot:'#16A34A' },
  milestone:     { bg:'#FEE2E2', fg:'#991B1B', dot:'#DC2626' },
  tactic:        { bg:'#F3F4F6', fg:'#1F2937', dot:'#6B7280' },
  content_shoot: { bg:'#FFE4E6', fg:'#881337', dot:'#E11D48' },
  personal:      { bg:'#F5F3FF', fg:'#5B21B6', dot:'#7C3AED' },
};
```

### 4.2 The TwelveWeekView (the signature view)

12 columns × 7 rows. Header row: "W1 [date range]", "W2 [date range]", … current week column gets a 2px primary border. Today's cell gets `bg-primary/5`. Each cell holds up to 4 `EventChip` components, then a "+N more" button that opens a day drawer.

Pull events from `dataClient.entities.CalendarEvent.list()` filtered to `start_at` between `cycle.start_date` and `cycle.end_date`. Group by `(weekNumber, dayOfWeek)`.

Important: the existing `OpsTask` system is separate from `calendar_events`. Don't migrate `OpsTask` to events — instead, in the `TwelveWeekView`, show BOTH:
- `dataClient.entities.OpsTask.list()` (existing — production tasks)
- `dataClient.entities.CalendarEvent.list()` (new — tactics/marketing/WAMs/drops)

Render them as different chip styles (e.g., OpsTask chips have a small `🔧` icon). Both contribute to the day cell count.

### 4.3 Replace `OpsCalendar.jsx`'s render output

Keep its existing query layer and mutations. Replace the body return with:

```jsx
return (
  <div className="min-h-screen bg-background">
    <div className="max-w-7xl mx-auto px-4 py-6">
      <CalendarToolbar
        viewMode={viewMode}
        onViewChange={setViewMode}
        categories={visibleCategories}
        onCategoryToggle={toggleCategory}
        onNewEvent={() => setShowEventModal(true)}
      />
      {viewMode === 'twelveWeek' && <TwelveWeekView opsTasks={tasks} events={events} cycle={activeCycle} />}
      {viewMode === 'month'      && <MonthView opsTasks={tasks} events={events} />}
      {viewMode === 'week'       && <WeekView opsTasks={tasks} events={events} />}
      {viewMode === 'day'        && <DayView opsTasks={tasks} events={events} />}
      {viewMode === 'list'       && /* existing list view */}
      {showEventModal && <EventModal onClose={() => setShowEventModal(false)} />}
    </div>
  </div>
);
```

Default `viewMode` to `'twelveWeek'`.

### 4.4 Acceptance

- [ ] `/OpsCalendar` defaults to 12-week grid.
- [ ] Current week column has highlighted border; today's cell tinted.
- [ ] Filter toolbar instantly hides/shows events by category.
- [ ] Creating a `WeeklyTask` with `cycle_id + week_number + day_of_week` makes a chip appear in the right cell (via the `sync_weekly_task_to_event` trigger).
- [ ] Toggling that task to `complete` greys out the chip.

---

## 5. Phase 3 — Order Pipeline + Auto-Tagging

### 5.1 In `src/components/orders/OrderDrawer.jsx`

Currently uses a 5-stage progress bar (`progressStages`). Keep it. **Add** a second, more detailed pipeline strip below it showing the 13-stage `pipeline_stage` value. Make stages clickable; clicking advances the order to that stage (which fires the trigger and auto-tags roles).

### 5.2 New components

- `src/components/orders/OrderTagBadges.jsx` — renders pills for the order's `current_tags`. Show emoji + role color. Tooltip shows the action ("@Designer asked to design this").
- `src/components/orders/PipelineStrip.jsx` — the 13-stage visualization with click-to-advance.
- `src/components/orders/ExceptionFlag.jsx` — modal that picks an exception type (`materials_delayed`, `qa_failed`, etc.), inserts an `order_exceptions` row, and updates `pipeline_stage` to the exception value.

Add `<OrderTagBadges order={order} />` wherever orders appear:
- `src/pages/Orders.jsx` order cards
- `src/components/orders/OrderDrawer.jsx` header
- `src/pages/Dashboard.jsx` ActiveOrderCard
- `src/components/dashboard/ActiveOrderCard.jsx`

### 5.3 New Kanban view in `Orders.jsx`

Add a view-mode toggle to `Orders.jsx`: List (existing default) / Kanban (new).
Kanban uses `@hello-pangea/dnd` (already installed). One column per `order_stages.sequence`, exception stages in a separate red lane at top. Drag a card → mutate `pipeline_stage` → trigger fires.

### 5.4 Acceptance

- [ ] New order created → `pipeline_stage = 'received'` → designer + ops_manager tags exist in `order_tags`.
- [ ] Drag the card to "Paid" column → designer tag from "received" is `resolved_at` set, new ops_manager + designer tags created with `reason='auto:stage_change'`.
- [ ] Click "🚨 Flag exception → Materials delayed" → 3 escalation tags appear (ops_manager, runner, founder).
- [ ] Founder logs in → My Hub's Tags Inbox shows the escalation.

---

## 6. Phase 4 — Book Framework Dashboards

Add three new pages, each ~120 lines:

- `src/pages/OffersDashboard.jsx` (route `/OffersDashboard`) — table of `offer_scores` with computed value score `(dream × likelihood) / (delay × effort)`, sortable.
- `src/pages/MoneyModel.jsx` (route `/MoneyModel`) — table of `money_model_snapshots` per offer per month, color-coded payback, one chart for revenue trend.
- Founder Dependency Score widget on `/Operations` page (uses `v_founder_dependency_score`).

Add to `src/Layout.jsx` `moreNav` array (under "More"):
```js
{ name: "Offers", page: "OffersDashboard", icon: Sparkles, roles: ["admin"] },
{ name: "Money Model", page: "MoneyModel", icon: TrendingUp, roles: ["admin"] },
```

Both pages are admin-only via the existing `roles: ["admin"]` filter.

### 6.1 Acceptance

- [ ] `/OffersDashboard` renders empty state with "Score your first offer" CTA.
- [ ] Adding an offer score persists across refresh.
- [ ] `/Operations` page shows Founder Dependency % at the top of the page (replaces or pairs with the Operability Score card).

---

## 7. Implementation order (do not skip)

1. **Phase 0** — Migration §2.1, seeds §2.2, triggers §2.3, wire `dataClient` §2.4. Verify §2.5 fully.
2. **Phase 1** — `UserDashboard` extension. Verify §3.5.
3. **Phase 2** — `OpsCalendar` rebuild. Verify §4.4.
4. **Phase 3** — Order pipeline + tagging. Verify §5.4.
5. **Phase 4** — Book dashboards. Verify §6.1.

Run `npm run build` after each phase. Don't proceed past any failing acceptance check.

---

## 8. Hard rules (unchanged from v1)

1. Do NOT reintroduce Base44 in any source file. The `@base44/sdk` package can stay in `package.json` (it's not imported by any `src/` file), but no new imports of it.
2. Supabase via `dataClient` is the single source of truth. Don't bypass `dataClient` to call `supabase` directly except in new hooks where you need joins/views (`v_company_north_star`, `v_founder_dependency_score`) — those go in `src/hooks/` with explicit `from(...).select(...)` calls.
3. Every payment must link to an `order_id`; payment confirmation only via `payfast-notify` Edge Function (server-side).
4. Keep the existing `orders.status` enum working — do not change it. The new `pipeline_stage` is additive.
5. Don't break any existing route, page, or sidebar entry.
6. Don't redesign global Tailwind tokens — `tailwind.config.js` and `components.json` stay as they are.
7. If a fix touches `dataClient.js`, run a quick grep for that entity name across `src/pages/` to verify no field-name changes break callers.

---

## 9. Final Claude Code prompt

> Read `OPPS_v2_Aligned_Spec.md` end to end. The project zip is already extracted; don't re-extract. Implement Phase 0 first and run `npm run build`. Then verify each item in §2.5 by querying Supabase directly (the user has the SQL editor open). Only after Phase 0 passes, proceed to Phase 1, then 2, 3, 4 — running `npm run build` and walking through each Phase's acceptance checklist before moving on. Do not invent new entity names, new pages, or new routes. Do not touch `tailwind.config.js`, `components.json`, `vite.config.js`, or any file under `src/components/ui/`. Match existing code style (CRLF line endings, `dataClient` everywhere, `@tanstack/react-query`, `sonner` for toasts, shadcn/ui primitives).

---

**End of v2 spec. This one is aligned to the actual codebase.**
