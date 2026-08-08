-- ═══════════════════════════════════════════════════════════════════
--  MANUAL RESTRUCTURE — NOT A MIGRATION. DO NOT MOVE THIS FILE INTO
--  supabase/migrations/. Anything under supabase/migrations is eligible
--  to run automatically via normal migration replay / db push; this
--  script is one-time, structural, and must only ever be run
--  deliberately, by a human, against a specific target database, after
--  the impact estimate below has been reviewed for that target.
--
--  How to run (controlled, not automatic):
--    psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 \
--      -f supabase/backfills/client_file_library_restructure.sql
-- ═══════════════════════════════════════════════════════════════════
--
-- Converts the existing Phase 1A physical hierarchy:
--   <legacy client root> -> Orders -> <ORD-XXXXX> -> <category>
-- into the Phase 1A.1 canonical hierarchy:
--   All Files -> Clients -> <client root> -> <category>
--
-- without duplicating binaries or client_assets rows, and without ever
-- touching orders.file_urls (the order/file relationship stays exactly
-- where it already lives).
--
-- Written generically and idempotently even though production currently
-- has only two Phase 1A client trees (Mahlali Jebese, x) — this script
-- must produce correct output for any number of legacy client roots, any
-- number of orders per client, and any number of category folders per
-- order, and must be safe to run more than once.
--
-- ═════════════════════ READ-ONLY IMPACT ESTIMATE ═════════════════════
-- Run this first, against the actual target, and have it reviewed. Do
-- not run the restructure itself until this has been reviewed.
--
--   select
--     count(distinct root.id) as legacy_client_roots,
--     count(distinct grp.id) filter (where grp.name = 'Orders')
--                                              as orders_grouping_folders,
--     count(distinct ordf.id) filter (where ordf.order_id is not null)
--                                              as order_folders,
--     count(distinct cat.id)                  as legacy_category_folders,
--     count(distinct ca.id)                   as client_assets_to_repoint
--   from public.folders root
--   left join public.folders grp  on grp.parent_id = root.id
--   left join public.folders ordf on ordf.parent_id = grp.id
--   left join public.folders cat  on cat.parent_id = ordf.id
--   left join public.client_assets ca on ca.folder_id = cat.id and coalesce(ca.is_archived, false) = false
--   where root.parent_id is null
--     and root.client_id is not null
--     and coalesce(root.folder_kind, '') <> 'client_root'
--     and coalesce(root.is_archived, false) = false;
--
-- Expected outcome per legacy client root:
--   1 new/reused canonical client_root folder (the legacy root itself,
--     reparented in place — same id, same created_at, no data loss)
--   up to 9 canonical client_category folders (one per name actually
--     found; Phase 1A only ever created up to 7: Mockups, Artwork,
--     Production, QC / Finished, Invoices & Quotes, Delivery, General)
--   client_assets_to_repoint rows get folder_id repointed to the
--     matching canonical category folder — file_url, id, and order_id
--     (kept as legacy/origin metadata) are never touched
--   every "Orders" grouping folder, every order-specific folder, and
--     every now-redundant per-order category folder is archived
--     (is_archived = true), never deleted
-- ═══════════════════════════════════════════════════════════════════

begin;

do $$
declare
  root_row record;
  clients_root_id uuid;
  category_name text;
  canonical_category_id uuid;
  redundant_folder record;
  moved_assets int;
