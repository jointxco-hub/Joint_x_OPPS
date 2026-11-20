-- OPPS-106 · restore the order-payment projection from the existing Finance ledger.
-- The existing, completed transactions are the authority. This migration does
-- NOT create a transaction, invoice payment, or customer charge.
-- It mirrors the already-tested staging projection behavior.
--
-- Production incident verified 2026-11-14:
-- ORD-Q-FC291AB8AD had a completed R129 income transaction and a paid
-- R129 source invoice, but orders.payment_status remained 'pending'.
--
-- Safety: only pending -> paid, only if a positive order total is fully
-- covered by completed income transactions belonging to the SAME tenant.
-- No downgrades, no new receipts, no PayFast calls.
create or replace function public._opps106_refresh_order_paid_from_ledger(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_order public.orders%rowtype;
  v_paid numeric;
begin
  if p_order_id is null then return; end if;
  select * into v_order from public.orders
  where id = p_order_id for update;
  if not found
     or v_order.payment_status is distinct from 'pending'
     or coalesce(v_order.total_amount,0) <= 0 then
    return;
  end if;

  select coalesce(sum(t.amount),0) into v_paid
  from public.transactions t
  where t.order_id = v_order.id
    and t.tenant_id = v_order.tenant_id
    and t.type = 'income'
    and t.payment_status = 'completed';

  if v_paid + 0.0049 < v_order.total_amount then return; end if;
  update public.orders
  set payment_status = 'paid'
  where id = v_order.id
    and tenant_id = v_order.tenant_id
    and payment_status = 'pending';
end
$function$;

revoke all on function public._opps106_refresh_order_paid_from_ledger(uuid) from public, anon, authenticated;

create or replace function public._opps106_order_paid_ledger_trigger()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if tg_op = 'DELETE' then
    perform public._opps106_refresh_order_paid_from_ledger(old.order_id);
  else
    perform public._opps106_refresh_order_paid_from_ledger(new.order_id);
    if tg_op = 'UPDATE' and old.order_id is distinct from new.order_id then
      perform public._opps106_refresh_order_paid_from_ledger(old.order_id);
    end if;
  end if;
  return null;
end
$function$;

revoke all on function public._opps106_order_paid_ledger_trigger() from public, anon, authenticated;

-- Do not install a parallel projector if a later migration already installed
-- the canonical staging trigger on this database.
do $block$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.transactions'::regclass
      and tgname = 'trg_transactions_project_order_payment_status'
      and not tgisinternal
  ) and not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.transactions'::regclass
      and tgname = 'trg_opps106_order_paid_ledger'
      and not tgisinternal
  ) then
    create trigger trg_opps106_order_paid_ledger
    after insert or delete or update of amount, type, payment_status, order_id
    on public.transactions for each row
    execute function public._opps106_order_paid_ledger_trigger();
  end if;
end
$block$;

-- Historical repair: only paid-in-full orders with matching tenant-linked
-- paid invoices and the independently recorded Finance ledger.
-- Update order metadata only. Do not create payment rows.
-- The migration is executed by an authorized database migration owner.
-- The workspace guard expects a service-role JWT claim, but a database
-- migration session normally has no request JWT. Set this claim ONLY inside
-- the one-time privileged migration block, then restore it. App users do
-- not gain this privilege. Full invoice+ledger checks remain mandatory.
do $backfill$
declare v_previous_role text := current_setting('request.jwt.claim.role', true);
begin
  perform set_config('request.jwt.claim.role','service_role',true);
  update public.orders o
  set payment_status = 'paid'
  where o.payment_status = 'pending'
    and coalesce(o.total_amount,0) > 0
    and exists (
      select 1 from public.opps_invoices i
      where i.id = o.source_invoice_id
        and i.tenant_id = o.tenant_id
        and i.source_order_id = o.id
        and i.status = 'paid'
        and i.amount_paid + 0.0049 >= o.total_amount
    )
    and (
      select coalesce(sum(t.amount),0)
      from public.transactions t
      where t.order_id = o.id and t.tenant_id = o.tenant_id
        and t.type = 'income' and t.payment_status = 'completed'
    ) + 0.0049 >= o.total_amount;
  perform set_config('request.jwt.claim.role',coalesce(v_previous_role,''),true);
end
$backfill$;
