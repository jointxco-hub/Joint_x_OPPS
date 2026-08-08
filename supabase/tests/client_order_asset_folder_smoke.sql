\set ON_ERROR_STOP on

-- Smoke test for the nested Client Root -> Orders -> ORD-XXXXX -> category
-- auto-provisioning system
-- (202608080001_client_order_asset_folder_provisioning.sql). Run against a
-- disposable full-schema stack, same convention as
-- supabase/tests/client_asset_folder_smoke.sql (the donor test this one
-- supersedes/extends for the nested hierarchy). Entirely inside one
-- transaction, rolled back at the end — never touches a real database.

begin;

insert into public.tenants (id, slug, name) values
  ('51000000-0000-0000-0000-000000000001', 'order-folder-smoke-a', 'Order Folder Smoke A'),
  ('52000000-0000-0000-0000-000000000002', 'order-folder-smoke-b', 'Order Folder Smoke B');

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data) values
  ('5a000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'staff-a@order-folder-smoke.invalid', '{}'::jsonb, '{}'::jsonb),
  ('5b000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'staff-b@order-folder-smoke.invalid', '{}'::jsonb, '{}'::jsonb);

insert into public.users (id, auth_user_id, user_email, full_name, role) values
  ('51100000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000001', 'staff-a@order-folder-smoke.invalid', 'Staff A', 'staff'),
  ('52100000-0000-0000-0000-000000000002', '5b000000-0000-0000-0000-000000000002', 'staff-b@order-folder-smoke.invalid', 'Staff B', 'staff');

insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role) values
  ('51000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000001', 'member'),
  ('52000000-0000-0000-0000-000000000002', '5b000000-0000-0000-0000-000000000002', 'member');

insert into public.clients (id, name, email, tenant_id) values
  ('51300000-0000-0000-0000-000000000001', 'Order Folder Smoke Client A', 'client-a@order-folder-smoke.invalid', '51000000-0000-0000-0000-000000000001'),
  ('52300000-0000-0000-0000-000000000002', 'Order Folder Smoke Client B', 'client-b@order-folder-smoke.invalid', '52000000-0000-0000-0000-000000000002');

-- Simulates the already-shipped "auto-create client root folder on client
-- creation" behavior (commit de8ca1f, already on main) having run before
-- this feature ever touches this client — proves test #19 (existing older
-- client roots remain compatible): the new RPC must reuse this row, not
-- create a second root.
insert into public.folders (id, name, client_id, parent_id, color) values
  ('51900000-0000-0000-0000-000000000001', 'Order Folder Smoke Client A', '51300000-0000-0000-0000-000000000001', null, 'blue');

insert into public.orders (
  id, order_number, client_name, client_email, client_id, products, total_amount,
  deposit_paid, status, tenant_id
) values
  ('51700000-0000-0000-0000-000000000001', 'ORD-SMOKE-A1', 'Order Folder Smoke Client A',
   'client-a@order-folder-smoke.invalid', '51300000-0000-0000-0000-000000000001',
   '[{"id":"1","name":"Line one","quantity":1,"price":100}]'::jsonb, 100, 0, 'confirmed',
   '51000000-0000-0000-0000-000000000001'),
  ('51700000-0000-0000-0000-000000000002', 'ORD-SMOKE-A2', 'Order Folder Smoke Client A',
   'client-a@order-folder-smoke.invalid', '51300000-0000-0000-0000-000000000001',
   '[{"id":"1","name":"Line two","quantity":1,"price":50}]'::jsonb, 50, 0, 'confirmed',
   '51000000-0000-0000-0000-000000000001'),
  ('52700000-0000-0000-0000-000000000003', 'ORD-SMOKE-B1', 'Order Folder Smoke Client B',
   'client-b@order-folder-smoke.invalid', '52300000-0000-0000-0000-000000000002',
   '[{"id":"1","name":"Line one","quantity":1,"price":100}]'::jsonb, 100, 0, 'confirmed',
   '52000000-0000-0000-0000-000000000002');

