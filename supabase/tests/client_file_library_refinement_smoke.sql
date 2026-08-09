\set ON_ERROR_STOP on

-- Smoke test for Phase 1A.1 (202608080002_client_file_library_refinement.sql):
-- the client-first "All Files -> Clients -> <Client> -> <category>"
-- hierarchy, canonical (client_id, file_url) asset uniqueness, and the
-- redefined-but-signature-compatible order RPCs. Run against a disposable
-- full-schema stack that already has 202608080001 applied. Entirely inside
-- one transaction, rolled back at the end — never touches a real database.

begin;

insert into public.tenants (id, slug, name) values
  ('81000000-0000-0000-0000-000000000001', 'lib-refine-smoke-a', 'Lib Refine Smoke A'),
  ('82000000-0000-0000-0000-000000000002', 'lib-refine-smoke-b', 'Lib Refine Smoke B');

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data) values
  ('8a000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'staff-a@lib-refine-smoke.invalid', '{}'::jsonb, '{}'::jsonb),
  ('8b000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'staff-b@lib-refine-smoke.invalid', '{}'::jsonb, '{}'::jsonb);

insert into public.users (id, auth_user_id, user_email, full_name, role) values
  ('81100000-0000-0000-0000-000000000001', '8a000000-0000-0000-0000-000000000001', 'staff-a@lib-refine-smoke.invalid', 'Staff A', 'staff'),
  ('82100000-0000-0000-0000-000000000002', '8b000000-0000-0000-0000-000000000002', 'staff-b@lib-refine-smoke.invalid', 'Staff B', 'staff');

insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role) values
  ('81000000-0000-0000-0000-000000000001', '8a000000-0000-0000-0000-000000000001', 'member'),
  ('82000000-0000-0000-0000-000000000002', '8b000000-0000-0000-0000-000000000002', 'member');

insert into public.clients (id, name, email, tenant_id) values
  ('81300000-0000-0000-0000-000000000001', 'Lib Refine Client A', 'client-a@lib-refine-smoke.invalid', '81000000-0000-0000-0000-000000000001'),
  ('81300000-0000-0000-0000-000000000002', 'Lib Refine Client A2', 'client-a2@lib-refine-smoke.invalid', '81000000-0000-0000-0000-000000000001'),
  ('82300000-0000-0000-0000-000000000003', 'Lib Refine Client B', 'client-b@lib-refine-smoke.invalid', '82000000-0000-0000-0000-000000000002'),
  -- Deliberately share the identical name from the start (neither has a
  -- root folder yet) so test #15 exercises a real collision, not a
  -- pre-existing-root reuse.
  ('81300000-0000-0000-0000-000000000004', 'Collision Client', 'collision-1@lib-refine-smoke.invalid', '81000000-0000-0000-0000-000000000001'),
  ('81300000-0000-0000-0000-000000000005', 'Collision Client', 'collision-2@lib-refine-smoke.invalid', '81000000-0000-0000-0000-000000000001');

insert into public.orders (
  id, order_number, client_name, client_email, client_id, products, total_amount,
  deposit_paid, status, tenant_id
) values
  ('81700000-0000-0000-0000-000000000001', 'ORD-LR-A1', 'Lib Refine Client A',
   'client-a@lib-refine-smoke.invalid', '81300000-0000-0000-0000-000000000001',
   '[{"id":"1","name":"Line one","quantity":1,"price":100}]'::jsonb, 100, 0, 'confirmed',
   '81000000-0000-0000-0000-000000000001'),
  ('81700000-0000-0000-0000-000000000002', 'ORD-LR-A2', 'Lib Refine Client A',
   'client-a@lib-refine-smoke.invalid', '81300000-0000-0000-0000-000000000001',
   '[{"id":"1","name":"Line two","quantity":1,"price":50}]'::jsonb, 50, 0, 'confirmed',
   '81000000-0000-0000-0000-000000000001'),
  ('82700000-0000-0000-0000-000000000003', 'ORD-LR-B1', 'Lib Refine Client B',
   'client-b@lib-refine-smoke.invalid', '82300000-0000-0000-0000-000000000003',
   '[{"id":"1","name":"Line one","quantity":1,"price":100}]'::jsonb, 100, 0, 'confirmed',
   '82000000-0000-0000-0000-000000000002');

set local role authenticated;
set local request.jwt.claim.sub = '8a000000-0000-0000-0000-000000000001';
set local request.jwt.claim.email = 'staff-a@lib-refine-smoke.invalid';
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"8a000000-0000-0000-0000-000000000001","email":"staff-a@lib-refine-smoke.invalid","role":"authenticated"}';

