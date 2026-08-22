-- Order-level "charge client for shipping" control. Orders previously had
-- no canonical shipping-amount field at all (confirmed by audit -
-- invoiceFromOrder()'s order.shipping_charge/delivery_fee/delivery_cost/
-- courier_fee fallbacks never matched a real column). fulfillment_type
-- (courier/collection/service_only) already exists and is untouched -
-- this is a deliberately separate concept: an order can be courier
-- delivery with shipping waived/absorbed.
--
-- apply_shipping_fee defaults true so every existing row stays valid and
-- no historical total is silently reinterpreted - shipping_fee stays
-- null (not 0) until staff sets an actual amount, matching the
-- established "nullable until set" convention used elsewhere
-- (client_products.client_price).
alter table public.orders
  add column if not exists apply_shipping_fee boolean not null default true;

alter table public.orders
  add column if not exists shipping_fee numeric;

alter table public.orders
  add constraint orders_shipping_fee_check
  check (shipping_fee is null or shipping_fee >= 0);
