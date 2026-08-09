\set ON_ERROR_STOP on

-- Smoke test for the hardened
-- supabase/backfills/client_file_library_historical_backfill.sql: blob:
-- URL exclusion before any side effect, cross-order category preference
-- (non-General wins, deterministic earliest-non-General tie-break),
-- origin order_id always the earliest occurrence, canonical
-- (client_id, file_url) dedup, URL byte-identity, existing root/category
-- reuse, and category identity-conflict abort. Run against a disposable
-- full-schema stack that already has 202608080001/202608080002 applied
-- and the client-first hierarchy restructured. Entirely inside one
-- transaction, rolled back at the end — never touches a real database.
--
-- Uses `\i` to execute the actual backfill script file in place, so this
-- test exercises the real script, not a reimplementation of it.

begin;

insert into public.tenants (id, slug, name) values
  ('95000000-0000-0000-0000-000000000001', 'backfill-safety-patch', 'Backfill Safety Patch');

insert into public.clients (id, name, email, tenant_id) values
  ('95300000-0000-0000-0000-000000000001', 'BlobOnly Client', 'blobonly@backfill-safety.invalid', '95000000-0000-0000-0000-000000000001'),
  ('95300000-0000-0000-0000-000000000002', 'MixedValidBlob Client', 'mixed@backfill-safety.invalid', '95000000-0000-0000-0000-000000000001'),
  ('95300000-0000-0000-0000-000000000003', 'GeneralThenMockups Client', 'g2m@backfill-safety.invalid', '95000000-0000-0000-0000-000000000001'),
  ('95300000-0000-0000-0000-000000000004', 'GeneralThenArtwork Client', 'g2a@backfill-safety.invalid', '95000000-0000-0000-0000-000000000001'),
  ('95300000-0000-0000-0000-000000000005', 'GeneralOnlyTwice Client', 'g2g@backfill-safety.invalid', '95000000-0000-0000-0000-000000000001'),
  ('95300000-0000-0000-0000-000000000006', 'GeneralThenProduction Client', 'g2p@backfill-safety.invalid', '95000000-0000-0000-0000-000000000001'),
  ('95300000-0000-0000-0000-000000000007', 'MultiSpecificOlderArtwork Client', 'multi1@backfill-safety.invalid', '95000000-0000-0000-0000-000000000001'),
  ('95300000-0000-0000-0000-000000000008', 'MultiSpecificReversed Client', 'multi2@backfill-safety.invalid', '95000000-0000-0000-0000-000000000001'),
  ('95300000-0000-0000-0000-000000000009', 'AlreadyCanonical Client', 'canonical@backfill-safety.invalid', '95000000-0000-0000-0000-000000000001'),
  ('95300000-0000-0000-0000-000000000011', 'PrivateUploadUrl Client', 'privurl@backfill-safety.invalid', '95000000-0000-0000-0000-000000000001'),
  ('95300000-0000-0000-0000-000000000012', 'SupabasePublicUploadsUrl Client', 'pubuploads@backfill-safety.invalid', '95000000-0000-0000-0000-000000000001'),
  ('95300000-0000-0000-0000-000000000013', 'XlabAssetsPublicUrl Client', 'xlabassets@backfill-safety.invalid', '95000000-0000-0000-0000-000000000001'),
  ('95300000-0000-0000-0000-000000000017', 'ReuseRoot Client', 'reuseroot@backfill-safety.invalid', '95000000-0000-0000-0000-000000000001'),
  ('95300000-0000-0000-0000-000000000018', 'ReuseCategory Client', 'reusecat@backfill-safety.invalid', '95000000-0000-0000-0000-000000000001'),
  ('95300000-0000-0000-0000-000000000019', 'ConflictCategory Client', 'conflictcat@backfill-safety.invalid', '95000000-0000-0000-0000-000000000001'),
  ('95300000-0000-0000-0000-000000000020', 'OtherOwner Client', 'otherowner@backfill-safety.invalid', '95000000-0000-0000-0000-000000000001'),
  ('95300000-0000-0000-0000-000000000021', 'Collision Co', 'collision-a@backfill-safety.invalid', '95000000-0000-0000-0000-000000000001'),
  ('95300000-0000-0000-0000-000000000022', 'Collision Co', 'collision-b@backfill-safety.invalid', '95000000-0000-0000-0000-000000000001');