-- 1. New hierarchy: All Files -> Clients -> <Client> -> <category>.
-- 2. No physical "Orders" grouping folder, no physical ORD-XXXXX folder,
--    are ever created by the redefined RPC.
do $$
declare v_root uuid; v_category uuid; v_clients_root uuid;
begin
  v_root := public.get_or_create_order_asset_folder('81700000-0000-0000-0000-000000000001', null);
  v_category := public.get_or_create_order_asset_folder('81700000-0000-0000-0000-000000000001', 'Mockups');

  select parent_id into v_clients_root from public.folders where id = v_root;
  if (select folder_kind from public.folders where id = v_clients_root) <> 'clients_root' then
    raise exception 'CLIENT_ROOT_NOT_UNDER_CLIENTS_ROOT';
  end if;
  if (select name from public.folders where id = v_clients_root) <> 'Clients' then
    raise exception 'CLIENTS_ROOT_NAME_WRONG';
  end if;
  if (select parent_id from public.folders where id = v_category) <> v_root then
    raise exception 'CATEGORY_NOT_DIRECTLY_UNDER_CLIENT_ROOT';
  end if;
  if exists (select 1 from public.folders where client_id = '81300000-0000-0000-0000-000000000001' and lower(name) = lower('Orders')) then
    raise exception 'ORDERS_GROUPING_FOLDER_WAS_CREATED';
  end if;
  if exists (select 1 from public.folders where order_id = '81700000-0000-0000-0000-000000000001') then
    raise exception 'PHYSICAL_ORDER_FOLDER_WAS_CREATED';
  end if;
end
$$;

-- 3. Provisioning with zero files works (provision_order_asset_folders is
--    the only thing that ever pre-creates category folders before a file
--    exists).
-- 4. Repeated provisioning creates zero duplicates.
do $$
declare v_root uuid; v_count_first integer; v_count_second integer;
begin
  v_root := public.provision_order_asset_folders('81700000-0000-0000-0000-000000000002');
  select count(*) into v_count_first from public.folders where parent_id = v_root;
  if v_count_first <> 9 then raise exception 'STANDARD_CATEGORY_SET_INCOMPLETE: got % of 9', v_count_first; end if;

  perform public.provision_order_asset_folders('81700000-0000-0000-0000-000000000002');
  select count(*) into v_count_second from public.folders where parent_id = v_root;
  if v_count_second <> 9 then raise exception 'REPEAT_PROVISIONING_CREATED_DUPLICATES: got %', v_count_second; end if;

  if not exists (select 1 from public.folders where parent_id = v_root and name = 'Brand Assets') then
    raise exception 'BRAND_ASSETS_CATEGORY_MISSING';
  end if;
  if not exists (select 1 from public.folders where parent_id = v_root and name = 'References') then
    raise exception 'REFERENCES_CATEGORY_MISSING';
  end if;
end
$$;

-- 5/6. Canonical same-client-file uniqueness: the SAME file linked from
-- TWO different orders for the same client must never produce a second
-- client_assets row — enforced by idx_client_assets_client_file_url_unique.
do $$
declare v_category_1 uuid; v_category_2 uuid; v_count integer;
begin
  v_category_1 := public.get_or_create_order_asset_folder('81700000-0000-0000-0000-000000000001', 'Mockups');
  v_category_2 := public.get_or_create_order_asset_folder('81700000-0000-0000-0000-000000000002', 'Mockups');
  -- Both orders belong to the same client, so both RPC calls must resolve
  -- to the exact same category folder — there is no per-order folder any
  -- more to keep them apart.
  if v_category_1 <> v_category_2 then raise exception 'SAME_CLIENT_DIFFERENT_ORDERS_GOT_DIFFERENT_CATEGORY_FOLDERS'; end if;

  insert into public.client_assets (title, file_url, file_type, folder_id, client_id, order_id)
  values ('shared-mockup.png', 'private-upload://uploads/shared/mockup.png', 'png', v_category_1,
          '81300000-0000-0000-0000-000000000001', '81700000-0000-0000-0000-000000000001');

  begin
    insert into public.client_assets (title, file_url, file_type, folder_id, client_id, order_id)
    values ('shared-mockup.png', 'private-upload://uploads/shared/mockup.png', 'png', v_category_2,
            '81300000-0000-0000-0000-000000000001', '81700000-0000-0000-0000-000000000002');
    raise exception 'SECOND_ORDER_LINKING_SAME_FILE_CREATED_A_SECOND_CANONICAL_ASSET';
  exception when unique_violation then
    null; -- expected: idx_client_assets_client_file_url_unique rejects it
  end;

  select count(*) into v_count from public.client_assets
  where client_id = '81300000-0000-0000-0000-000000000001' and file_url = 'private-upload://uploads/shared/mockup.png';
  if v_count <> 1 then raise exception 'CANONICAL_ASSET_ROW_COUNT_WRONG: got %', v_count; end if;
