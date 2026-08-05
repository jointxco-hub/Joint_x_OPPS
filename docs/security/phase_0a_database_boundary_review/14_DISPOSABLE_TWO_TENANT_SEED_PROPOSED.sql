-- DISPOSABLE LOCAL TEST SEED - PROPOSED, UNEXECUTED.
-- Never run against a linked or production database.

begin;

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('92000000-0000-4000-8000-000000000011', 'authenticated', 'authenticated', 'phase0a-member-a@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('92000000-0000-4000-8000-000000000012', 'authenticated', 'authenticated', 'phase0a-member-b@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('92000000-0000-4000-8000-000000000013', 'authenticated', 'authenticated', 'phase0a-admin-a@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.tenants (id, slug, name, status) values
  ('92000000-0000-4000-8000-000000000001', 'phase0a-a', 'Phase 0A Tenant A', 'active'),
  ('92000000-0000-4000-8000-000000000002', 'phase0a-b', 'Phase 0A Tenant B', 'active');

insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role, status) values
  ('92000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000011', 'member', 'active'),
  ('92000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000012', 'member', 'active'),
  ('92000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000013', 'admin', 'active');

insert into public.users (
  id, auth_user_id, user_email, full_name, role, department, is_active
) values (
  '92000000-0000-4000-8000-000000000021',
  '92000000-0000-4000-8000-000000000013',
  'phase0a-admin-a@example.test', 'Phase 0A Admin A', 'admin', 'management', true
);

insert into public.suppliers (id, tenant_id, name, type) values
  ('92000000-0000-4000-8000-000000000101', '92000000-0000-4000-8000-000000000001', 'Phase 0A Supplier A', 'blanks'),
  ('92000000-0000-4000-8000-000000000102', '92000000-0000-4000-8000-000000000002', 'Phase 0A Supplier B', 'blanks');

insert into public.orders (
  id, tenant_id, client_name, order_number, status, priority,
  products, is_archived, source
) values
  ('92000000-0000-4000-8000-000000000201', '92000000-0000-4000-8000-000000000001', 'Phase 0A Client A', 'PHASE0A-A-ORDER', 'confirmed', 'normal', '[]'::jsonb, false, 'opps'),
  ('92000000-0000-4000-8000-000000000202', '92000000-0000-4000-8000-000000000002', 'Phase 0A Client B', 'PHASE0A-B-ORDER', 'confirmed', 'normal', '[]'::jsonb, false, 'opps');

insert into public.purchase_orders (
  id, tenant_id, po_number, supplier_id, supplier_ids, status,
  items, subtotal, tax, total
) values
  ('92000000-0000-4000-8000-000000000301', '92000000-0000-4000-8000-000000000001', 'PHASE0A-A-PO', '92000000-0000-4000-8000-000000000101', array['92000000-0000-4000-8000-000000000101'::uuid], 'draft', '[]'::jsonb, 0, 0, 0),
  ('92000000-0000-4000-8000-000000000302', '92000000-0000-4000-8000-000000000002', 'PHASE0A-B-PO', '92000000-0000-4000-8000-000000000102', array['92000000-0000-4000-8000-000000000102'::uuid], 'draft', '[]'::jsonb, 0, 0, 0);

insert into public.inventory (
  id, tenant_id, name, sku, category, current_stock, unit, preferred_supplier_id
) values
  ('92000000-0000-4000-8000-000000000401', '92000000-0000-4000-8000-000000000001', 'Phase 0A Inventory A', 'PHASE0A-INV-A', 'tees', 1, 'pieces', '92000000-0000-4000-8000-000000000101'),
  ('92000000-0000-4000-8000-000000000402', '92000000-0000-4000-8000-000000000002', 'Phase 0A Inventory B', 'PHASE0A-INV-B', 'tees', 1, 'pieces', '92000000-0000-4000-8000-000000000102');

commit;