-- 1. Blob-only order.
insert into public.orders (id, order_number, client_name, client_id, tenant_id, file_urls, created_at) values
  ('95700000-0000-0000-0000-000000000001', 'ORD-BFS-01', 'BlobOnly Client', '95300000-0000-0000-0000-000000000001',
   '95000000-0000-0000-0000-000000000001', array['blob:https://ops.jointx.co.za/example-1'], now() - interval '10 days');

-- 2. Mixed valid + blob order.
insert into public.orders (id, order_number, client_name, client_id, tenant_id, file_urls, created_at) values
  ('95700000-0000-0000-0000-000000000002', 'ORD-BFS-02', 'MixedValidBlob Client', '95300000-0000-0000-0000-000000000002',
   '95000000-0000-0000-0000-000000000001',
   array['private-upload://uploads/mixed/valid.png', 'blob:https://joint-x-opps-abc123.vercel.app/example-2'],
   now() - interval '10 days');

-- 3. General (older) then Mockups (later), same file -> Mockups, order_id = older.
insert into public.orders (id, order_number, client_name, client_id, tenant_id, file_urls, order_file_folders, created_at) values
  ('95700000-0000-0000-0000-000000000003', 'ORD-BFS-03A', 'GeneralThenMockups Client', '95300000-0000-0000-0000-000000000003',
   '95000000-0000-0000-0000-000000000001', array['private-upload://uploads/g2m/shared.png'],
   jsonb_build_object('fileFolders', jsonb_build_object('private-upload://uploads/g2m/shared.png', 'general')),
   now() - interval '9 days'),
  ('95700000-0000-0000-0000-000000000004', 'ORD-BFS-03B', 'GeneralThenMockups Client', '95300000-0000-0000-0000-000000000003',
   '95000000-0000-0000-0000-000000000001', array['private-upload://uploads/g2m/shared.png'],
   jsonb_build_object('fileFolders', jsonb_build_object('private-upload://uploads/g2m/shared.png', 'mockups')),
   now() - interval '3 days');

-- 4. General then Artwork -> Artwork.
insert into public.orders (id, order_number, client_name, client_id, tenant_id, file_urls, order_file_folders, created_at) values
  ('95700000-0000-0000-0000-000000000005', 'ORD-BFS-04A', 'GeneralThenArtwork Client', '95300000-0000-0000-0000-000000000004',
   '95000000-0000-0000-0000-000000000001', array['private-upload://uploads/g2a/shared.png'],
   jsonb_build_object('fileFolders', jsonb_build_object('private-upload://uploads/g2a/shared.png', 'general')),
   now() - interval '9 days'),
  ('95700000-0000-0000-0000-000000000006', 'ORD-BFS-04B', 'GeneralThenArtwork Client', '95300000-0000-0000-0000-000000000004',
   '95000000-0000-0000-0000-000000000001', array['private-upload://uploads/g2a/shared.png'],
   jsonb_build_object('fileFolders', jsonb_build_object('private-upload://uploads/g2a/shared.png', 'artwork')),
   now() - interval '3 days');

-- 5. General only, twice -> General.
insert into public.orders (id, order_number, client_name, client_id, tenant_id, file_urls, order_file_folders, created_at) values
  ('95700000-0000-0000-0000-000000000007', 'ORD-BFS-05A', 'GeneralOnlyTwice Client', '95300000-0000-0000-0000-000000000005',
   '95000000-0000-0000-0000-000000000001', array['private-upload://uploads/g2g/shared.png'],
   jsonb_build_object('fileFolders', jsonb_build_object('private-upload://uploads/g2g/shared.png', 'general')),
   now() - interval '9 days'),
  ('95700000-0000-0000-0000-000000000008', 'ORD-BFS-05B', 'GeneralOnlyTwice Client', '95300000-0000-0000-0000-000000000005',
   '95000000-0000-0000-0000-000000000001', array['private-upload://uploads/g2g/shared.png'],
   jsonb_build_object('fileFolders', jsonb_build_object('private-upload://uploads/g2g/shared.png', 'general')),
   now() - interval '3 days');

-- 6. General then Production -> Production.
insert into public.orders (id, order_number, client_name, client_id, tenant_id, file_urls, order_file_folders, created_at) values
  ('95700000-0000-0000-0000-000000000009', 'ORD-BFS-06A', 'GeneralThenProduction Client', '95300000-0000-0000-0000-000000000006',
   '95000000-0000-0000-0000-000000000001', array['private-upload://uploads/g2p/shared.png'],
   jsonb_build_object('fileFolders', jsonb_build_object('private-upload://uploads/g2p/shared.png', 'general')),
   now() - interval '9 days'),
  ('95700000-0000-0000-0000-000000000010', 'ORD-BFS-06B', 'GeneralThenProduction Client', '95300000-0000-0000-0000-000000000006',
   '95000000-0000-0000-0000-000000000001', array['private-upload://uploads/g2p/shared.png'],
   jsonb_build_object('fileFolders', jsonb_build_object('private-upload://uploads/g2p/shared.png', 'production')),
   now() - interval '3 days');