end
$$;

-- 15. Client same-name collision handling: two different clients with the
-- identical display name must get disambiguated labels, never silently
-- collapsed into one folder.
do $$
declare v_root_1 uuid; v_root_2 uuid; v_name_1 text; v_name_2 text;
begin
  v_root_1 := public.get_or_create_client_asset_folder('81300000-0000-0000-0000-000000000004', 'Collision Client', null);
  v_root_2 := public.get_or_create_client_asset_folder('81300000-0000-0000-0000-000000000005', 'Collision Client', null);
  if v_root_1 = v_root_2 then raise exception 'TWO_DIFFERENT_CLIENTS_COLLAPSED_INTO_ONE_ROOT_FOLDER'; end if;
  select name into v_name_1 from public.folders where id = v_root_1;
  select name into v_name_2 from public.folders where id = v_root_2;
  if v_name_1 = v_name_2 then raise exception 'COLLIDING_CLIENT_NAMES_NOT_DISAMBIGUATED'; end if;
  if v_name_2 !~ '·' then raise exception 'DISAMBIGUATED_LABEL_MISSING_SUFFIX_MARKER: got %', v_name_2; end if;
end
$$;

-- 16. Cross-tenant order is rejected even for an authenticated staff
-- member.
do $$
declare v_code text;
begin
  begin
    perform public.get_or_create_order_asset_folder('82700000-0000-0000-0000-000000000003', null);
    raise exception 'CROSS_TENANT_ORDER_ACCEPTED';
  exception when others then
    get stacked diagnostics v_code = message_text;
    if v_code <> 'FOLDER_ACCESS_DENIED' then raise; end if;
  end;
end
$$;

reset role;
set local request.jwt.claim.sub = '';
set local request.jwt.claim.email = '';
set local request.jwt.claim.role = '';
set local request.jwt.claims = '';

-- 17. Unauthenticated (no auth.uid()) call is rejected.
do $$
declare v_code text;
begin
  begin
    perform public.get_or_create_order_asset_folder('81700000-0000-0000-0000-000000000001', null);
    raise exception 'UNAUTHENTICATED_CALL_ACCEPTED';
  exception when others then
    get stacked diagnostics v_code = message_text;
    if v_code <> 'FOLDER_AUTH_REQUIRED' then raise; end if;
  end;
end
$$;

-- Tenant isolation (RLS): tenant B cannot see tenant A's Clients root,
-- client roots, category folders, or client_assets.
set local role authenticated;
set local request.jwt.claim.sub = '8b000000-0000-0000-0000-000000000002';
set local request.jwt.claim.email = 'staff-b@lib-refine-smoke.invalid';
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"8b000000-0000-0000-0000-000000000002","email":"staff-b@lib-refine-smoke.invalid","role":"authenticated"}';
do $$
begin
  if (select count(*) from public.folders where tenant_id = '81000000-0000-0000-0000-000000000001') <> 0 then
    raise exception 'TENANT_B_CAN_SEE_TENANT_A_FOLDERS';
  end if;
  if (select count(*) from public.client_assets where client_id = '81300000-0000-0000-0000-000000000001') <> 0 then
    raise exception 'TENANT_B_CAN_SEE_TENANT_A_ASSETS';
  end if;
end
$$;
reset role;

