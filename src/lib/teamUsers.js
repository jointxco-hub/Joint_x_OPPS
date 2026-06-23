export function isAssignableTeamUser(user) {
  const role = String(user?.role || '').trim().toLowerCase();
  return Boolean(user?.email || user?.user_email) && user?.is_active !== false && role !== 'investor';
}

export function userDisplayName(user) {
  return user?.preferred_name || user?.full_name || user?.name || user?.email || user?.user_email || 'Team member';
}

export function userRoleLabel(user) {
  const role = String(user?.role || 'team').replace(/_/g, ' ');
  return role.charAt(0).toUpperCase() + role.slice(1);
}