-- 7. Multi-specific: older Artwork, later Mockups -> Artwork (earliest non-General), order_id = older (also earliest overall here).
insert into public.orders (id, order_number, client_name, client_id, tenant_id, file_urls, order_file_folders, created_at) values
  ('95700000-0000-0000-0000-000000000011', 'ORD-BFS-07A', 'MultiSpecificOlderArtwork Client', '95300000-0000-0000-0000-000000000007',
   '95000000-0000-0000-0000-000000000001', array['private-upload://uploads/multi1/shared.png'],
   jsonb_build_object('fileFolders', jsonb_build_object('private-upload://uploads/multi1/shared.png', 'artwork')),
   now() - interval '9 days'),
  ('95700000-0000-0000-0000-000000000012', 'ORD-BFS-07B', 'MultiSpecificOlderArtwork Client', '95300000-0000-0000-0000-000000000007',
   '95000000-0000-0000-0000-000000000001', array['private-upload://uploads/multi1/shared.png'],
   jsonb_build_object('fileFolders', jsonb_build_object('private-upload://uploads/multi1/shared.png', 'mockups')),
   now() - interval '3 days');

-- 8. Reversed: earliest General, then Mockups, then Artwork -> Mockups (earliest NON-General), order_id = earliest overall (the General one).
insert into public.orders (id, order_number, client_name, client_id, tenant_id, file_urls, order_file_folders, created_at) values
  ('95700000-0000-0000-0000-000000000013', 'ORD-BFS-08A', 'MultiSpecificReversed Client', '95300000-0000-0000-0000-000000000008',
   '95000000-0000-0000-0000-000000000001', array['private-upload://uploads/multi2/shared.png'],
   jsonb_build_object('fileFolders', jsonb_build_object('private-upload://uploads/multi2/shared.png', 'general')),
   now() - interval '9 days'),
  ('95700000-0000-0000-0000-000000000014', 'ORD-BFS-08B', 'MultiSpecificReversed Client', '95300000-0000-0000-0000-000000000008',
   '95000000-0000-0000-0000-000000000001', array['private-upload://uploads/multi2/shared.png'],
   jsonb_build_object('fileFolders', jsonb_build_object('private-upload://uploads/multi2/shared.png', 'mockups')),
   now() - interval '6 days'),
  ('95700000-0000-0000-0000-000000000015', 'ORD-BFS-08C', 'MultiSpecificReversed Client', '95300000-0000-0000-0000-000000000008',
   '95000000-0000-0000-0000-000000000001', array['private-upload://uploads/multi2/shared.png'],
   jsonb_build_object('fileFolders', jsonb_build_object('private-upload://uploads/multi2/shared.png', 'artwork')),
   now() - interval '3 days');

-- 9. Already-canonical pair: pre-existing ClientAsset must never be duplicated
-- or re-categorized, even though a real order references the same file with
-- a different category.
insert into public.folders (id, name, client_id, parent_id, tenant_id, folder_kind, color) values
  ('95900000-0000-0000-0000-000000000901', 'AlreadyCanonical Client', '95300000-0000-0000-0000-000000000009', null, '95000000-0000-0000-0000-000000000001', 'client_root', 'blue'),
  ('95900000-0000-0000-0000-000000000902', 'General', '95300000-0000-0000-0000-000000000009', '95900000-0000-0000-0000-000000000901', '95000000-0000-0000-0000-000000000001', 'client_category', 'slate');
insert into public.client_assets (id, title, file_url, file_type, folder_id, client_id, order_id) values
  ('95a10000-0000-0000-0000-000000000901', 'already-canonical.png', 'private-upload://uploads/canonical/already.png', 'png',
   '95900000-0000-0000-0000-000000000902', '95300000-0000-0000-0000-000000000009', null);
insert into public.orders (id, order_number, client_name, client_id, tenant_id, file_urls, order_file_folders, created_at) values
  ('95700000-0000-0000-0000-000000000016', 'ORD-BFS-09', 'AlreadyCanonical Client', '95300000-0000-0000-0000-000000000009',
   '95000000-0000-0000-0000-000000000001', array['private-upload://uploads/canonical/already.png'],
   jsonb_build_object('fileFolders', jsonb_build_object('private-upload://uploads/canonical/already.png', 'mockups')),
   now());