-- Grants: authenticated only, not anon/public/service_role, including the
-- new get_or_create_clients_root helper.
do $$
begin
  if has_function_privilege('public', 'public.get_or_create_clients_root(uuid)', 'execute') then raise exception 'PUBLIC_EXECUTE_PRESENT_CLIENTS_ROOT'; end if;
  if has_function_privilege('anon', 'public.get_or_create_clients_root(uuid)', 'execute') then raise exception 'ANON_EXECUTE_PRESENT_CLIENTS_ROOT'; end if;
  if has_function_privilege('service_role', 'public.get_or_create_clients_root(uuid)', 'execute') then raise exception 'SERVICE_ROLE_EXECUTE_PRESENT_CLIENTS_ROOT'; end if;
  if not has_function_privilege('authenticated', 'public.get_or_create_clients_root(uuid)', 'execute') then raise exception 'AUTHENTICATED_EXECUTE_MISSING_CLIENTS_ROOT'; end if;
end
$$;

-- ═══════════════════════════════════════════════════════════════════
-- Legacy-adoption amendment: get_or_create_clients_root must reuse a
-- pre-existing manually-created "Clients" folder (folder_kind still null
-- because it predates this migration), never create a competing second
-- one, and must raise an explicit, distinct error rather than guess when
-- more than one compatible candidate exists. Mirrors the real production
-- shape: a "Clients" folder built by hand ~1-2 days before this
-- migration ever ran, with a "Lazi" child folder and 6 loose private
-- files, all client_id/folder_kind still null throughout.
-- ═══════════════════════════════════════════════════════════════════

insert into public.tenants (id, slug, name) values
  ('83000000-0000-0000-0000-000000000001', 'lib-refine-smoke-legacy', 'Lib Refine Smoke Legacy'),
  ('84000000-0000-0000-0000-000000000001', 'lib-refine-smoke-ambiguous', 'Lib Refine Smoke Ambiguous');

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data) values
  ('83a00000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'staff-legacy@lib-refine-smoke.invalid', '{}'::jsonb, '{}'::jsonb),
  ('84a00000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'staff-ambiguous@lib-refine-smoke.invalid', '{}'::jsonb, '{}'::jsonb);

insert into public.users (id, auth_user_id, user_email, full_name, role) values
  ('83100000-0000-0000-0000-000000000001', '83a00000-0000-0000-0000-000000000001', 'staff-legacy@lib-refine-smoke.invalid', 'Staff Legacy', 'staff'),
  ('84100000-0000-0000-0000-000000000001', '84a00000-0000-0000-0000-000000000001', 'staff-ambiguous@lib-refine-smoke.invalid', 'Staff Ambiguous', 'staff');

insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role) values
  ('83000000-0000-0000-0000-000000000001', '83a00000-0000-0000-0000-000000000001', 'member'),
  ('84000000-0000-0000-0000-000000000001', '84a00000-0000-0000-0000-000000000001', 'member');

insert into public.clients (id, name, email, tenant_id) values
  ('83300000-0000-0000-0000-000000000001', 'Lazi', 'lazi@lib-refine-smoke.invalid', '83000000-0000-0000-0000-000000000001');

-- A manually-created "Clients" folder predating this migration:
-- parent_id null, client_id null, name = 'Clients', folder_kind null —
-- exactly the production shape.
insert into public.folders (id, name, client_id, parent_id, tenant_id, color, created_at) values
  ('83900000-0000-0000-0000-000000000001', 'Clients', null, null, '83000000-0000-0000-0000-000000000001', 'blue', now() - interval '2 days');

set local role authenticated;
set local request.jwt.claim.sub = '83a00000-0000-0000-0000-000000000001';
set local request.jwt.claim.email = 'staff-legacy@lib-refine-smoke.invalid';
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"83a00000-0000-0000-0000-000000000001","email":"staff-legacy@lib-refine-smoke.invalid","role":"authenticated"}';

