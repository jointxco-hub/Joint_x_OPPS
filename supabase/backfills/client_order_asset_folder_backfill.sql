-- ═══════════════════════════════════════════════════════════════════
--  MANUAL BACKFILL — NOT A MIGRATION. DO NOT MOVE THIS FILE INTO
--  supabase/migrations/. Anything under supabase/migrations is eligible
--  to run automatically via normal migration replay / db push; this
--  script is one-time, historical-data-touching, and must only ever be
--  run deliberately, by a human, against a specific target database,
--  after the impact estimate below has been reviewed for that target.
--
--  How to run (controlled, not automatic):
--    psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 \
--      -f supabase/backfills/client_order_asset_folder_backfill.sql
-- ═══════════════════════════════════════════════════════════════════
--
-- Mirrors existing orders.file_urls into the nested Client Root -> Orders
-- -> ORD-XXXXX -> category structure provisioned by the RPCs in
-- supabase/migrations/202608080001_client_order_asset_folder_provisioning.sql
-- (the only automatic migration in this feature).
--
-- Supersedes 202608050002_client_asset_folder_backfill.sql from the earlier
-- local-only feature/client-file-manager-auto-folders branch, which mirrored
-- into a flatter "client root -> category" structure. That flat shape does
-- not match the nested Orders/ORD-XXXXX hierarchy this script targets, so
-- that old backfill must not be run against any database that also gets
-- this one — it would create a second, competing set of category folders
-- directly under the client root instead of under Orders/<order_number>.
--
-- Unlike the RPCs in 202608080001, this runs with database-owner privileges
-- (there is no auth.uid()/authenticated session to call
-- get_or_create_order_asset_folder with outside a real request), so it
-- duplicates that function's get-or-create logic directly against
-- folders/client_assets, matching the same idx_folders_client_root_unique /
-- idx_folders_client_subfolder_unique / idx_folders_order_folder_unique /
-- idx_client_assets_order_file_url_unique constraints for idempotency and
-- re-run safety.
--
-- Category mapping is by the order's own built-in folder id (stable, from
-- OrderDrawerShared.jsx's DEFAULT_ORDER_FILE_FOLDERS), not by folder display
-- name (which staff can rename) — mockups -> Mockups, artwork -> Artwork,
-- production -> Production, anything else (brand_assets, references, a
-- custom ad hoc folder, or uncategorized) -> General. order.invoice_files is
-- a separate JSON array from file_urls and is intentionally out of scope for
-- this backfill, exactly as it was for the donor backfill.
--
-- =====================================================================
-- REQUIRED BEFORE RUNNING THIS AGAINST STAGING OR PRODUCTION:
-- Run the read-only impact estimate below first and have it reviewed.
-- This script must not be run against any shared database until that
-- estimate has been produced and reviewed for that specific target.
--
--   select
--     count(distinct o.id)                                as affected_orders,
--     count(*) filter (where o.file_urls is not null and array_length(o.file_urls, 1) > 0)
--                                                           as orders_with_file_urls,
--     sum(coalesce(array_length(o.file_urls, 1), 0))       as total_file_url_refs,
--     count(distinct o.client_id)
--       filter (where not exists (
--         select 1 from public.folders f
--         where f.client_id = o.client_id and f.parent_id is null
--       ))                                                  as clients_needing_new_root_folder,
--     (select count(*) from public.client_assets ca where ca.order_id is not null)
--                                                           as existing_order_client_assets_rows
--   from public.orders o
--   where o.client_id is not null
--     and o.file_urls is not null
--     and array_length(o.file_urls, 1) > 0;
--
-- Expected new folder rows ~= (clients_needing_new_root_folder)
--   + (1 "Orders" grouping folder per client touched)
--   + (1 order folder per affected_orders)
--   + (up to 4 category subfolders per affected order: Mockups/Artwork/
--     Production/General, only the ones actually used)
-- Expected new client_assets rows ~= total_file_url_refs minus whatever
-- already has a matching (order_id, file_url) row (duplicate estimate —
-- run existing_order_client_assets_rows before and after on a disposable
-- copy to see the real delta, since this query cannot know in advance
-- which specific file_urls already have a placement).
--
-- PRODUCTION READ-ONLY IMPACT REVIEW (results, this target, as reviewed
-- pre-merge — re-run the query above again immediately before actually
-- executing this script, since order/client counts drift over time):
--   affected orders:                              33
--   affected clients:                              27
--   total existing file_url refs:                 140
--   already mirrored refs:                          0
--   refs still requiring backfill:                140
--   clients needing root folders:                  27
--   clients needing "Orders" grouping folder:       27
--   orders needing an order folder:                 33
--   distinct order/category pairs for missing refs: 39
--   => approximately 126 new folder rows
--     (27 client roots + 27 Orders grouping folders + 33 order folders + 39 category folders)
--   => approximately 140 new client_assets rows
-- This is controlled and manageable, but it is exactly why this script
-- does not run automatically: apply 202608080001 and let it bake, run a
-- production smoke check, THEN separately approve and manually execute
-- this backfill, then verify the counts above against reality.
-- =====================================================================
--
-- Rollback: delete from public.client_assets where order_id is not null
--           and created_at >= <time this script ran>;
--           (folders created by this backfill can be identified the same
--           way; delete deepest-first: category folders, then order
--           folders, then "Orders" grouping folders, then any client root
--           folders this backfill created that had no prior root).

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
      o.id,
      o.client_id,
      o.client_name,
      o.order_number,
      o.file_urls,
      coalesce(nullif(o.order_file_folders -> 'fileFolders', 'null'::jsonb), '{}'::jsonb) as file_folders
    from public.orders o
    where o.client_id is not null
      and o.file_urls is not null
      and array_length(o.file_urls, 1) > 0
  loop
    -- Client root folder (get-or-create).
    root_id := null;
    select id into root_id
    from public.folders
    where client_id = order_row.client_id and parent_id is null
    order by created_at asc
    limit 1;
    if root_id is null then
      begin
        insert into public.folders (name, client_id, parent_id, color)
        values (coalesce(nullif(btrim(order_row.client_name), ''), 'Client'), order_row.client_id, null, 'blue')
        returning id into root_id;
      exception when unique_violation then
        select id into root_id
        from public.folders
        where client_id = order_row.client_id and parent_id is null
        order by created_at asc
        limit 1;
      end;
    end if;

    -- "Orders" grouping folder under root (get-or-create).
    orders_group_id := null;
    select id into orders_group_id
    from public.folders
    where parent_id = root_id and lower(name) = lower('Orders')
    limit 1;
    if orders_group_id is null then
      begin
        insert into public.folders (name, client_id, parent_id, color)
        values ('Orders', order_row.client_id, root_id, 'slate')
        returning id into orders_group_id;
      exception when unique_violation then
        select id into orders_group_id
        from public.folders
        where parent_id = root_id and lower(name) = lower('Orders')
        limit 1;
      end;
    end if;

    -- Order-specific folder under Orders, keyed by order_id (get-or-create).
    order_folder_id := null;
    select id into order_folder_id from public.folders where order_id = order_row.id limit 1;
    if order_folder_id is null then
      begin
        insert into public.folders (name, client_id, parent_id, order_id, color)
        values (
          coalesce(nullif(btrim(order_row.order_number), ''), 'Order'),
          order_row.client_id, orders_group_id, order_row.id, 'slate'
        )
        returning id into order_folder_id;
      exception when unique_violation then
        select id into order_folder_id from public.folders where order_id = order_row.id limit 1;
      end;
    end if;

    for url in select unnest(order_row.file_urls)
    loop
      continue when url is null or btrim(url) = '';
      continue when exists (
        select 1 from public.client_assets ca
        where ca.order_id = order_row.id and ca.file_url = url
      );

      folder_key := lower(coalesce(order_row.file_folders ->> url, ''));
      category := case
        when folder_key = 'mockups' then 'Mockups'
        when folder_key = 'artwork' then 'Artwork'
        when folder_key = 'production' then 'Production'
        else 'General'
      end;

      sub_id := null;
      select id into sub_id
      from public.folders
      where parent_id = order_folder_id and lower(name) = lower(category)
      limit 1;
      if sub_id is null then
        begin
          insert into public.folders (name, client_id, parent_id, color)
          values (category, order_row.client_id, order_folder_id, 'slate')
          returning id into sub_id;
        exception when unique_violation then
          select id into sub_id
          from public.folders
          where parent_id = order_folder_id and lower(name) = lower(category)
          limit 1;
        end;
      end if;

      file_name := regexp_replace(split_part(url, '?', 1), '^.*/', '');
      if file_name is null or btrim(file_name) = '' then
        file_name := 'File';
      end if;
      file_ext := lower(regexp_replace(file_name, '^.*\.', ''));
      if file_ext = file_name then
        file_ext := 'file';
      end if;

      begin
        insert into public.client_assets (title, file_url, file_type, folder_id, client_id, order_id)
        values (file_name, url, file_ext, sub_id, order_row.client_id, order_row.id);
      exception when unique_violation then
        null; -- already mirrored by a concurrent run or a prior partial pass
      end;
    end loop;
  end loop;
end $$;
