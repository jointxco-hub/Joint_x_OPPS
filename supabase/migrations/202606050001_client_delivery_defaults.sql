-- Add reusable client delivery defaults for repeat orders.
-- Orders still keep their own pep_code/delivery_note snapshot per job.

alter table public.clients
  add column if not exists pep_code text null,
  add column if not exists delivery_note text null,
  add column if not exists preferred_courier text null;

create index if not exists idx_clients_pep_code on public.clients using btree (lower(pep_code));