-- 1/2. Legacy root-level Clients (folder_kind null) is reused, not
-- duplicated.
do $$
declare v_result uuid; v_count integer; v_created_at timestamptz;
begin
  v_result := public.get_or_create_clients_root('83000000-0000-0000-0000-000000000001');
  if v_result <> '83900000-0000-0000-0000-000000000001' then
    raise exception 'LEGACY_CLIENTS_ROOT_NOT_REUSED: got %', v_result;
  end if;
  select count(*) into v_count
  from public.folders
  where tenant_id = '83000000-0000-0000-0000-000000000001' and lower(btrim(name)) = 'clients';
  if v_count <> 1 then raise exception 'SECOND_CLIENTS_ROOT_WAS_CREATED: got % rows named Clients', v_count; end if;

  -- 4. The migration RPC never modifies the reused row — it's read-only
  -- reuse; even folder_kind stays null (the manual restructure script,
  -- not this RPC, is what ever tags it canonical).
  select created_at into v_created_at from public.folders where id = '83900000-0000-0000-0000-000000000001';
  if v_created_at <> (now() - interval '2 days')::timestamptz and abs(extract(epoch from (v_created_at - (now() - interval '2 days')))) > 1 then
    raise exception 'MIGRATION_RPC_MODIFIED_EXISTING_ROW_CREATED_AT';
  end if;
  if (select folder_kind from public.folders where id = '83900000-0000-0000-0000-000000000001') is not null then
    raise exception 'MIGRATION_RPC_TAGGED_FOLDER_KIND_ON_EXISTING_ROW: reuse must stay read-only, tagging is the manual restructure script''s job';
  end if;
end
$$;
reset role;
set local request.jwt.claim.sub = '';
set local request.jwt.claim.email = '';
set local request.jwt.claim.role = '';
set local request.jwt.claims = '';

-- 3. Two equally-compatible legacy "Clients" candidates in the same
-- tenant: explicit ambiguity error, never a silent pick.
insert into public.folders (id, name, client_id, parent_id, tenant_id, color) values
  ('84900000-0000-0000-0000-000000000001', 'Clients', null, null, '84000000-0000-0000-0000-000000000001', 'blue'),
  ('84900000-0000-0000-0000-000000000002', 'CLIENTS', null, null, '84000000-0000-0000-0000-000000000001', 'blue');

set local role authenticated;
set local request.jwt.claim.sub = '84a00000-0000-0000-0000-000000000001';
set local request.jwt.claim.email = 'staff-ambiguous@lib-refine-smoke.invalid';
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"84a00000-0000-0000-0000-000000000001","email":"staff-ambiguous@lib-refine-smoke.invalid","role":"authenticated"}';
do $$
declare v_code text;
begin
  begin
    perform public.get_or_create_clients_root('84000000-0000-0000-0000-000000000001');
    raise exception 'AMBIGUOUS_CLIENTS_ROOT_SILENTLY_ACCEPTED';
  exception when others then
    get stacked diagnostics v_code = message_text;
    if v_code <> 'FOLDER_CLIENTS_ROOT_AMBIGUOUS' then raise; end if;
  end;
end
$$;
reset role;

-- ═══════════════════════════════════════════════════════════════════
-- Final safety patch: get_or_create_client_asset_folder must READ-ONLY
-- reuse an existing unowned legacy/manual client folder under Clients —
-- closing the sequencing window between 202608080002 deploying and the
-- manual restructure script actually adopting it (production shape:
-- Clients/Lazi, client_id/folder_kind null, 6 loose files) — instead of
-- creating a colliding "Lazi · xxxx" root.
-- ═══════════════════════════════════════════════════════════════════

-- 1. Legacy unowned client folder (Lazi) under the already-reused Clients
-- root (83900000-...-0001) is reused read-only by the client RPC, never
-- shadowed by a fresh "Lazi · xxxx" root, never mutated, loose assets
-- untouched. A category MAY still be created directly under the reused
-- root — the manual restructure adopts the root afterwards.
insert into public.folders (id, name, client_id, parent_id, tenant_id, color, created_at) values
  ('83900000-0000-0000-0000-000000000011', 'Lazi', null, '83900000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000001', 'blue', now() - interval '1 day');

insert into public.client_assets (id, title, file_url, file_type, folder_id, client_id, order_id) values
  ('83a10000-0000-0000-0000-000000000001', 'file1.png', 'private-upload://uploads/lazi/file1.png', 'png', '83900000-0000-0000-0000-000000000011', null, null),
  ('83a10000-0000-0000-0000-000000000002', 'file2.png', 'private-upload://uploads/lazi/file2.png', 'png', '83900000-0000-0000-0000-000000000011', null, null);

set local role authenticated;
set local request.jwt.claim.sub = '83a00000-0000-0000-0000-000000000001';
set local request.jwt.claim.email = 'staff-legacy@lib-refine-smoke.invalid';
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"83a00000-0000-0000-0000-000000000001","email":"staff-legacy@lib-refine-smoke.invalid","role":"authenticated"}';