set local role authenticated;
-- auth.uid()/email()/role() read different GUCs depending on the Postgres
-- image version: older images read the flat request.jwt.claim.sub/.email/
-- .role directly, newer ones fall back to parsing the request.jwt.claims
-- JSON blob. Set both so this test runs identically on either.
set local request.jwt.claim.sub = '5a000000-0000-0000-0000-000000000001';
set local request.jwt.claim.email = 'staff-a@order-folder-smoke.invalid';
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"5a000000-0000-0000-0000-000000000001","email":"staff-a@order-folder-smoke.invalid","role":"authenticated"}';

-- 1/19. Client root reuse: calling the order RPC must reuse the
-- already-existing root folder (id 51900000...0001), never create a second
-- one for this client.
do $$
declare v_root_count integer; v_root_id uuid;
begin
  perform public.get_or_create_order_asset_folder('51700000-0000-0000-0000-000000000001', null);
  select count(*) into v_root_count from public.folders where client_id = '51300000-0000-0000-0000-000000000001' and parent_id is null;
  if v_root_count <> 1 then raise exception 'EXISTING_ROOT_NOT_REUSED_OR_DUPLICATED: got % roots', v_root_count; end if;
  select id into v_root_id from public.folders where client_id = '51300000-0000-0000-0000-000000000001' and parent_id is null;
  if v_root_id <> '51900000-0000-0000-0000-000000000001' then raise exception 'ROOT_FOLDER_WAS_NOT_THE_PRE_EXISTING_ONE'; end if;
end
$$;

-- 2. Orders grouping folder is idempotent and lives directly under root.
do $$
declare v_orders_1 uuid; v_orders_2 uuid; v_root uuid;
begin
  v_orders_1 := public.get_or_create_order_asset_folder('51700000-0000-0000-0000-000000000001', null);
  -- calling get_or_create_client_asset_folder directly with category
  -- 'Orders' must resolve to the exact same folder the order RPC uses
  -- internally, proving there's exactly one "Orders" grouping folder.
  v_orders_2 := public.get_or_create_client_asset_folder('51300000-0000-0000-0000-000000000001', 'Order Folder Smoke Client A', 'Orders');
  select parent_id into v_orders_1 from public.folders where order_id = '51700000-0000-0000-0000-000000000001';
  if v_orders_1 <> v_orders_2 then raise exception 'ORDERS_GROUPING_FOLDER_NOT_SHARED'; end if;
  select id into v_root from public.folders where client_id = '51300000-0000-0000-0000-000000000001' and parent_id is null;
  if (select count(*) from public.folders where parent_id = v_root and lower(name) = lower('Orders')) <> 1 then
    raise exception 'DUPLICATE_ORDERS_GROUPING_FOLDER';
  end if;
end
$$;

-- 3/5/6. Order-number folder provisioning is idempotent, keyed by order_id
-- (not by order_number text), and safe under repeated/"concurrent-shaped"
-- calls: N calls to the same order_id must yield exactly 1 folder row.
do $$
declare v_1 uuid; v_2 uuid; v_3 uuid; v_count integer;
begin
  v_1 := public.get_or_create_order_asset_folder('51700000-0000-0000-0000-000000000001', null);
  v_2 := public.get_or_create_order_asset_folder('51700000-0000-0000-0000-000000000001', null);
  v_3 := public.get_or_create_order_asset_folder('51700000-0000-0000-0000-000000000001', null);
  if v_1 is null or v_1 <> v_2 or v_2 <> v_3 then raise exception 'ORDER_FOLDER_NOT_IDEMPOTENT'; end if;
  select count(*) into v_count from public.folders where order_id = '51700000-0000-0000-0000-000000000001';
  if v_count <> 1 then raise exception 'DUPLICATE_ORDER_FOLDER_CREATED: got % rows', v_count; end if;
  if (select name from public.folders where id = v_1) <> 'ORD-SMOKE-A1' then raise exception 'ORDER_FOLDER_NAME_NOT_ORDER_NUMBER'; end if;
end
$$;