-- 11/12/13. URL byte-identity across reference shapes.
insert into public.orders (id, order_number, client_name, client_id, tenant_id, file_urls, created_at) values
  ('95700000-0000-0000-0000-000000000017', 'ORD-BFS-11', 'PrivateUploadUrl Client', '95300000-0000-0000-0000-000000000011',
   '95000000-0000-0000-0000-000000000001', array['private-upload://uploads/urltest/private.png'], now()),
  ('95700000-0000-0000-0000-000000000018', 'ORD-BFS-12', 'SupabasePublicUploadsUrl Client', '95300000-0000-0000-0000-000000000012',
   '95000000-0000-0000-0000-000000000001', array['https://slhcvyeuqsduaglddqdb.supabase.co/storage/v1/object/public/uploads/urltest/public-upload.png'], now()),
  ('95700000-0000-0000-0000-000000000019', 'ORD-BFS-13', 'XlabAssetsPublicUrl Client', '95300000-0000-0000-0000-000000000013',
   '95000000-0000-0000-0000-000000000001', array['https://slhcvyeuqsduaglddqdb.supabase.co/storage/v1/object/public/xlab-assets/urltest/xlab-asset.png'], now());

-- 17. Existing client root reused (simulating a client already adopted by a
-- prior restructure/backfill run).
insert into public.folders (id, name, client_id, parent_id, tenant_id, folder_kind, color) values
  ('95900000-0000-0000-0000-000000001701', 'ReuseRoot Client', '95300000-0000-0000-0000-000000000017', null, '95000000-0000-0000-0000-000000000001', 'client_root', 'blue');
insert into public.orders (id, order_number, client_name, client_id, tenant_id, file_urls, created_at) values
  ('95700000-0000-0000-0000-000000000020', 'ORD-BFS-17', 'ReuseRoot Client', '95300000-0000-0000-0000-000000000017',
   '95000000-0000-0000-0000-000000000001', array['private-upload://uploads/reuseroot/new-file.png'], now());

-- 18. Existing category reused (compatible: client_id already matches).
insert into public.folders (id, name, client_id, parent_id, tenant_id, folder_kind, color) values
  ('95900000-0000-0000-0000-000000001801', 'ReuseCategory Client', '95300000-0000-0000-0000-000000000018', null, '95000000-0000-0000-0000-000000000001', 'client_root', 'blue'),
  ('95900000-0000-0000-0000-000000001802', 'Mockups', '95300000-0000-0000-0000-000000000018', '95900000-0000-0000-0000-000000001801', '95000000-0000-0000-0000-000000000001', 'client_category', 'slate');
insert into public.orders (id, order_number, client_name, client_id, tenant_id, file_urls, order_file_folders, created_at) values
  ('95700000-0000-0000-0000-000000000021', 'ORD-BFS-18', 'ReuseCategory Client', '95300000-0000-0000-0000-000000000018',
   '95000000-0000-0000-0000-000000000001', array['private-upload://uploads/reusecat/new-mockup.png'],
   jsonb_build_object('fileFolders', jsonb_build_object('private-upload://uploads/reusecat/new-mockup.png', 'mockups')),
   now());

-- 20. Same-name client-root suffix disambiguation still intact.
insert into public.orders (id, order_number, client_name, client_id, tenant_id, file_urls, created_at) values
  ('95700000-0000-0000-0000-000000000022', 'ORD-BFS-20A', 'Collision Co', '95300000-0000-0000-0000-000000000021',
   '95000000-0000-0000-0000-000000000001', array['private-upload://uploads/collision-bfs/a.png'], now()),
  ('95700000-0000-0000-0000-000000000023', 'ORD-BFS-20B', 'Collision Co', '95300000-0000-0000-0000-000000000022',
   '95000000-0000-0000-0000-000000000001', array['private-upload://uploads/collision-bfs/b.png'], now());

-- ═══════════════════════════════════════════════════════════════════
-- Pre-run read-only impact estimate check (mirrors the header comment's
-- query logic exactly): confirms the multi-specific-category conflicts
-- (scenarios 7 and 8) are surfaced BEFORE the backfill consumes them.
-- ═══════════════════════════════════════════════════════════════════
do $$
declare
  v_multi_conflicts int;
  v_blob_skipped int;
