-- Staff can pin a specific file as an order's production-summary thumbnail
-- (OrderFilesTab.jsx "Set as thumbnail" action). When unset, Orders.jsx
-- falls back to the first image in the Mockups folder, then the first
-- unsorted (unfoldered) image, then any other image on the order.

begin;

alter table public.orders
  add column if not exists production_thumbnail_url text;

commit;
