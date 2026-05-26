-- Store supplier item catalog rows used by OPPS supplier profiles and purchase planning.
-- Safe additive JSONB column. File/item binaries are not stored here.

alter table public.suppliers
  add column if not exists products jsonb not null default '[]'::jsonb;
