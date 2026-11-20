// Issue #107. Server-only recipient resolution; no caller-supplied email.
// Compatible with current push_subscriptions(user_email) until a reviewed
// migration introduces auth_user_id. Never return the email or auth keys to a client.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function createNotificationTargets({pool}) {
  if (typeof pool?.connect !== 'function') throw new TypeError('POSTGRES_POOL_REQUIRED');
  return {
    async listRecipientDevices({tenantId, recipientAuthUserId}) {
      if (!UUID.test(tenantId || '') || !UUID.test(recipientAuthUserId || ''))
        throw new Error('RECIPIENT_ID_INVALID');
      const db=await pool.connect();
      try {
        // Resolve trusted authenticated identity through auth.users.
        // An active membership is mandatory even when there is an email
        // match: emails and browser-supplied subscription rows are NOT auth.
        const {rows}=await db.query(
          `select distinct ps.endpoint, ps.auth, ps.p256dh
             from public.tenant_memberships m
             join auth.users u on u.id=m.auth_user_id
             join public.push_subscriptions ps
               on ps.tenant_id=m.tenant_id
              and lower(ps.user_email)=lower(u.email)
             left join public.notification_preferences pref
               on pref.tenant_id=m.tenant_id
              and lower(pref.user_email)=lower(u.email)
            where m.tenant_id=$1 and m.auth_user_id=$2
              and m.status='active'
              and coalesce(pref.push_enabled,true)=true
              and ps.endpoint is not null
              and ps.auth is not null and ps.p256dh is not null`,
          [tenantId,recipientAuthUserId]
        );
        return (rows||[]).map(r=>({
          endpoint:r.endpoint,
          keys:{auth:r.auth,p256dh:r.p256dh},
        }));
      } finally {db.release()}
    },
  };
}