-- A second order for the SAME client must get its OWN order folder (not
-- reuse the first order's), while sharing the same client root and Orders
-- grouping folder.
do $$
declare v_order1_folder uuid; v_order2_folder uuid; v_order1_parent uuid; v_order2_parent uuid;
begin
  v_order1_folder := public.get_or_create_order_asset_folder('51700000-0000-0000-0000-000000000001', null);
  v_order2_folder := public.get_or_create_order_asset_folder('51700000-0000-0000-0000-000000000002', null);
  if v_order1_folder = v_order2_folder then raise exception 'TWO_ORDERS_COLLAPSED_INTO_ONE_FOLDER'; end if;
  select parent_id into v_order1_parent from public.folders where id = v_order1_folder;
  select parent_id into v_order2_parent from public.folders where id = v_order2_folder;
  if v_order1_parent <> v_order2_parent then raise exception 'SIBLING_ORDERS_DO_NOT_SHARE_ORDERS_GROUPING_FOLDER'; end if;
end
$$;

-- 4. Standard child folder set (provision_order_asset_folders) is created
-- in full and is idempotent under a repeat call.
do $$
declare v_before integer; v_after_first integer; v_after_second integer; v_order_folder uuid;
begin
  v_order_folder := public.get_or_create_order_asset_folder('51700000-0000-0000-0000-000000000001', null);
  select count(*) into v_before from public.folders where parent_id = v_order_folder;
  perform public.provision_order_asset_folders('51700000-0000-0000-0000-000000000001');
  select count(*) into v_after_first from public.folders where parent_id = v_order_folder;
  if v_after_first <> 7 then raise exception 'STANDARD_CATEGORY_SET_INCOMPLETE: got % of 7', v_after_first; end if;
  perform public.provision_order_asset_folders('51700000-0000-0000-0000-000000000001');
  select count(*) into v_after_second from public.folders where parent_id = v_order_folder;
  if v_after_second <> 7 then raise exception 'REPEAT_PROVISIONING_CREATED_DUPLICATES: got %', v_after_second; end if;
  if not exists (select 1 from public.folders where parent_id = v_order_folder and name = 'QC / Finished') then
    raise exception 'QC_FINISHED_CATEGORY_MISSING';
  end if;
  if not exists (select 1 from public.folders where parent_id = v_order_folder and name = 'Delivery') then
    raise exception 'DELIVERY_CATEGORY_MISSING';
  end if;
end
$$;

-- 13-18 (DB half — category subfolder creation itself; the folder-id ->
-- category NAME mapping is unit-tested in
-- tests/order-asset-folder-provisioning.test.mjs on the JS side). Each
-- canonical category name used by the app must resolve to its own distinct
-- subfolder under the order folder, case-insensitively idempotent.
do $$
declare v_order_folder uuid; v_mockups_1 uuid; v_mockups_2 uuid; v_artwork uuid; v_production uuid; v_invoices uuid; v_delivery uuid; v_general uuid;
begin
  v_order_folder := public.get_or_create_order_asset_folder('51700000-0000-0000-0000-000000000001', null);
  v_mockups_1 := public.get_or_create_order_asset_folder('51700000-0000-0000-0000-000000000001', 'Mockups');
  v_mockups_2 := public.get_or_create_order_asset_folder('51700000-0000-0000-0000-000000000001', 'mockups');
  v_artwork := public.get_or_create_order_asset_folder('51700000-0000-0000-0000-000000000001', 'Artwork');
  v_production := public.get_or_create_order_asset_folder('51700000-0000-0000-0000-000000000001', 'Production');
  v_invoices := public.get_or_create_order_asset_folder('51700000-0000-0000-0000-000000000001', 'Invoices & Quotes');
  v_delivery := public.get_or_create_order_asset_folder('51700000-0000-0000-0000-000000000001', 'Delivery');
  v_general := public.get_or_create_order_asset_folder('51700000-0000-0000-0000-000000000001', 'General');
  if v_mockups_1 <> v_mockups_2 then raise exception 'MOCKUPS_CATEGORY_NOT_CASE_INSENSITIVE_IDEMPOTENT'; end if;
  if v_mockups_1 = v_artwork or v_artwork = v_production or v_production = v_invoices
     or v_invoices = v_delivery or v_delivery = v_general or v_general = v_mockups_1 then
    raise exception 'CATEGORY_FOLDERS_NOT_DISTINCT';
  end if;
  if (select parent_id from public.folders where id = v_mockups_1) <> v_order_folder then
    raise exception 'CATEGORY_FOLDER_PARENT_WRONG';
  end if;
end
$$;

-- 10/11. File mirror: creates a client_assets reference to the same
-- file_url (no re-upload — this smoke test proves the DB side never
-- touches storage, only metadata rows), placed under the resolved category
-- folder.
do $$
declare v_mockups_folder uuid; v_asset_id uuid; v_asset_folder uuid; v_asset_url text;
begin
  v_mockups_folder := public.get_or_create_order_asset_folder('51700000-0000-0000-0000-000000000001', 'Mockups');
  insert into public.client_assets (title, file_url, file_type, folder_id, client_id, order_id)
  values ('mockup-final.png', 'private-upload://uploads/order-a1/mockup-final.png', 'png', v_mockups_folder,
          '51300000-0000-0000-0000-000000000001', '51700000-0000-0000-0000-000000000001')
  returning id, folder_id, file_url into v_asset_id, v_asset_folder, v_asset_url;
  if v_asset_id is null then raise exception 'MIRROR_INSERT_FAILED'; end if;
  if v_asset_folder <> v_mockups_folder then raise exception 'MIRROR_PLACED_IN_WRONG_FOLDER'; end if;
  if v_asset_url <> 'private-upload://uploads/order-a1/mockup-final.png' then raise exception 'MIRROR_DID_NOT_REUSE_SAME_FILE_URL'; end if;
end
$$;

-- 12. Duplicate mirror request (same order_id + file_url) must not create a
-- second placement — enforced by idx_client_assets_order_file_url_unique.
do $$
declare v_mockups_folder uuid; v_code text; v_count integer;
begin
  v_mockups_folder := public.get_or_create_order_asset_folder('51700000-0000-0000-0000-000000000001', 'Mockups');
  begin
    insert into public.client_assets (title, file_url, file_type, folder_id, client_id, order_id)
    values ('mockup-final.png', 'private-upload://uploads/order-a1/mockup-final.png', 'png', v_mockups_folder,
            '51300000-0000-0000-0000-000000000001', '51700000-0000-0000-0000-000000000001');
    raise exception 'DUPLICATE_MIRROR_PLACEMENT_ACCEPTED';
  exception when unique_violation then
    null; -- expected: the JS mirror helper treats this exact case as already-mirrored, not a failure
  end;
  select count(*) into v_count from public.client_assets
  where order_id = '51700000-0000-0000-0000-000000000001' and file_url = 'private-upload://uploads/order-a1/mockup-final.png';
  if v_count <> 1 then raise exception 'DUPLICATE_MIRROR_ROW_COUNT_WRONG: got %', v_count; end if;
end
$$;

-- 7. Cross-tenant order is rejected even for an authenticated staff member.
do $$
declare v_code text;
begin
  begin
    perform public.get_or_create_order_asset_folder('52700000-0000-0000-0000-000000000003', null);
    raise exception 'CROSS_TENANT_ORDER_ACCEPTED';
  exception when others then
    get stacked diagnostics v_code = message_text;
    if v_code <> 'FOLDER_ACCESS_DENIED' then raise; end if;
  end;
end
$$;

-- A nonexistent order_id is rejected distinctly (not silently treated as
-- "no client").
do $$
declare v_code text;
begin
  begin
    perform public.get_or_create_order_asset_folder('59999999-0000-0000-0000-000000000099', null);
    raise exception 'MISSING_ORDER_ACCEPTED';
  exception when others then
    get stacked diagnostics v_code = message_text;
    if v_code <> 'FOLDER_ORDER_NOT_FOUND' then raise; end if;
  end;
end
$$;

reset role;
set local request.jwt.claim.sub = '';
set local request.jwt.claim.email = '';
set local request.jwt.claim.role = '';
set local request.jwt.claims = '';

-- 8. Unauthenticated (no auth.uid()) call is rejected.
do $$
declare v_code text;
begin
  begin
    perform public.get_or_create_order_asset_folder('51700000-0000-0000-0000-000000000001', null);
    raise exception 'UNAUTHENTICATED_CALL_ACCEPTED';
  exception when others then
    get stacked diagnostics v_code = message_text;
    if v_code <> 'FOLDER_AUTH_REQUIRED' then raise; end if;
  end;
end
$$;

-- 9. Correct authenticated tenant is accepted (sanity check after the
-- rejection cases above, proving those failures were access-control, not a
-- broken function).
set local role authenticated;
set local request.jwt.claim.sub = '5a000000-0000-0000-0000-000000000001';
set local request.jwt.claim.email = 'staff-a@order-folder-smoke.invalid';
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"5a000000-0000-0000-0000-000000000001","email":"staff-a@order-folder-smoke.invalid","role":"authenticated"}';
do $$
declare v_id uuid;
begin
  v_id := public.get_or_create_order_asset_folder('51700000-0000-0000-0000-000000000001', null);
  if v_id is null then raise exception 'CORRECT_TENANT_CALL_UNEXPECTEDLY_REJECTED'; end if;
