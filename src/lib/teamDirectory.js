import { supabase } from '@/lib/supabaseClient';
import { getCurrentTenantId } from '@/lib/tenantContext';
import { normalizeTeamDirectoryMember } from '@/lib/teamDirectoryNormalize';

// Phase 2A safe replacement for `dataClient.entities.User.list(...)` on
// assignment/directory screens. That call does `select('*') from users`
// client-side, which the Phase 2A RLS tightening (see
// supabase/migrations/20260921210000_opps_team_directory_phase2.sql) no
// longer allows for other users' rows - ordinary staff now only get their
// own row back from a direct table read. This helper calls the new
// SECURITY DEFINER RPC instead, which returns the tenant-scoped,
// display/assignment-safe field set (never phone, bio, skills, or raw
// timestamps) for every ACTIVE member of the caller's current tenant.
//
// `email` is still present (sourced server-side from users.user_email)
// purely because legacy assignment fields across this codebase (task/goal/
// calendar assignees, mentions) store a user's email as the assignment
// key, not auth_user_id. Phase 2B is the planned move to auth_user_id;
// until then, existing `value={user.email}` usages must keep working.
//
// Never query public.users directly from here - that's the exact read
// path this phase closes off.

export async function listOppsTeamDirectory() {
  if (!supabase) return [];

  // getCurrentTenantId() returns null only for "not signed in" / no
  // Supabase client - both legitimately mean "no directory to show".
  // Any other resolution failure throws a typed OpError and is
  // intentionally left to propagate, same as every other tenant-scoped
  // caller in this codebase (see tenantContext.js) - silently falling
  // back to an empty directory on a real resolution error would hide the
  // failure instead of surfacing it.
  const tenantId = await getCurrentTenantId();
  if (!tenantId) return [];

  const { data, error } = await supabase.rpc('list_opps_team_directory', {
    p_tenant_id: tenantId,
  });

  if (error) throw error;

  return Array.isArray(data) ? data.map(normalizeTeamDirectoryMember) : [];
}
