// Pure decision logic for dataClient.js's getCurrentUser() - separated
// from the actual supabase.auth.getUser()/getSession() calls so the core
// invariant (online + no valid Supabase session => genuinely logged out,
// never masked by a stale local cache) is unit-testable without a live
// Supabase client. dataClient.js's getCurrentUser() is the thin IO
// wrapper: it fetches session/user/profile, calls these, and applies
// `cacheAction` to the in-memory + localStorage user cache.

export function resolveOnlineUserFromAuthCheck({ authError, authUser, profile }) {
  if (authError || !authUser) {
    // Online and Supabase reports no valid session - a real, current
    // "not authenticated" state. Must clear the cache, not just decline
    // to update it, so a later offline read of this same identity can't
    // resurrect a session that no longer exists.
    return { user: null, cacheAction: "clear" };
  }

  if (profile && profile.is_active === false) {
    return { user: null, cacheAction: "clear", revoked: true };
  }

  const user = {
    id: authUser.id,
    email: authUser.email,
    full_name:
      profile?.full_name ??
      authUser.user_metadata?.full_name ??
      authUser.user_metadata?.name ??
      authUser.email ??
      "Supabase User",
    role: profile?.role ?? authUser.user_metadata?.role ?? "user",
    department: profile?.department,
    phone: profile?.phone,
    profile_photo: profile?.avatar_url ?? authUser.user_metadata?.avatar_url ?? null,
    auth_user_id: authUser.id,
    is_active: profile?.is_active !== false,
  };

  return { user, cacheAction: "write" };
}

export function resolveOfflineUserFromSession({ sessionUser, cachedUser }) {
  // Genuinely offline: no way to verify anything against the network
  // right now, so a still-known local session is trusted rather than
  // forcing a false logged-out state. This is the only place a stale
  // cache may stand in for a live check.
  if (!sessionUser) {
    return { user: cachedUser ?? null, cacheAction: "none" };
  }

  const user = {
    id: sessionUser.id,
    email: sessionUser.email,
    full_name:
      cachedUser?.full_name ??
      sessionUser.user_metadata?.full_name ??
      sessionUser.user_metadata?.name ??
      sessionUser.email ??
      "Supabase User",
    role: cachedUser?.role ?? sessionUser.user_metadata?.role ?? "user",
    department: cachedUser?.department,
    phone: cachedUser?.phone,
    profile_photo: cachedUser?.profile_photo ?? sessionUser.user_metadata?.avatar_url ?? null,
    auth_user_id: sessionUser.id,
  };

  return { user, cacheAction: "write" };
}