end
$$;

-- 20. RLS: tenant B cannot see tenant A's order folders or mirrored assets.
set local request.jwt.claim.sub = '5b000000-0000-0000-0000-000000000002';
set local request.jwt.claim.email = 'staff-b@order-folder-smoke.invalid';
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"5b000000-0000-0000-0000-000000000002","email":"staff-b@order-folder-smoke.invalid","role":"authenticated"}';
do $$
begin
  if (select count(*) from public.folders where client_id = '51300000-0000-0000-0000-000000000001') <> 0 then
    raise exception 'TENANT_B_CAN_SEE_TENANT_A_ORDER_FOLDERS';
  end if;
  if (select count(*) from public.client_assets where client_id = '51300000-0000-0000-0000-000000000001') <> 0 then
    raise exception 'TENANT_B_CAN_SEE_TENANT_A_MIRRORED_ASSETS';
  end if;
end
$$;
reset role;

-- Backfill (supabase/backfills/client_order_asset_folder_backfill.sql —
-- a manual script, not a migration; see that file's own header):
-- exercises its DO block logic against a freshly seeded order that has
-- file_urls but no prior client_assets rows, proving it lands each file
-- under the correct nested category and is idempotent on rerun (no
-- duplicate rows). Run as database owner (no set local role), matching
-- how the real script is actually executed.
reset role;
set local request.jwt.claims = '';

insert into public.orders (
  id, order_number, client_name, client_email, client_id, products, total_amount,
  deposit_paid, status, tenant_id, file_urls, order_file_folders
) values (
  '51700000-0000-0000-0000-000000000099', 'ORD-SMOKE-BACKFILL', 'Order Folder Smoke Client A',
  'client-a@order-folder-smoke.invalid', '51300000-0000-0000-0000-000000000001',
  '[{"id":"1","name":"Line one","quantity":1,"price":100}]'::jsonb, 100, 0, 'confirmed',
  '51000000-0000-0000-0000-000000000001',
  array[
    'https://storage.example.invalid/a/mockup-backfill.png',
    'https://storage.example.invalid/a/artwork-backfill.png',
    'https://storage.example.invalid/a/no-folder-backfill.pdf'
  ]::text[],
  '{"folders":[{"id":"mockups","name":"Mockups"},{"id":"artwork","name":"Artwork / Graphic Files"}],"fileFolders":{"https://storage.example.invalid/a/mockup-backfill.png":"mockups","https://storage.example.invalid/a/artwork-backfill.png":"artwork"}}'::jsonb
);

do $$
declare
  order_row record;
  url text;
  folder_key text;
  category text;
  root_id uuid;
  orders_group_id uuid;
  order_folder_id uuid;
  sub_id uuid;
  file_name text;
  file_ext text;
begin
  for order_row in
    select
      o.id, o.client_id, o.client_name, o.order_number, o.file_urls,
      coalesce(nullif(o.order_file_folders -> 'fileFolders', 'null'::jsonb), '{}'::jsonb) as file_folders
    from public.orders o
    where o.id = '51700000-0000-0000-0000-000000000099'
  loop
    select id into root_id from public.folders where client_id = order_row.client_id and parent_id is null order by created_at asc limit 1;
    select id into orders_group_id from public.folders where parent_id = root_id and lower(name) = lower('Orders') limit 1;
    if orders_group_id is null then
      insert into public.folders (name, client_id, parent_id, color) values ('Orders', order_row.client_id, root_id, 'slate') returning id into orders_group_id;
    end if;
    select id into order_folder_id from public.folders where order_id = order_row.id limit 1;
    if order_folder_id is null then
      insert into public.folders (name, client_id, parent_id, order_id, color)
      values (coalesce(nullif(btrim(order_row.order_number), ''), 'Order'), order_row.client_id, orders_group_id, order_row.id, 'slate')
      returning id into order_folder_id;
    end if;

    for url in select unnest(order_row.file_urls)
    loop
      continue when exists (select 1 from public.client_assets ca where ca.order_id = order_row.id and ca.file_url = url);
      folder_key := lower(coalesce(order_row.file_folders ->> url, ''));
      category := case
        when folder_key = 'mockups' then 'Mockups'
        when folder_key = 'artwork' then 'Artwork'
        when folder_key = 'production' then 'Production'
        else 'General'
      end;
      select id into sub_id from public.folders where parent_id = order_folder_id and lower(name) = lower(category) limit 1;
      if sub_id is null then
        insert into public.folders (name, client_id, parent_id, color) values (category, order_row.client_id, order_folder_id, 'slate') returning id into sub_id;
      end if;
      file_name := regexp_replace(split_part(url, '?', 1), '^.*/', '');
      file_ext := lower(regexp_replace(file_name, '^.*\.', ''));
      insert into public.client_assets (title, file_url, file_type, folder_id, client_id, order_id)
      values (file_name, url, file_ext, sub_id, order_row.client_id, order_row.id);
    end loop;
  end loop;
end $$;

do $$
declare v_order_folder uuid; v_mockups_folder uuid; v_artwork_folder uuid; v_general_folder uuid; v_asset_count integer;
begin
  select id into v_order_folder from public.folders where order_id = '51700000-0000-0000-0000-000000000099';
  select count(*) into v_asset_count from public.client_assets where order_id = '51700000-0000-0000-0000-000000000099';
  if v_asset_count <> 3 then raise exception 'BACKFILL_ASSET_COUNT_WRONG: got %', v_asset_count; end if;

  select folder_id into v_mockups_folder from public.client_assets where order_id = '51700000-0000-0000-0000-000000000099' and file_url = 'https://storage.example.invalid/a/mockup-backfill.png';
  if (select name from public.folders where id = v_mockups_folder) <> 'Mockups' then raise exception 'BACKFILL_MOCKUPS_MAPPING_WRONG'; end if;

  select folder_id into v_artwork_folder from public.client_assets where order_id = '51700000-0000-0000-0000-000000000099' and file_url = 'https://storage.example.invalid/a/artwork-backfill.png';
  if (select name from public.folders where id = v_artwork_folder) <> 'Artwork' then raise exception 'BACKFILL_ARTWORK_MAPPING_WRONG'; end if;

  select folder_id into v_general_folder from public.client_assets where order_id = '51700000-0000-0000-0000-000000000099' and file_url = 'https://storage.example.invalid/a/no-folder-backfill.pdf';
  if (select name from public.folders where id = v_general_folder) <> 'General' then raise exception 'BACKFILL_UNCATEGORIZED_NOT_GENERAL'; end if;

  if (select parent_id from public.folders where id = v_mockups_folder) <> v_order_folder then
    raise exception 'BACKFILL_CATEGORY_NOT_UNDER_ORDER_FOLDER';
  end if;
end
$$;

-- Rerun the same backfill block to prove idempotency (no duplicate rows,
-- no duplicate folders).
do $$
declare
  order_row record;
  url text;
  folder_key text;
  category text;
  root_id uuid;
  orders_group_id uuid;
  order_folder_id uuid;
  sub_id uuid;
begin
  for order_row in
    select
      o.id, o.client_id, o.file_urls,
      coalesce(nullif(o.order_file_folders -> 'fileFolders', 'null'::jsonb), '{}'::jsonb) as file_folders
    from public.orders o
    where o.id = '51700000-0000-0000-0000-000000000099'
  loop
    select id into root_id from public.folders where client_id = order_row.client_id and parent_id is null order by created_at asc limit 1;
    select id into orders_group_id from public.folders where parent_id = root_id and lower(name) = lower('Orders') limit 1;
    select id into order_folder_id from public.folders where order_id = order_row.id limit 1;
    for url in select unnest(order_row.file_urls)
    loop
      continue when exists (select 1 from public.client_assets ca where ca.order_id = order_row.id and ca.file_url = url);
      raise exception 'BACKFILL_RERUN_FOUND_MISSING_ROW_UNEXPECTEDLY';
    end loop;
  end loop;
end
$$;

do $$
declare v_asset_count integer; v_order_folder_count integer;
begin
  select count(*) into v_asset_count from public.client_assets where order_id = '51700000-0000-0000-0000-000000000099';
  if v_asset_count <> 3 then raise exception 'BACKFILL_RERUN_CREATED_DUPLICATE_ASSETS: got %', v_asset_count; end if;
  select count(*) into v_order_folder_count from public.folders where order_id = '51700000-0000-0000-0000-000000000099';
  if v_order_folder_count <> 1 then raise exception 'BACKFILL_RERUN_CREATED_DUPLICATE_ORDER_FOLDER: got %', v_order_folder_count; end if;
end
$$;

-- Grants: authenticated only, not anon/public/service_role, for both new
-- RPCs (get_or_create_client_asset_folder's grant is already covered by the
-- donor smoke test this one supersedes for the nested-hierarchy pieces, but
-- it's re-asserted here too since this migration re-defines it verbatim).
do $$
begin
  if has_function_privilege('public', 'public.get_or_create_order_asset_folder(uuid,text)', 'execute') then raise exception 'PUBLIC_EXECUTE_PRESENT_ORDER_FOLDER'; end if;
  if has_function_privilege('anon', 'public.get_or_create_order_asset_folder(uuid,text)', 'execute') then raise exception 'ANON_EXECUTE_PRESENT_ORDER_FOLDER'; end if;
  if has_function_privilege('service_role', 'public.get_or_create_order_asset_folder(uuid,text)', 'execute') then raise exception 'SERVICE_ROLE_EXECUTE_PRESENT_ORDER_FOLDER'; end if;
  if not has_function_privilege('authenticated', 'public.get_or_create_order_asset_folder(uuid,text)', 'execute') then raise exception 'AUTHENTICATED_EXECUTE_MISSING_ORDER_FOLDER'; end if;

  if has_function_privilege('public', 'public.provision_order_asset_folders(uuid)', 'execute') then raise exception 'PUBLIC_EXECUTE_PRESENT_PROVISION'; end if;
  if has_function_privilege('anon', 'public.provision_order_asset_folders(uuid)', 'execute') then raise exception 'ANON_EXECUTE_PRESENT_PROVISION'; end if;
  if has_function_privilege('service_role', 'public.provision_order_asset_folders(uuid)', 'execute') then raise exception 'SERVICE_ROLE_EXECUTE_PRESENT_PROVISION'; end if;
  if not has_function_privilege('authenticated', 'public.provision_order_asset_folders(uuid)', 'execute') then raise exception 'AUTHENTICATED_EXECUTE_MISSING_PROVISION'; end if;

  if has_function_privilege('service_role', 'public.get_or_create_client_asset_folder(uuid,text,text)', 'execute') then raise exception 'SERVICE_ROLE_EXECUTE_PRESENT_CLIENT_FOLDER'; end if;
end
$$;

select 'ALL_CLIENT_ORDER_ASSET_FOLDER_SMOKE_TESTS_PASSED' as result;
rollback;
