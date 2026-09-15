-- QS-10 production parity:
-- allow Quick Solution Café orders to persist source='quick_solution'.
--
-- This migration is intentionally idempotent because production was
-- repaired directly during the QS-10 production smoke test.

begin;

do $qs10_orders_source$
declare
  v_definition text;
begin
  select pg_get_constraintdef(c.oid)
  into v_definition
  from pg_constraint c
  where c.conrelid = 'public.orders'::regclass
    and c.conname = 'orders_source_check';

  if v_definition is null then
    raise exception
      'QS10 prerequisite missing: public.orders.orders_source_check';
  end if;

  if v_definition not like '%opps%'
     or v_definition not like '%xlab%'
     or v_definition not like '%x1_sample%' then
    raise exception
      'QS10 unexpected orders_source_check definition: %',
      v_definition;
  end if;

  if v_definition like '%quick_solution%' then
    return;
  end if;

  alter table public.orders
    drop constraint orders_source_check;

  alter table public.orders
    add constraint orders_source_check
    check (
      source = any (
        array[
          'opps'::text,
          'xlab'::text,
          'x1_sample'::text,
          'quick_solution'::text
        ]
      )
    );
end
$qs10_orders_source$;

do $qs10_orders_source_verify$
declare
  v_definition text;
begin
  select pg_get_constraintdef(c.oid)
  into v_definition
  from pg_constraint c
  where c.conrelid = 'public.orders'::regclass
    and c.conname = 'orders_source_check';

  if v_definition not like '%opps%'
     or v_definition not like '%xlab%'
     or v_definition not like '%x1_sample%'
     or v_definition not like '%quick_solution%' then
    raise exception
      'QS10 orders_source_check verification failed: %',
      v_definition;
  end if;
end
$qs10_orders_source_verify$;

commit;