begin
  with candidate_refs as (
    select
      o.id as order_id, o.client_id, o.tenant_id, o.created_at as order_created_at, url as file_url,
      case lower(coalesce((coalesce(nullif(o.order_file_folders -> 'fileFolders', 'null'::jsonb), '{}'::jsonb) ->> url), ''))
        when 'mockups' then 'Mockups' when 'artwork' then 'Artwork' when 'brand_assets' then 'Brand Assets'
        when 'references' then 'References' when 'production' then 'Production' when 'qc_finished' then 'QC / Finished'
        when 'delivery' then 'Delivery' when 'general' then 'General' else 'General'
      end as occurrence_category,
      (lower(btrim(coalesce(url, ''))) like 'blob:%') as is_blob
    from public.orders o
    cross join lateral unnest(o.file_urls) as url
    where o.client_id is not null and o.file_urls is not null and array_length(o.file_urls, 1) > 0
      and url is not null and btrim(url) <> '' and o.tenant_id = '95000000-0000-0000-0000-000000000001'
  ),
  valid_refs as (select * from candidate_refs where not is_blob),
  conflict_counts as (
    select client_id, file_url, count(distinct occurrence_category) as distinct_non_general
    from valid_refs where occurrence_category <> 'General' group by client_id, file_url
  )
  select
    (select count(*) from candidate_refs where is_blob),
    (select count(*) from conflict_counts where distinct_non_general > 1)
  into v_blob_skipped, v_multi_conflicts;

  if v_blob_skipped <> 2 then raise exception 'PREFLIGHT_BLOB_COUNT_WRONG: got %, expected 2 (scenarios 1 and 2)', v_blob_skipped; end if;
  if v_multi_conflicts <> 2 then raise exception 'PREFLIGHT_MULTI_CONFLICT_COUNT_WRONG: got %, expected 2 (scenarios 7 and 8)', v_multi_conflicts; end if;
end
$$;

-- ═══════════════════════════════════════════════════════════════════
-- RUN 1: the actual backfill script.
-- ═══════════════════════════════════════════════════════════════════
\i supabase/backfills/client_file_library_historical_backfill.sql

do $$
declare
  v_count int;
  v_order_id uuid;
  v_category text;
  v_url text;
  v_folder_id uuid;
