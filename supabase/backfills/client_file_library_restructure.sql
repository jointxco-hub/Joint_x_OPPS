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
--
--  Run this BEFORE supabase/backfills/client_file_library_historical_backfill.sql
--  — the historical backfill assumes the client-first hierarchy (adopted
--  legacy Clients/client roots, consolidated categories) already exists,
--  so it can reuse it rather than guessing at identity itself.
-- ═══════════════════════════════════════════════════════════════════
--
-- Does two independent things, both scoped conservatively:
--
-- PART A — Phase 1A physical-order-tree consolidation. Converts:
--   <legacy client root> -> Orders -> <ORD-XXXXX> -> <category>
-- into:
--   All Files -> Clients -> <client root> -> <category>
-- ONLY for folders that actually match that exact shape (a direct child
-- literally named "Orders", whose own children carry a non-null order_id).
-- Any other direct child of a legacy client root — a custom "Campaign
-- 2026" folder, a hand-built library, anything not named "Orders" — is
-- left completely untouched, including everything beneath it.
--
-- PART B — generic legacy client folder ADOPTION. Some tenants already
-- have a manually-created "Clients" folder (and children under it, e.g.
-- one built by hand for a specific client days before this migration/
-- restructure ever ran) with client_id still null throughout, because
-- folder_kind/the client-first model didn't exist yet when it was made.
-- When a direct child of the resolved Clients root has client_id null and
-- its name matches EXACTLY ONE client in the same tenant (by name,
-- whatsapp_name, or saved_contact_name — case-insensitive, trimmed, never
-- fuzzy), that folder is adopted in place: same folder id, same name,
-- same created_at, client_id/folder_kind/tenant_id set. Any loose
-- client_assets directly inside it (no subfolder) are moved into a
-- General category created/reused directly under it, and given the
-- adopted client_id if they didn't already have one. An existing direct
-- child folder whose name matches a canonical category (e.g. an
-- already-present "Mockups" folder) is normalized to folder_kind =
-- 'client_category' in place, not recreated.
--
-- Both parts refuse to guess through a genuine conflict — ambiguous
-- client-name matches, an asset that already carries a *different*
-- client_id, a candidate folder whose own client_id/tenant_id already
-- disagrees with the match — are skipped for that one folder/asset,
-- never overwritten, never silently resolved.
--
-- A conflicting DIRECT CATEGORY folder (an existing "Mockups"/"General"/
-- etc. child whose own client_id or tenant_id already disagrees with the
-- match) is a stricter case than a skip: it can never become a repoint
-- or archive DESTINATION, and Part B never partially adopts a root only
-- to discover General is unsafe afterwards. Both parts RAISE
-- FOLDER_CATEGORY_IDENTITY_CONFLICT and abort the whole script (single
-- transaction, nothing commits) rather than silently continuing.
--
-- Neither part ever re-uploads a binary, ever changes a
-- client_assets.file_url or .id, or ever touches orders.file_urls.
-- client_assets.order_id is always preserved as legacy/origin metadata.
--
-- Written generically and idempotently — production currently has two
-- Phase 1A client trees (Mahlali Jebese, x) and one pre-existing manual
-- Clients/Lazi structure (6 loose files, client_id/order_id both null),
-- but this script must produce correct output for any number of each, on
-- any tenant, and be safe to run more than once.
--
-- ═════════════════════ READ-ONLY IMPACT ESTIMATE ═════════════════════
-- Run both queries first, against the actual target, and have them
-- reviewed. Do not run the restructure itself until reviewed.
--
-- Part A scope:
--   select
--     count(distinct root.id) as legacy_client_roots,
--     count(distinct grp.id) filter (where lower(btrim(grp.name)) = 'orders')
--                                              as orders_grouping_folders,
--     count(distinct ordf.id) filter (where ordf.order_id is not null)
--                                              as order_folders,
--     count(distinct cat.id)                  as legacy_category_folders,
--     count(distinct ca.id)                   as client_assets_to_repoint,
--     count(distinct grp2.id) filter (where lower(btrim(grp2.name)) <> 'orders')
--                                              as non_orders_direct_children_left_untouched
--   from public.folders root
--   left join public.folders grp  on grp.parent_id = root.id and lower(btrim(grp.name)) = 'orders'
--   left join public.folders ordf on ordf.parent_id = grp.id and ordf.order_id is not null
--   left join public.folders cat  on cat.parent_id = ordf.id
--   left join public.client_assets ca on ca.folder_id = cat.id and coalesce(ca.is_archived, false) = false
--   left join public.folders grp2 on grp2.parent_id = root.id
--   where root.parent_id is null
--     and root.client_id is not null
--     and coalesce(root.folder_kind, '') <> 'client_root'
--     and coalesce(root.is_archived, false) = false;
--
-- Part B scope:
--   select
--     count(*) filter (where m.match_count = 1) as adoptable_folders,
--     count(*) filter (where m.match_count = 0) as unmatched_folders_skipped,
--     count(*) filter (where m.match_count > 1) as ambiguous_folders_skipped,
--     sum(m.loose_asset_count) filter (where m.match_count = 1) as loose_assets_to_adopt
--   from (
--     select
--       f.id,
--       (select count(*) from public.clients c
--        where c.tenant_id = f.tenant_id
--          and (lower(btrim(c.name)) = lower(btrim(f.name))
--               or lower(btrim(coalesce(c.whatsapp_name,''))) = lower(btrim(f.name))
--               or lower(btrim(coalesce(c.saved_contact_name,''))) = lower(btrim(f.name)))
--       ) as match_count,
--       (select count(*) from public.client_assets ca where ca.folder_id = f.id and coalesce(ca.is_archived,false) = false) as loose_asset_count
--     from public.folders f
--     where f.client_id is null
--       and coalesce(f.is_archived, false) = false
--       and f.parent_id in (
--         select id from public.folders where folder_kind = 'clients_root'
--         union
--         select id from public.folders
--         where parent_id is null and client_id is null and lower(btrim(name)) = 'clients'
--           and coalesce(is_archived, false) = false
--       )
--   ) m;
-- ═══════════════════════════════════════════════════════════════════

