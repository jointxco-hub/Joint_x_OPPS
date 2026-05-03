export const DEFAULT_ADMIN_EMAILS = ['jointx.co@gmail.com'];

export function isAdmin(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (DEFAULT_ADMIN_EMAILS.includes((user.email || '').toLowerCase())) return true;
  return false;
}
