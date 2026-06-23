export const DEFAULT_ADMIN_EMAILS = ['jointx.co@gmail.com'];

export function isAdmin(user) {
  if (!user) return false;
  const role = String(user.role || '').trim().toLowerCase();
  const email = String(user.email || '').trim().toLowerCase();
  return role === 'admin' || DEFAULT_ADMIN_EMAILS.includes(email);
}