begin;

do $$
declare
  tenant_row record;
  clients_root_id uuid;
  candidate_count int;
  root_row record;
  category_name text;
  canonical_category_id uuid;
  redundant_folder record;
  moved_assets int;
  candidate_folder record;
  client_match_count int;
  matched_client_id uuid;
  matched_client_tenant_id uuid;
  has_conflicting_asset boolean;
  general_folder_id uuid;
  direct_child record;
  canonical_category_names text[] := array[
    'mockups', 'artwork', 'brand assets', 'references', 'production',
    'qc / finished', 'invoices & quotes', 'delivery', 'general'
  ];
begin
  for tenant_row in select id from public.tenants loop

    -- ═══ Resolve this tenant's Clients root (read-only reuse where
    -- possible, same rule as get_or_create_clients_root in
    -- 202608080002, duplicated here because this script runs with no
    -- auth.uid() session). Unlike the migration RPC, this script IS
    -- allowed to write — tagging a reused legacy Clients folder as
    -- canonical (folder_kind = 'clients_root') is exactly the
    -- "separate, manual, controlled" step the migration's own comments
    -- defer to. ═══
    clients_root_id := null;
    select id into clients_root_id
    from public.folders
    where tenant_id = tenant_row.id and folder_kind = 'clients_root'
    limit 1;

    if clients_root_id is null then
      select count(*) into candidate_count
      from public.folders
      where tenant_id = tenant_row.id
        and parent_id is null
        and client_id is null
        and lower(btrim(name)) = 'clients'
        and coalesce(is_archived, false) = false
        and coalesce(folder_kind, '') <> 'clients_root';

      if candidate_count > 1 then
        raise exception using errcode = 'P0001',
          message = format('FOLDER_CLIENTS_ROOT_AMBIGUOUS_TENANT_%s', tenant_row.id);
      elsif candidate_count = 1 then
        select id into clients_root_id
        from public.folders
        where tenant_id = tenant_row.id
          and parent_id is null
          and client_id is null
          and lower(btrim(name)) = 'clients'
          and coalesce(is_archived, false) = false
          and coalesce(folder_kind, '') <> 'clients_root';
        update public.folders
        set folder_kind = 'clients_root'
        where id = clients_root_id and coalesce(folder_kind, '') <> 'clients_root';
      end if;
    end if;

    -- Only create a fresh Clients root if this tenant actually has
    -- Phase 1A legacy client-root work to attach it to (Part A below).
    -- A tenant with neither a legacy/manual Clients folder nor any
    -- Phase 1A legacy client root gets nothing created for it — this
    -- script never provisions structure that doesn't already have
    -- something legacy to adopt.
    if clients_root_id is null then
      if exists (
        select 1 from public.folders
        where tenant_id = tenant_row.id
          and parent_id is null
          and client_id is not null
          and coalesce(folder_kind, '') <> 'client_root'
          and coalesce(is_archived, false) = false
      ) then
        insert into public.folders (name, parent_id, tenant_id, folder_kind, color)
        values ('Clients', null, tenant_row.id, 'clients_root', 'blue')
        returning id into clients_root_id;
      end if;
    end if;

    if clients_root_id is null then
      continue; -- nothing legacy/manual to restructure for this tenant
    end if;

    -- ═══════════════════════════════════════════════════════════════
    -- PART A: legacy Phase 1A client-root reparenting + Orders-scoped
    -- consolidation ONLY (Blocker 3: never touch a non-"Orders" direct
    -- child or anything beneath it).
    -- ═══════════════════════════════════════════════════════════════
    for root_row in
      select f.id, f.client_id, f.name, f.tenant_id
      from public.folders f
      where f.tenant_id = tenant_row.id
        and f.parent_id is null
        and f.client_id is not null
        and coalesce(f.folder_kind, '') <> 'client_root'
        and coalesce(f.is_archived, false) = false
    loop
      update public.folders
      set parent_id = clients_root_id,
          folder_kind = 'client_root'
      where id = root_row.id
        and (parent_id is distinct from clients_root_id or folder_kind is distinct from 'client_root');

      foreach category_name in array array[
        'Mockups', 'Artwork', 'Brand Assets', 'References', 'Production',
        'QC / Finished', 'Invoices & Quotes', 'Delivery', 'General'
      ]
      loop
        canonical_category_id := null;
        select id into canonical_category_id
        from public.folders
        where parent_id = root_row.id and lower(btrim(name)) = lower(category_name)
        limit 1;

        -- A category folder already sitting directly under the client
        -- root (created before folder_kind existed) is normalized in
        -- place rather than left untagged — but only when its own
        -- identity doesn't already disagree with this client/tenant. A
        -- conflicting folder must NEVER become a repoint/archive
        -- destination below (it previously stayed assigned to
        -- canonical_category_id even when left unmodified) — raise and
        -- abort the whole (single-transaction) script instead so no
        -- asset is silently repointed into another client's folder and
        -- no Orders/order tree is archived on the strength of a category
        -- consolidation that never actually happened.
        if canonical_category_id is not null then
          if exists (
            select 1 from public.folders
            where id = canonical_category_id
              and ((client_id is not null and client_id <> root_row.client_id)
                or (tenant_id is not null and tenant_id <> root_row.tenant_id))
          ) then
            raise exception using errcode = 'P0001',
              message = format(
                'FOLDER_CATEGORY_IDENTITY_CONFLICT client=%s root=%s category=%s folder=%s',
                root_row.client_id, root_row.id, category_name, canonical_category_id
              );
          end if;
          update public.folders
          set client_id = root_row.client_id, tenant_id = root_row.tenant_id, folder_kind = 'client_category'
          where id = canonical_category_id and coalesce(folder_kind, '') <> 'client_category';
        end if;

        -- Redundant same-named category folders — Blocker 3 scope:
        -- ONLY under a direct child literally named "Orders" whose own
        -- children carry a non-null order_id. A custom "Campaign 2026"
        -- (or any other non-"Orders" structure) never matches grp here,
        -- so it and everything beneath it is never touched.
        for redundant_folder in
          select cat.id
          from public.folders grp
          join public.folders ordf on ordf.parent_id = grp.id and ordf.order_id is not null
          join public.folders cat on cat.parent_id = ordf.id
          where grp.parent_id = root_row.id
            and lower(btrim(grp.name)) = 'orders'
            and coalesce(grp.is_archived, false) = false
            and lower(btrim(cat.name)) = lower(category_name)
            and coalesce(cat.is_archived, false) = false
            and cat.id is distinct from canonical_category_id
        loop
          if canonical_category_id is null then
            update public.folders
            set parent_id = root_row.id,
                client_id = root_row.client_id,
                tenant_id = root_row.tenant_id,
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

      -- Archive ONLY genuine order folders (order_id is not null) living
      -- directly under a direct child literally named "Orders", and that
      -- "Orders" grouping folder itself — never any other direct child
      -- of the client root, and never anything under a non-"Orders"
      -- direct child.
      update public.folders ordf
      set is_archived = true, archived_at = now()
      from public.folders grp
      where ordf.parent_id = grp.id
        and grp.parent_id = root_row.id
        and lower(btrim(grp.name)) = 'orders'
        and ordf.order_id is not null
        and coalesce(ordf.is_archived, false) = false;

      update public.folders grp
      set is_archived = true, archived_at = now()
      where grp.parent_id = root_row.id
        and lower(btrim(grp.name)) = 'orders'
        and coalesce(grp.is_archived, false) = false;
    end loop;

    -- ═══════════════════════════════════════════════════════════════
    -- PART B: generic legacy client folder ADOPTION.
    -- ═══════════════════════════════════════════════════════════════
    for candidate_folder in
      select f.id, f.name, f.tenant_id
      from public.folders f
      where f.parent_id = clients_root_id
        and f.client_id is null
        and coalesce(f.is_archived, false) = false
    loop
      select count(*) into client_match_count
      from public.clients c
      where c.tenant_id = tenant_row.id
        and (
          lower(btrim(c.name)) = lower(btrim(candidate_folder.name))
          or lower(btrim(coalesce(c.whatsapp_name, ''))) = lower(btrim(candidate_folder.name))
          or lower(btrim(coalesce(c.saved_contact_name, ''))) = lower(btrim(candidate_folder.name))
        );

      if client_match_count <> 1 then
        continue; -- zero or ambiguous matches: never adopted, never guessed
      end if;

      matched_client_id := null;
      select c.id, c.tenant_id into matched_client_id, matched_client_tenant_id
      from public.clients c
      where c.tenant_id = tenant_row.id
        and (
          lower(btrim(c.name)) = lower(btrim(candidate_folder.name))
          or lower(btrim(coalesce(c.whatsapp_name, ''))) = lower(btrim(candidate_folder.name))
          or lower(btrim(coalesce(c.saved_contact_name, ''))) = lower(btrim(candidate_folder.name))
        )
      limit 1;

      -- Skip if this client already has a canonical root elsewhere —
      -- never silently merge two folders for one client.
      if exists (
        select 1 from public.folders
        where client_id = matched_client_id and folder_kind = 'client_root' and id <> candidate_folder.id
      ) then
        continue;
      end if;

      -- Skip if anything in this folder's subtree already carries a
      -- DIFFERENT non-null client_id — never overwrite a conflicting
      -- identity.
      has_conflicting_asset := exists (
        with recursive subtree as (
          select candidate_folder.id as id
          union all
          select f2.id from public.folders f2 join subtree s on f2.parent_id = s.id
        )
        select 1 from public.client_assets ca
        where ca.folder_id in (select id from subtree)
          and ca.client_id is not null
          and ca.client_id <> matched_client_id
      );
      if has_conflicting_asset then
        continue;
      end if;

      -- Preflight EVERY direct canonical-category-named child (Mockups,
      -- Artwork, ..., and especially General, which loose assets are
      -- about to be moved into below) for an identity conflict BEFORE
      -- adopting the root at all. Previously a conflicting category
      -- folder was merely left unmodified — but the root was still
      -- adopted and, if the conflicting folder happened to be General,
      -- loose assets could still be repointed into another client's
      -- folder. Abort the whole (single-transaction) script instead of
      -- partially adopting a root and discovering the conflict only when
      -- General turns out to be unsafe.
      if exists (
        select 1 from public.folders f2
        where f2.parent_id = candidate_folder.id
          and coalesce(f2.is_archived, false) = false
          and lower(btrim(f2.name)) = any(canonical_category_names)
          and ((f2.client_id is not null and f2.client_id <> matched_client_id)
            or (f2.tenant_id is not null and f2.tenant_id <> matched_client_tenant_id))
      ) then
        raise exception using errcode = 'P0001',
          message = format(
            'FOLDER_CATEGORY_IDENTITY_CONFLICT client=%s candidate_folder=%s',
            matched_client_id, candidate_folder.id
          );
      end if;

      -- Adopt in place: same id, same name, same created_at.
      update public.folders
      set client_id = matched_client_id,
          folder_kind = 'client_root',
          tenant_id = coalesce(tenant_id, matched_client_tenant_id)
      where id = candidate_folder.id;

      -- Loose client_assets directly inside the adopted folder (no
      -- subfolder) move into a General category, created/reused
      -- directly under it, and gain the adopted client_id only where
      -- they didn't already have one (the conflict check above already
      -- ruled out any with a different one).
      if exists (
        select 1 from public.client_assets
        where folder_id = candidate_folder.id and coalesce(is_archived, false) = false
      ) then
        general_folder_id := null;
        select id into general_folder_id
        from public.folders
        where parent_id = candidate_folder.id and lower(btrim(name)) = lower('General')
        limit 1;

        if general_folder_id is null then
          insert into public.folders (name, client_id, parent_id, tenant_id, folder_kind, color)
          values ('General', matched_client_id, candidate_folder.id, matched_client_tenant_id, 'client_category', 'slate')
          returning id into general_folder_id;
        elsif not exists (
          select 1 from public.folders
          where id = general_folder_id
            and ((client_id is not null and client_id <> matched_client_id)
              or (tenant_id is not null and tenant_id <> matched_client_tenant_id))
        ) then
          update public.folders
          set client_id = matched_client_id, tenant_id = matched_client_tenant_id, folder_kind = 'client_category'
          where id = general_folder_id and coalesce(folder_kind, '') <> 'client_category';
        end if;

        update public.client_assets
        set folder_id = general_folder_id,
            client_id = coalesce(client_id, matched_client_id)
        where folder_id = candidate_folder.id
          and coalesce(is_archived, false) = false;
      end if;

      -- Direct category normalization: an already-present direct child
      -- folder whose name matches a canonical category is tagged
      -- client_category in place — never recreated, never touched if
      -- its own identity already disagrees.
      for direct_child in
        select f2.id, f2.name, f2.client_id, f2.tenant_id
        from public.folders f2
        where f2.parent_id = candidate_folder.id
          and coalesce(f2.is_archived, false) = false
          and coalesce(f2.folder_kind, '') <> 'client_category'
          and lower(btrim(f2.name)) = any(canonical_category_names)
      loop
        if (direct_child.client_id is not null and direct_child.client_id <> matched_client_id)
           or (direct_child.tenant_id is not null and direct_child.tenant_id <> matched_client_tenant_id) then
          continue;
        end if;
        update public.folders
        set client_id = matched_client_id, tenant_id = matched_client_tenant_id, folder_kind = 'client_category'
        where id = direct_child.id;
      end loop;
    end loop;

  end loop;
end $$;

commit;

-- client_assets.id and file_url are never written above — only folder_id
-- and, for a previously-null value only, client_id. orders.file_urls is
-- never referenced or written. client_assets.order_id is never written.
--
-- Idempotency: rerunning this script finds, for every legacy root,
-- folder_kind already = 'client_root' (no-op), every canonical category
-- folder already existing and already normalized (reused, not
-- recreated), zero non-archived redundant category folders left under
-- any "Orders" group (archived on the first run), the Orders/order
-- folders already archived, and — for Part B — every adopted folder
-- already has client_id set (so it no longer matches the "client_id is
-- null" candidate filter at all, and is skipped from the adoption loop
-- entirely on the second run). Net result on a second run: zero rows
-- changed.
