-- Adds the "live/refreshable contact-shipping metadata" columns to
-- opps_invoices that today only live on orders/clients, plus a shared
-- fulfillment_type on orders/opps_invoices/clients (default 'courier')
-- so the missing-courier-code warning can distinguish a real gap from a
-- legitimate collection/service-only order or invoice.
--
-- Everything added here is purely additive (nullable text, or a
-- defaulted CHECK-constrained text column) - no existing column is
-- touched, and none of this is part of the immutable commercial/
-- financial snapshot (items, quantities, prices, discounts, tax,
-- totals, payments, balance, approval/payment status all stay exactly
-- as they are).

alter table public.opps_invoices
  add column if not exists contact_person text,
  add column if not exists shipping_address text,
  add column if not exists shipping_courier text,
  add column if not exists shipping_courier_code text,
  add column if not exists delivery_instructions text,
  add column if not exists fulfillment_type text not null default 'courier'
    check (fulfillment_type in ('courier', 'collection', 'service_only'));

alter table public.orders
  add column if not exists fulfillment_type text not null default 'courier'
    check (fulfillment_type in ('courier', 'collection', 'service_only'));