do $$
declare
  v_root uuid;
  v_category uuid;
  v_folder_kind text;
  v_client_id uuid;
begin
  v_root := public.get_or_create_client_asset_folder('83300000-0000-0000-0000-000000000001', 'Lazi', null);
  if v_root <> '83900000-0000-0000-0000-000000000011' then
    raise exception 'SEQUENCING_WINDOW_LEGACY_LAZI_FOLDER_NOT_REUSED: got %', v_root;
  end if;

  select folder_kind, client_id into v_folder_kind, v_client_id from public.folders where id = v_root;
  if v_folder_kind is not null then raise exception 'RPC_MUTATED_FOLDER_KIND_ON_READ_ONLY_REUSE'; end if;
  if v_client_id is not null then raise exception 'RPC_MUTATED_CLIENT_ID_ON_READ_ONLY_REUSE'; end if;

  if (select count(*) from public.folders where parent_id = '83900000-0000-0000-0000-000000000001' and lower(btrim(name)) = 'lazi') <> 1 then
    raise exception 'DUPLICATE_LAZI_ROOT_WAS_CREATED';
  end if;

  if exists (
    select 1 from public.client_assets
    where id in ('83a10000-0000-0000-0000-000000000001', '83a10000-0000-0000-0000-000000000002')
      and (client_id is not null or folder_id <> '83900000-0000-0000-0000-000000000011')
  ) then
    raise exception 'RPC_MUTATED_LOOSE_LEGACY_ASSETS';
  end if;

  v_category := public.get_or_create_client_asset_folder('83300000-0000-0000-0000-000000000001', 'Lazi', 'Mockups');
  if (select parent_id from public.folders where id = v_category) <> '83900000-0000-0000-0000-000000000011' then
    raise exception 'CATEGORY_NOT_CREATED_UNDER_REUSED_LEGACY_ROOT';
  end if;
end
$$;
reset role;
set local request.jwt.claim.sub = '';
set local request.jwt.claim.email = '';
set local request.jwt.claim.role = '';
set local request.jwt.claims = '';

-- 2. Same shape, but the legacy folder's subtree already carries a
-- DIFFERENT client's asset: the RPC must refuse with an explicit
-- conflict, never silently create a duplicate root and never adopt.
insert into public.tenants (id, slug, name) values
  ('85000000-0000-0000-0000-000000000001', 'lib-refine-smoke-conflict', 'Lib Refine Smoke Conflict');
insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data) values
  ('85a00000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'staff-conflict@lib-refine-smoke.invalid', '{}'::jsonb, '{}'::jsonb);
insert into public.users (id, auth_user_id, user_email, full_name, role) values
  ('85100000-0000-0000-0000-000000000001', '85a00000-0000-0000-0000-000000000001', 'staff-conflict@lib-refine-smoke.invalid', 'Staff Conflict', 'staff');
insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role) values
  ('85000000-0000-0000-0000-000000000001', '85a00000-0000-0000-0000-000000000001', 'member');
insert into public.clients (id, name, email, tenant_id) values
  ('85300000-0000-0000-0000-000000000001', 'Conflict Client', 'conflict-1@lib-refine-smoke.invalid', '85000000-0000-0000-0000-000000000001'),
  ('85300000-0000-0000-0000-000000000002', 'Other Client', 'conflict-2@lib-refine-smoke.invalid', '85000000-0000-0000-0000-000000000001');
insert into public.folders (id, name, client_id, parent_id, tenant_id, color) values
  ('85900000-0000-0000-0000-000000000001', 'Clients', null, null, '85000000-0000-0000-0000-000000000001', 'blue'),
  ('85900000-0000-0000-0000-000000000011', 'Conflict Client', null, '85900000-0000-0000-0000-000000000001', '85000000-0000-0000-0000-000000000001', 'blue');
insert into public.client_assets (id, title, file_url, file_type, folder_id, client_id) values
  ('85a10000-0000-0000-0000-000000000001', 'already-owned.png', 'private-upload://uploads/conflict/already-owned.png', 'png', '85900000-0000-0000-0000-000000000011', '85300000-0000-0000-0000-000000000002');