begin
  -- 1. Blob-only order: zero side effects.
  if exists (select 1 from public.client_assets where client_id = '95300000-0000-0000-0000-000000000001') then
    raise exception 'BLOB_ONLY_CLIENT_GOT_A_CLIENT_ASSET';
  end if;
  if exists (select 1 from public.folders where client_id = '95300000-0000-0000-0000-000000000001') then
    raise exception 'BLOB_ONLY_CLIENT_GOT_A_FOLDER';
  end if;

  -- 2. Mixed valid + blob: exactly one asset, for the valid file only.
  select count(*) into v_count from public.client_assets where client_id = '95300000-0000-0000-0000-000000000002';
  if v_count <> 1 then raise exception 'MIXED_VALID_BLOB_ASSET_COUNT_WRONG: got %', v_count; end if;
  if exists (select 1 from public.client_assets where client_id = '95300000-0000-0000-0000-000000000002' and file_url like 'blob:%') then
    raise exception 'BLOB_URL_BECAME_A_CLIENT_ASSET';
  end if;

  -- 3. General(older) + Mockups(later) -> Mockups, order_id = older.
  select ca.order_id, f.name into v_order_id, v_category
  from public.client_assets ca join public.folders f on f.id = ca.folder_id
  where ca.client_id = '95300000-0000-0000-0000-000000000003' and ca.file_url = 'private-upload://uploads/g2m/shared.png';
  if v_category <> 'Mockups' then raise exception 'SCENARIO_3_CATEGORY_WRONG: got %', v_category; end if;
  if v_order_id <> '95700000-0000-0000-0000-000000000003' then raise exception 'SCENARIO_3_ORIGIN_ORDER_WRONG: got %', v_order_id; end if;
  select count(*) into v_count from public.client_assets where client_id = '95300000-0000-0000-0000-000000000003';
  if v_count <> 1 then raise exception 'SCENARIO_3_ROW_COUNT_WRONG: got %', v_count; end if;

  -- 4. General + Artwork -> Artwork.
  select f.name into v_category
  from public.client_assets ca join public.folders f on f.id = ca.folder_id
  where ca.client_id = '95300000-0000-0000-0000-000000000004' and ca.file_url = 'private-upload://uploads/g2a/shared.png';
  if v_category <> 'Artwork' then raise exception 'SCENARIO_4_CATEGORY_WRONG: got %', v_category; end if;

  -- 5. General only twice -> General.
  select f.name into v_category
  from public.client_assets ca join public.folders f on f.id = ca.folder_id
  where ca.client_id = '95300000-0000-0000-0000-000000000005' and ca.file_url = 'private-upload://uploads/g2g/shared.png';
  if v_category <> 'General' then raise exception 'SCENARIO_5_CATEGORY_WRONG: got %', v_category; end if;

  -- 6. General + Production -> Production.
  select f.name into v_category
  from public.client_assets ca join public.folders f on f.id = ca.folder_id
  where ca.client_id = '95300000-0000-0000-0000-000000000006' and ca.file_url = 'private-upload://uploads/g2p/shared.png';
  if v_category <> 'Production' then raise exception 'SCENARIO_6_CATEGORY_WRONG: got %', v_category; end if;

  -- 7. Multi-specific: earliest non-General (Artwork) wins; origin order = earliest overall.
  select ca.order_id, f.name into v_order_id, v_category
  from public.client_assets ca join public.folders f on f.id = ca.folder_id
  where ca.client_id = '95300000-0000-0000-0000-000000000007' and ca.file_url = 'private-upload://uploads/multi1/shared.png';
  if v_category <> 'Artwork' then raise exception 'SCENARIO_7_CATEGORY_WRONG: got %, expected earliest non-General (Artwork)', v_category; end if;
  if v_order_id <> '95700000-0000-0000-0000-000000000011' then raise exception 'SCENARIO_7_ORIGIN_ORDER_WRONG: got %', v_order_id; end if;

  -- 8. Reversed: General(earliest) -> Mockups(mid) -> Artwork(latest). Category = Mockups
  -- (earliest NON-General). Origin order_id = the General one (earliest overall).
  select ca.order_id, f.name into v_order_id, v_category
  from public.client_assets ca join public.folders f on f.id = ca.folder_id
  where ca.client_id = '95300000-0000-0000-0000-000000000008' and ca.file_url = 'private-upload://uploads/multi2/shared.png';
  if v_category <> 'Mockups' then raise exception 'SCENARIO_8_CATEGORY_WRONG: got %, expected earliest non-General (Mockups)', v_category; end if;
  if v_order_id <> '95700000-0000-0000-0000-000000000013' then raise exception 'SCENARIO_8_ORIGIN_ORDER_WRONG: got %, expected the General (earliest overall) order', v_order_id; end if;

  -- 9. Already-canonical pair: untouched, no duplicate, no re-categorization.
  select count(*) into v_count from public.client_assets where client_id = '95300000-0000-0000-0000-000000000009' and file_url = 'private-upload://uploads/canonical/already.png';
  if v_count <> 1 then raise exception 'SCENARIO_9_DUPLICATED_CANONICAL_ROW: got % rows', v_count; end if;
  select f.name into v_category from public.client_assets ca join public.folders f on f.id = ca.folder_id
  where ca.id = '95a10000-0000-0000-0000-000000000901';
  if v_category <> 'General' then raise exception 'SCENARIO_9_CATEGORY_WAS_CHANGED: got %, expected untouched General', v_category; end if;

  -- 11/12/13. URL byte-identity.
  select file_url into v_url from public.client_assets where client_id = '95300000-0000-0000-0000-000000000011';
  if v_url <> 'private-upload://uploads/urltest/private.png' then raise exception 'SCENARIO_11_URL_NOT_BYTE_IDENTICAL: got %', v_url; end if;
  select file_url into v_url from public.client_assets where client_id = '95300000-0000-0000-0000-000000000012';
  if v_url <> 'https://slhcvyeuqsduaglddqdb.supabase.co/storage/v1/object/public/uploads/urltest/public-upload.png' then
    raise exception 'SCENARIO_12_URL_NOT_BYTE_IDENTICAL: got %', v_url;
  end if;
  select file_url into v_url from public.client_assets where client_id = '95300000-0000-0000-0000-000000000013';
  if v_url <> 'https://slhcvyeuqsduaglddqdb.supabase.co/storage/v1/object/public/xlab-assets/urltest/xlab-asset.png' then
    raise exception 'SCENARIO_13_URL_NOT_BYTE_IDENTICAL: got %', v_url;
  end if;

  -- 14. orders.file_urls byte-identical (representative check on scenario 3's orders).
  if (select file_urls from public.orders where id = '95700000-0000-0000-0000-000000000003') <> array['private-upload://uploads/g2m/shared.png'] then
    raise exception 'ORDER_FILE_URLS_WAS_MODIFIED_A';
  end if;
  if (select file_urls from public.orders where id = '95700000-0000-0000-0000-000000000004') <> array['private-upload://uploads/g2m/shared.png'] then
    raise exception 'ORDER_FILE_URLS_WAS_MODIFIED_B';
  end if;

  -- 16. No physical Orders/ORD folders, and no folder ever carries order_id.
  if exists (select 1 from public.folders where tenant_id = '95000000-0000-0000-0000-000000000001' and lower(btrim(name)) = 'orders') then
    raise exception 'ORDERS_GROUPING_FOLDER_WAS_CREATED';
  end if;
  if exists (select 1 from public.folders where tenant_id = '95000000-0000-0000-0000-000000000001' and order_id is not null) then
    raise exception 'PHYSICAL_ORDER_FOLDER_WAS_CREATED';
  end if;

  -- 17. Existing client root reused, not duplicated.
  select count(*) into v_count from public.folders where client_id = '95300000-0000-0000-0000-000000000017' and folder_kind = 'client_root';
  if v_count <> 1 then raise exception 'SCENARIO_17_ROOT_DUPLICATED: got % roots', v_count; end if;
  select folder_id into v_folder_id from public.client_assets where client_id = '95300000-0000-0000-0000-000000000017';
  if not exists (select 1 from public.folders where id = v_folder_id and parent_id = '95900000-0000-0000-0000-000000001701') then
    raise exception 'SCENARIO_17_NEW_CATEGORY_NOT_UNDER_EXISTING_ROOT';
  end if;

  -- 18. Existing category reused, not duplicated.
  select count(*) into v_count from public.folders where client_id = '95300000-0000-0000-0000-000000000018' and lower(btrim(name)) = 'mockups';
  if v_count <> 1 then raise exception 'SCENARIO_18_CATEGORY_DUPLICATED: got % Mockups folders', v_count; end if;
  select folder_id into v_folder_id from public.client_assets where client_id = '95300000-0000-0000-0000-000000000018';
  if v_folder_id <> '95900000-0000-0000-0000-000000001802' then raise exception 'SCENARIO_18_NEW_ASSET_NOT_IN_EXISTING_CATEGORY'; end if;

  -- 20. Same-name client-root suffix disambiguation intact.
  if (select count(*) from public.folders where name = 'Collision Co' and client_id in ('95300000-0000-0000-0000-000000000021', '95300000-0000-0000-0000-000000000022')) <> 1 then
    raise exception 'SCENARIO_20_EXPECTED_EXACTLY_ONE_PLAIN_LABEL';
  end if;
  if not exists (
    select 1 from public.folders
    where client_id in ('95300000-0000-0000-0000-000000000021', '95300000-0000-0000-0000-000000000022') and name ~ '·'
  ) then
    raise exception 'SCENARIO_20_SUFFIX_DISAMBIGUATION_MISSING';
  end if;
end
$$;

-- ═══════════════════════════════════════════════════════════════════
-- RUN 2 (scenario 15): rerun the same script. Zero delta.
-- ═══════════════════════════════════════════════════════════════════
create temporary table _bfs_folders_before as
  select id, name, client_id, parent_id, folder_kind from public.folders where tenant_id = '95000000-0000-0000-0000-000000000001';
create temporary table _bfs_assets_before as
  select id, file_url, folder_id, client_id, order_id from public.client_assets
  where client_id in (
    select id from public.clients where tenant_id = '95000000-0000-0000-0000-000000000001'
  );

\i supabase/backfills/client_file_library_historical_backfill.sql

do $$
declare
  v_before_folders int;
  v_after_folders int;
  v_before_assets int;
  v_after_assets int;
  v_diff int;
begin
  select count(*) into v_before_folders from _bfs_folders_before;
  select count(*) into v_after_folders from public.folders where tenant_id = '95000000-0000-0000-0000-000000000001';
  if v_before_folders <> v_after_folders then
    raise exception 'SECOND_RUN_FOLDER_COUNT_DELTA: before % after %', v_before_folders, v_after_folders;
  end if;

  select count(*) into v_before_assets from _bfs_assets_before;
  select count(*) into v_after_assets from public.client_assets
    where client_id in (select id from public.clients where tenant_id = '95000000-0000-0000-0000-000000000001');
  if v_before_assets <> v_after_assets then
    raise exception 'SECOND_RUN_ASSET_COUNT_DELTA: before % after %', v_before_assets, v_after_assets;
  end if;

  select count(*) into v_diff
  from (
    select id, name, client_id, parent_id, folder_kind from public.folders where tenant_id = '95000000-0000-0000-0000-000000000001'
    except
    select id, name, client_id, parent_id, folder_kind from _bfs_folders_before
  ) d;
  if v_diff <> 0 then raise exception 'SECOND_RUN_FOLDER_ROWS_CHANGED: % rows differ', v_diff; end if;

  select count(*) into v_diff
  from (
    select id, file_url, folder_id, client_id, order_id from public.client_assets
      where client_id in (select id from public.clients where tenant_id = '95000000-0000-0000-0000-000000000001')
    except
    select id, file_url, folder_id, client_id, order_id from _bfs_assets_before
  ) d;
  if v_diff <> 0 then raise exception 'SECOND_RUN_ASSET_ROWS_CHANGED: % rows differ', v_diff; end if;
end
$$;

-- ═══════════════════════════════════════════════════════════════════
-- 19. Category identity conflict still raises and rolls back. Uses a
-- SAVEPOINT so the expected failure never aborts this whole test file —
-- everything since the savepoint (including the conflict fixture itself)
-- is rolled back afterward, leaving every prior assertion's state intact.
-- ═══════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP off
savepoint before_conflict_test;

insert into public.folders (id, name, client_id, parent_id, tenant_id, folder_kind, color) values
  ('95900000-0000-0000-0000-000000001901', 'ConflictCategory Client', '95300000-0000-0000-0000-000000000019', null, '95000000-0000-0000-0000-000000000001', 'client_root', 'blue'),
  ('95900000-0000-0000-0000-000000001902', 'Artwork', '95300000-0000-0000-0000-000000000020', '95900000-0000-0000-0000-000000001901', '95000000-0000-0000-0000-000000000001', 'client_category', 'slate');
insert into public.orders (id, order_number, client_name, client_id, tenant_id, file_urls, order_file_folders, created_at) values
  ('95700000-0000-0000-0000-000000000024', 'ORD-BFS-19', 'ConflictCategory Client', '95300000-0000-0000-0000-000000000019',
   '95000000-0000-0000-0000-000000000001', array['private-upload://uploads/conflictcat/piece.png'],
   jsonb_build_object('fileFolders', jsonb_build_object('private-upload://uploads/conflictcat/piece.png', 'artwork')),
   now());

\i supabase/backfills/client_file_library_historical_backfill.sql

rollback to savepoint before_conflict_test;
\set ON_ERROR_STOP on

do $$
declare
  v_category text;
begin
  if exists (
    select 1 from public.client_assets where file_url = 'private-upload://uploads/conflictcat/piece.png'
  ) then
    raise exception 'CONFLICT_RUN_LEFT_BEHIND_A_CLIENT_ASSET';
  end if;
  -- The savepoint rollback reverts the whole conflict fixture, including
  -- the two folders this test itself inserted — so they must be gone
  -- entirely (not merely unmutated), confirming the rollback boundary
  -- worked and nothing was partially committed before the raise.
  if exists (select 1 from public.folders where id in ('95900000-0000-0000-0000-000000001901', '95900000-0000-0000-0000-000000001902')) then
    raise exception 'CONFLICT_FIXTURE_FOLDERS_SURVIVED_THE_SAVEPOINT_ROLLBACK';
  end if;
  if exists (select 1 from public.orders where id = '95700000-0000-0000-0000-000000000024') then
    raise exception 'CONFLICT_FIXTURE_ORDER_SURVIVED_THE_SAVEPOINT_ROLLBACK';
  end if;
  -- Everything committed BEFORE the savepoint (scenarios 1-18, 20) must
  -- remain completely intact — the savepoint rollback must not have
  -- reached back past its own boundary.
  select f.name into v_category
  from public.client_assets ca join public.folders f on f.id = ca.folder_id
  where ca.client_id = '95300000-0000-0000-0000-000000000003' and ca.file_url = 'private-upload://uploads/g2m/shared.png';
  if v_category <> 'Mockups' then
    raise exception 'PRE_SAVEPOINT_STATE_DAMAGED_BY_CONFLICT_ROLLBACK: scenario 3 category now %', v_category;
  end if;
end
$$;

select 'ALL_CLIENT_FILE_LIBRARY_HISTORICAL_BACKFILL_SMOKE_TESTS_PASSED' as result;
rollback;
