-- Add invoice tracking and client portal fields to orders table
alter table if exists public.orders
  add column if not exists invoice_files  jsonb    not null default '[]',
  add column if not exists invoice_numbers jsonb   not null default '[]',
  add column if not exists portal_message text,
  add column if not exists portal_show_balance boolean not null default false,
  add column if not exists portal_show_files   boolean not null default false,
  add column if not exists portal_attention_items jsonb not null default '[]';
