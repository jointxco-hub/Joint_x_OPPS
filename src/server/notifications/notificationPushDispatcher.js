// Issue #107 — trusted notification delivery coordinator, NOT DEPLOYED.
// The caller supplies ONLY backend adapters, never a browser-selected
// recipient email. One delivery claim relates to one user+tenant+event.
import { notificationEventTypes } from '../../lib/notificationEvents.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function createNotificationPushDispatcher({
  lease, targets, pool, sendWebPush,
}) {
  if (!lease?.claimNext || !lease?.complete || !lease?.fail || !lease?.cancel ||
      !targets?.listRecipientDevices || typeof pool?.connect !== 'function' ||
      typeof sendWebPush !== 'function')
    throw new TypeError('DISPATCHER_DEPENDENCIES_REQUIRED');
  const loadEvent=async claimed=>{
    const db=await pool.connect();
    try {
      const {rows}=await db.query(
        `select id,tenant_id,source_id,event_type
           from opps_private.notification_events
          where id=$1 and tenant_id=$2`,
        [claimed.event_id,claimed.tenant_id]);
      return rows?.[0]||null;
    } finally { db.release(); }
  };
  return {
    async deliverOne() {
      const job=await lease.claimNext();
      if(!job) return {status:'idle'};
      const claim={deliveryId:job.id,claimToken:job.claim_token};
      const fail=async errorCode=>{
        const changed=await lease.fail({...claim,errorCode});
        return {status:changed?'retry':'claim_lost',reason:errorCode};
      };
      try {
        if (![job.id,job.claim_token,job.event_id,job.tenant_id,
          job.recipient_auth_user_id].every(x=>UUID.test(x||'')))
          return fail('INVALID_DELIVERY_ROW');
        const event=await loadEvent(job);
        const descriptor=event && notificationEventTypes[event.event_type];
        if (!descriptor || event.tenant_id!==job.tenant_id ||
            event.id!==job.event_id || !UUID.test(event.source_id||''))
          return fail('EVENT_NOT_AVAILABLE');
        const devices=await targets.listRecipientDevices({
          tenantId:job.tenant_id,recipientAuthUserId:job.recipient_auth_user_id,
        });
        if (!devices?.length) {
          const cancelled=await lease.cancel({...claim,reasonCode:'NO_SUBSCRIBED_DEVICE'});
          return {status:cancelled?'cancelled':'claim_lost'};
        }
        // Safe, generic payload: no customer names, amounts, tokens,
        // signature, subscriber identity, or privileged document text.
        const payload=Object.freeze({
          title:descriptor.title,
          body:'An item in your workspace needs attention.',
          url:descriptor.path,
          tag:`opps-${event.id}`,
          event_type:event.event_type,
        });
        for(const device of devices) {
          if (typeof device?.endpoint!=='string' ||
              typeof device.keys?.auth!=='string' ||
              typeof device.keys?.p256dh!=='string')
            return fail('INVALID_DEVICE');
          // Web Push may succeed and the process may crash before complete.
          // tag provides browser-side collapse; this is at-least-once.
          await sendWebPush(device,payload);
        }
        const completed=await lease.complete(claim);
        return {status:completed?'sent':'claim_lost',deviceCount:devices.length};
      } catch {
        // No secrets/errors persisted in last_error_code.
        return fail('PUSH_RETRYABLE');
      }
    },
  };
}
