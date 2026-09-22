-- OPPS self-profile update RPC — closes an ordinary-user regression
-- introduced by Phase 2A (20260921210000_opps_team_directory_phase2.sql).
--
-- Phase 2A restricted direct public.users INSERT/UPDATE/DELETE to
-- public.is_app_admin() only, to close the privilege-escalation gap
-- where a tenant owner/admin could reach the GLOBAL, privilege-bearing
-- public.users.role column via can_manage_opps_user(). Correct fix - but
-- it also silently broke every ordinary user's ability to save their own
-- display name or avatar, since dataClient.auth.updateMe()
-- (src/api/dataClient.js) and MyProfile.jsx's "Preferred name" save both
-- wrote to public.users directly. Under the new policy those writes
-- either affect 0 rows (UPDATE, no error surfaced by default) or are
-- denied outright (INSERT) - "Preferred name saved" was lying for every
-- non-admin identity.
--
-- Fix: a narrow SECURITY DEFINER RPC that can only ever touch the
-- CALLER's own row (auth_user_id = auth.uid(), not an argument - there
-- is no way to target anyone else) and only three genuinely safe,
-- non-privilege-bearing columns: full_name, preferred_name, avatar_url.
-- It cannot touch role, department, is_active, auth_user_id, user_email,
-- or anything tenant-role-related - those aren't parameters at all, so
-- there's no payload shape that could reach them. This does not reopen
-- or weaken Phase 2A's direct-table restriction in any way; it is a
-- deliberately narrow escape hatch for exactly the self-service case
-- Phase 2A didn't provide for.
--
-- Provisioning (creating a brand-new public.users row for an identity
-- that doesn't have one yet) is explicitly NOT handled here - out of
-- scope for "update my own safe fields."
--
-- ── PATCH semantics (corrected) ──────────────────────────────────────
-- The first version of this function took three positional arguments,
-- each defaulting to null, and set all three columns unconditionally
-- from whatever was passed - so a caller updating only full_name, and
-- omitting the other two (leaving them at their null default), silently
-- CLEARED preferred_name and avatar_url. That is not PATCH semantics; it
-- is a full-replace that happened to look safe in the two call sites
-- that existed at the time.
--
-- Fixed by taking a single jsonb patch argument instead of positional
-- arguments, and using `p_patch ? 'field_name'` (JSONB key-existence,
-- distinct from the VALUE being null) to tell "this field was not
-- mentioned - leave it exactly as it is" apart from "this field was
-- explicitly included - apply whatever value it has, including an
-- explicit JSON null to intentionally clear a nullable field." Only
-- full_name/preferred_name/avatar_url may appear as keys at all -
-- anything else is REJECTED (the function raises, rather than silently
-- ignoring it), so a caller that mistakenly sends a privileged field
-- name finds out immediately instead of assuming it worked.

begin;

-- The very first draft of this RPC (never deployed anywhere - this
-- whole migration has not been run against any real database yet) used
-- three positional text arguments. Drop that overload explicitly so a
-- stray copy can never be left behind if this file is ever re-run after
-- an earlier draft was applied by hand.
drop function if exists public.update_my_opps_profile(text, text, text);

create or replace function public.update_my_opps_profile(p_patch jsonb)
returns table (
  id uuid,
  auth_user_id uuid,
  full_name text,
  preferred_name text,
  avatar_url text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_has_full_name boolean;
  v_has_preferred_name boolean;
  v_has_avatar_url boolean;
  v_full_name text;
  v_bad_keys text[];
  v_row_count integer;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  if p_patch is null or jsonb_typeof(p_patch) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'Patch must be a JSON object.';
  end if;

  -- Reject, don't silently ignore, any key outside the allow-list - so a
  -- caller that mistakenly (or maliciously) includes role/department/
  -- is_active/auth_user_id/user_email/anything else finds out
  -- immediately rather than assuming a no-op succeeded.
  select array_agg(k)
  into v_bad_keys
  from jsonb_object_keys(p_patch) as k
  where k not in ('full_name', 'preferred_name', 'avatar_url');

  if v_bad_keys is not null then
    raise exception using errcode = '42501',
      message = format(
        'These fields cannot be updated through update_my_opps_profile: %s',
        array_to_string(v_bad_keys, ', ')
      );
  end if;

  -- Key PRESENCE (not value) decides whether a column is touched at
  -- all - this is what makes it a true patch instead of a full replace.
  v_has_full_name := p_patch ? 'full_name';
  v_has_preferred_name := p_patch ? 'preferred_name';
  v_has_avatar_url := p_patch ? 'avatar_url';

  if v_has_full_name then
    -- full_name is NOT NULL in the schema, and must never be replaced
    -- with blank text even when the key IS present with a blank/
    -- whitespace-only value - nullif(trim(...), '') turns that into SQL
    -- NULL, and the case-expression below only applies it when it is
    -- NOT null, so a blank submission is a no-op on this column rather
    -- than a constraint violation or an accidental blank-out.
    v_full_name := nullif(trim(p_patch->>'full_name'), '');
  end if;

  update public.users u
  set
    full_name = case
      when v_has_full_name and v_full_name is not null then v_full_name
      else u.full_name
    end,
    -- preferred_name/avatar_url are nullable: ->>'key' on a jsonb object
    -- yields SQL NULL both for a JSON null value and for a missing key,
    -- but v_has_* already distinguishes "missing" (leave unchanged, the
    -- ELSE branch) from "present with an explicit null" (apply NULL,
    -- the THEN branch evaluates to SQL NULL) - so an explicit JSON null
    -- intentionally clears the field, exactly as specified, while an
    -- omitted key never touches it.
    preferred_name = case
      when v_has_preferred_name then p_patch->>'preferred_name'
      else u.preferred_name
    end,
    avatar_url = case
      when v_has_avatar_url then p_patch->>'avatar_url'
      else u.avatar_url
    end,
    updated_at = now()
  where u.auth_user_id = auth.uid();

  get diagnostics v_row_count = row_count;

  if v_row_count = 0 then
    -- Either no public.users row is linked to this auth identity yet
    -- (provisioning is out of scope here), or it exists but its
    -- auth_user_id hasn't been linked (still null) - the same "not yet
    -- linked" edge case documented in dataClient.js's getCurrentUser().
    raise exception using errcode = '22023', message = 'No profile is linked to this account yet.';
  end if;

  -- Narrowed result: only what the caller needs to reflect the save
  -- back into the UI. Never role/department/email/is_active/or any
  -- other global public.users column, regardless of what this function
  -- might be extended to accept in the future.
  return query
  select u.id, u.auth_user_id, u.full_name, u.preferred_name, u.avatar_url, u.updated_at
  from public.users u
  where u.auth_user_id = auth.uid();
end;
$$;

revoke all on function public.update_my_opps_profile(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.update_my_opps_profile(jsonb) to authenticated;

commit;
