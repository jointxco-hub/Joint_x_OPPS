-- Add contact aliases for reconciling invoice names with WhatsApp/client saved names.
-- Safe additive fields used by OPPS orders, clients, and production print summaries.

alter table public.orders
  add column if not exists whatsapp_name text null,
  add column if not exists saved_contact_name text null;

alter table public.clients
  add column if not exists whatsapp_name text null,
  add column if not exists saved_contact_name text null;

create index if not exists idx_orders_whatsapp_name on public.orders using btree (lower(whatsapp_name));
create index if not exists idx_clients_whatsapp_name on public.clients using btree (lower(whatsapp_name));
