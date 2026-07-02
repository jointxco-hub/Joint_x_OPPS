-- Follow-up to flexible expense capture: clearer expense naming and supplier PO linking.

alter table public.transactions
  add column if not exists expense_name text,
  add column if not exists purchase_order_id uuid references public.purchase_orders(id) on delete set null,
  add column if not exists linked_purchase_order_id uuid references public.purchase_orders(id) on delete set null;

update public.transactions
set
  expense_name = coalesce(expense_name, nullif(paid_to_name, ''), nullif(vendor, ''), nullif(notes, ''), 'Expense'),
  linked_purchase_order_id = coalesce(linked_purchase_order_id, purchase_order_id)
where type = 'expense';

do $$
declare constraint_name text;
begin
  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.transactions'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%link_type%'
  loop
    execute format('alter table public.transactions drop constraint %I', constraint_name);
  end loop;
end$$;

alter table public.transactions
  add constraint transactions_expense_link_type_check
  check (link_type is null or link_type in ('none', 'client', 'project', 'order', 'purchase_order', 'invoice', 'production_job'));

create index if not exists idx_transactions_purchase_order_id on public.transactions(purchase_order_id);
create index if not exists idx_transactions_linked_purchase_order on public.transactions(linked_purchase_order_id);
create index if not exists idx_transactions_expense_name on public.transactions using gin (to_tsvector('simple', coalesce(expense_name, '')));
