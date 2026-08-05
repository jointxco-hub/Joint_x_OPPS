\set ON_ERROR_STOP on

-- Disposable local full-schema browser fixture. The auth user must be created
-- through local GoTrue first; pass its UUID as browser_user_id.

insert into public.users (auth_user_id, user_email, full_name, role)
select :'browser_user_id', 'invoice.fullschema@example.invalid', 'Full Schema Browser', 'finance_admin'
where not exists (select 1 from public.users where auth_user_id = :'browser_user_id');
update public.users set role = 'finance_admin', is_active = true
where auth_user_id = :'browser_user_id';

insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role, status)
select id, :'browser_user_id', 'member', 'active'
from public.tenants where slug = 'joint-x'
on conflict (tenant_id, auth_user_id) do update set status = 'active';

insert into public.orders (id, order_number, client_name, products, total_amount, tenant_id)
select
  '14100000-0000-0000-0000-000000000001', 'BROWSER-ORDER-A', 'Browser Customer',
  '[{"name":"Browser Item One","quantity":2,"price":10},{"name":"Browser Item Two","quantity":2,"price":10}]'::jsonb,
  40, id
from public.tenants where slug = 'joint-x'
on conflict (id) do nothing;

insert into public.opps_invoices (
  id, invoice_number, customer_name, source_order_id, invoice_date, status,
  subtotal, discount_total, shipping_charge, tax_total, total, balance_due, tenant_id
)
select
  '14000000-0000-0000-0000-000000000001', 'TEST-A-DRAFT', 'Browser Customer',
  '14100000-0000-0000-0000-000000000001', current_date, 'draft',
  30, 0, 5, 0, 35, 35, id
from public.tenants where slug = 'joint-x'
on conflict (id) do nothing;

insert into public.opps_invoice_items (
  invoice_id, tenant_id, line_number, item_name, quantity, rate, item_total, line_key
)
select '14000000-0000-0000-0000-000000000001'::uuid, id, 1, 'Browser Item One', 1, 10, 10, 'browser-a-1'
from public.tenants where slug = 'joint-x'
union all
select '14000000-0000-0000-0000-000000000001'::uuid, id, 2, 'Browser Item Two', 2, 10, 20, 'browser-a-2'
from public.tenants where slug = 'joint-x';
