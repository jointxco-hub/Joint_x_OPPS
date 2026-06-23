export const DEFAULT_ADMIN_EMAILS = [
  'jointx.co@gmail.com',
  'jointsexclusive@gmail.com',
  'jasperjaimataruse@gmail.com',
  'jaicreativerealm@gmail.com',
];

export function isAdmin(user) {
  if (!user) return false;
  const role = String(
    user.role || user.user_metadata?.role || user.app_metadata?.role || ''
  ).trim().toLowerCase();
  const email = String(user.email || '').trim().toLowerCase();
  return role === 'admin' || DEFAULT_ADMIN_EMAILS.includes(email);
}