begin
  for root_row in
    select f.id, f.client_id, f.name, f.tenant_id
    from public.folders f
    where f.parent_id is null
      and f.client_id is not null
      and coalesce(f.folder_kind, '') <> 'client_root'
      and coalesce(f.is_archived, false) = false
  loop
    -- Resolve (or create, idempotent) this client's tenant's Clients root.
    -- Owner-privileged direct logic — no auth.uid() session exists when
    -- this script runs by hand, so get_or_create_clients_root (which
    -- requires one) is not called here.
    clients_root_id := null;
    select id into clients_root_id
    from public.folders
    where tenant_id = root_row.tenant_id and folder_kind = 'clients_root'
    limit 1;
    if clients_root_id is null then
      insert into public.folders (name, parent_id, tenant_id, folder_kind, color)
      values ('Clients', null, root_row.tenant_id, 'clients_root', 'blue')
      returning id into clients_root_id;
    end if;

    -- Step 2: move the legacy client root under Clients, in place (same
    -- row/id — every client_assets.folder_id already pointing directly
    -- at this root, and every folder already parented directly under it,
    -- stays correct automatically; only its own parent_id/folder_kind
    -- change).
    update public.folders
    set parent_id = clients_root_id,
        folder_kind = 'client_root'
    where id = root_row.id
      and (parent_id is distinct from clients_root_id or folder_kind is distinct from 'client_root');

    -- Steps 3-5: for each of the 9 canonical category names, find/create
    -- ONE canonical category folder directly under this client root, then
    -- consolidate every OTHER same-named category folder anywhere deeper
    -- in this client's legacy subtree (Orders -> ORD-XXXXX -> category)
    -- into it.
    foreach category_name in array array[
      'Mockups', 'Artwork', 'Brand Assets', 'References', 'Production',
      'QC / Finished', 'Invoices & Quotes', 'Delivery', 'General'
    ]
    loop
      canonical_category_id := null;
      select id into canonical_category_id
      from public.folders
      where parent_id = root_row.id and lower(name) = lower(category_name)
      limit 1;

      -- Redundant category folders: same name, living deeper in this
      -- client's subtree (under any "Orders" grouping / ORD-XXXXX
      -- folder), not already the canonical one, not already archived.
      for redundant_folder in
        select cat.id
        from public.folders grp
        join public.folders ordf on ordf.parent_id = grp.id
        join public.folders cat on cat.parent_id = ordf.id
        where grp.parent_id = root_row.id
          and coalesce(grp.is_archived, false) = false
          and lower(cat.name) = lower(category_name)
          and coalesce(cat.is_archived, false) = false
          and cat.id is distinct from canonical_category_id
      loop
        if canonical_category_id is null then
          -- Promote the first redundant folder found in place, rather
          -- than creating a brand new row, so its own id/created_at (and
          -- anything already pointing at it) needs no repointing at all.
          update public.folders
          set parent_id = root_row.id,
              folder_kind = 'client_category',
              order_id = null
          where id = redundant_folder.id;
          canonical_category_id := redundant_folder.id;
          continue;
        end if;

        update public.client_assets
        set folder_id = canonical_category_id
        where folder_id = redundant_folder.id
          and coalesce(is_archived, false) = false;
        get diagnostics moved_assets = row_count;

        update public.folders
        set is_archived = true, archived_at = now()
        where id = redundant_folder.id;
      end loop;
    end loop;

    -- Steps 9: archive now-empty "Orders" grouping folders and the
    -- order-specific (ORD-XXXXX) folders under them — their category
    -- children have all just been consolidated/archived above, so
    -- anything left under them is either already archived or genuinely
    -- has nothing referencing it any more.
    update public.folders ordf
    set is_archived = true, archived_at = now()
    from public.folders grp
    where ordf.parent_id = grp.id
      and grp.parent_id = root_row.id
      and coalesce(ordf.is_archived, false) = false;

    update public.folders grp
    set is_archived = true, archived_at = now()
    where grp.parent_id = root_row.id
      and lower(grp.name) = lower('Orders')
      and coalesce(grp.is_archived, false) = false;
  end loop;
end $$;

commit;

-- Steps 6-8 (implicit, never executed by this script): client_assets.id
-- and file_url are never written above — only folder_id. orders.file_urls
-- is never referenced or written. client_assets.order_id is never written
-- — it remains whatever legacy/origin value it already had.
--
-- Step 12 (idempotency): rerunning this script finds, for every legacy
-- root, folder_kind already = 'client_root' (its own update becomes a
-- no-op WHERE clause miss), every canonical category folder already
-- existing (reused, not recreated), zero non-archived redundant category
-- folders left under any Orders group (they were archived on the first
-- run, so the redundant_folder loop finds nothing), and the Orders/order
-- folders already archived (their own UPDATE WHERE clauses also miss).
-- Net result on a second run: zero rows changed.
