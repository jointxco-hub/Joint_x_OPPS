-- Additive guard columns for X LAB payment recovery/admin views.
-- Keeps PayFast/payment logic untouched while preventing schema-cache failures
-- when X LAB admin/recovery screens read recorded payment totals.

alter table if exists public.xlab_orders
  add column if not exists deposit_paid numeric(12, 2) not null default 0,
  add column if not exists amount_paid numeric(12, 2) not null default 0,
  add column if not exists payment_status text null,
  add column if not exists paid_at timestamptz null,
  add column if not exists payfast_payment_id text null,
  add column if not exists payment_last_checked_at timestamptz null;

do $$
begin
  if to_regclass('public.xlab_orders') is not null then
    create index if not exists idx_xlab_orders_payment_status
      on public.xlab_orders(payment_status);

    create index if not exists idx_xlab_orders_payfast_payment_id
      on public.xlab_orders(payfast_payment_id);
  end if;
end
$$;
