// Pure, Supabase-free by design (see tests/auth-identity.test.mjs's header
// comment for why this split exists in this codebase: this repo's plain
// `node --test` runner cannot exercise anything that imports
// src/lib/supabaseClient.ts, since that touches import.meta.env, which
// only Vite provides). Kept separate from teamDirectory.js's IO so this
// normalization decision can be tested directly.

// Existing helpers (src/lib/teamUsers.js) and some call sites read either
// `.email` or the raw `.user_email` column name - keep both populated so
// neither breaks, regardless of which one a given caller reads.
export function normalizeTeamDirectoryMember(row) {
  if (!row) return row;
  const email = row.email ?? row.user_email ?? null;
  return {
    ...row,
    email,
    user_email: email,
  };
}