set local role authenticated;
set local request.jwt.claim.sub = '85a00000-0000-0000-0000-000000000001';
set local request.jwt.claim.email = 'staff-conflict@lib-refine-smoke.invalid';
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"85a00000-0000-0000-0000-000000000001","email":"staff-conflict@lib-refine-smoke.invalid","role":"authenticated"}';
do $$
declare v_code text;
begin
  begin
    perform public.get_or_create_client_asset_folder('85300000-0000-0000-0000-000000000001', 'Conflict Client', null);
    raise exception 'CONFLICTING_LEGACY_FOLDER_SILENTLY_ACCEPTED';
  exception when others then
    get stacked diagnostics v_code = message_text;
    if v_code <> 'FOLDER_CLIENT_ROOT_CONFLICT' then raise; end if;
  end;

  if exists (select 1 from public.folders where client_id = '85300000-0000-0000-0000-000000000001') then
    raise exception 'DUPLICATE_ROOT_CREATED_DESPITE_CONFLICT';
  end if;
  if (select client_id from public.folders where id = '85900000-0000-0000-0000-000000000011') is not null then
    raise exception 'CONFLICTING_LEGACY_FOLDER_WAS_MUTATED';
  end if;
end
$$;
reset role;
set local request.jwt.claim.sub = '';
set local request.jwt.claim.email = '';
set local request.jwt.claim.role = '';
set local request.jwt.claims = '';

-- 3. Two safe (non-conflicting) unowned candidates both matching the same
-- client's approved identity fields (one by name, one by whatsapp_name):
-- explicit FOLDER_CLIENT_ROOT_AMBIGUOUS, never a silent pick.
insert into public.tenants (id, slug, name) values
  ('86000000-0000-0000-0000-000000000001', 'lib-refine-smoke-root-ambiguous', 'Lib Refine Smoke Root Ambiguous');
insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data) values
  ('86a00000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'staff-root-ambiguous@lib-refine-smoke.invalid', '{}'::jsonb, '{}'::jsonb);
insert into public.users (id, auth_user_id, user_email, full_name, role) values
  ('86100000-0000-0000-0000-000000000001', '86a00000-0000-0000-0000-000000000001', 'staff-root-ambiguous@lib-refine-smoke.invalid', 'Staff Root Ambiguous', 'staff');
insert into public.tenant_memberships (tenant_id, auth_user_id, tenant_role) values
  ('86000000-0000-0000-0000-000000000001', '86a00000-0000-0000-0000-000000000001', 'member');
insert into public.clients (id, name, whatsapp_name, email, tenant_id) values
  ('86300000-0000-0000-0000-000000000001', 'Ambiguous Co', 'Ambiguous WA', 'ambiguous@lib-refine-smoke.invalid', '86000000-0000-0000-0000-000000000001');
insert into public.folders (id, name, client_id, parent_id, tenant_id, color) values
  ('86900000-0000-0000-0000-000000000001', 'Clients', null, null, '86000000-0000-0000-0000-000000000001', 'blue'),
  ('86900000-0000-0000-0000-000000000011', 'Ambiguous Co', null, '86900000-0000-0000-0000-000000000001', '86000000-0000-0000-0000-000000000001', 'blue'),
  ('86900000-0000-0000-0000-000000000012', 'Ambiguous WA', null, '86900000-0000-0000-0000-000000000001', '86000000-0000-0000-0000-000000000001', 'blue');

set local role authenticated;
set local request.jwt.claim.sub = '86a00000-0000-0000-0000-000000000001';
set local request.jwt.claim.email = 'staff-root-ambiguous@lib-refine-smoke.invalid';
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"86a00000-0000-0000-0000-000000000001","email":"staff-root-ambiguous@lib-refine-smoke.invalid","role":"authenticated"}';
do $$
declare v_code text;
begin
  begin
    perform public.get_or_create_client_asset_folder('86300000-0000-0000-0000-000000000001', 'Ambiguous Co', null);
    raise exception 'AMBIGUOUS_CLIENT_ROOT_SILENTLY_ACCEPTED';
  exception when others then
    get stacked diagnostics v_code = message_text;
    if v_code <> 'FOLDER_CLIENT_ROOT_AMBIGUOUS' then raise; end if;
  end;
end
$$;
reset role;

select 'ALL_CLIENT_FILE_LIBRARY_REFINEMENT_SMOKE_TESTS_PASSED' as result;
rollback;
