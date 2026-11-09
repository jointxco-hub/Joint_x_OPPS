// Issue #107: trusted server only. Durable, tenant-scoped event fanout.
// Input event MUST originate from a committed authoritative transition.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENTS = new Set(['INVOICE_APPROVED','INVOICE_PAID','INVOICE_VOIDED','QUOTE_SENT','QUOTE_ACCEPTED','QUOTE_DECLINED','INVENTORY_LOW']);
const docEvent = type => type.startsWith('INVOICE_') || type.startsWith('QUOTE_');
export function createNotificationOutbox({ pool }) {
  if (typeof pool?.connect !== 'function') throw new TypeError('POSTGRES_POOL_REQUIRED');
  return {
    async enqueueCommittedEvent({ tenantId, eventType, eventKey, sourceId }) {
      if (![tenantId, sourceId].every(v=>UUID.test(v || '')) || !EVENTS.has(eventType) ||
        typeof eventKey !== 'string' || eventKey.length < 8 || eventKey.length > 256 ||
        !eventKey.startsWith(`${tenantId}:`)) throw new Error('NOTIFICATION_EVENT_INVALID');
      const db = await pool.connect();
      try {
        await db.query('BEGIN');
        // Scope recipients to ACTIVE tenant + ACTIVE staff memberships.
        // Invoice and quote finance events require owner/admin; inventory
        // events can also reach counter staff. Permission refinement pending.
        const { rows: tenant } = await db.query(
          `select id from public.tenants where id=$1 and status='active' for share`, [tenantId]);
        if (!tenant?.length) throw new Error('TENANT_UNAVAILABLE');
        const { rows: events } = await db.query(
          `insert into opps_private.notification_events
            (tenant_id,source_id,event_type,event_key)
           values ($1,$2,$3,$4)
           on conflict (tenant_id,event_key) do update set
             event_key=opps_private.notification_events.event_key
           where opps_private.notification_events.source_id=excluded.source_id
             and opps_private.notification_events.event_type=excluded.event_type
           returning id`,[tenantId,sourceId,eventType,eventKey]);
        if (!events?.[0]?.id) throw new Error('NOTIFICATION_EVENT_CONFLICT');
        const id=events[0].id;
        await db.query(
          `insert into opps_private.notification_deliveries
            (event_id,tenant_id,recipient_auth_user_id,status)
           select $1,m.tenant_id,m.auth_user_id,'pending'
             from public.tenant_memberships m
            where m.tenant_id=$2 and m.status='active'
              and m.auth_user_id is not null
              and m.tenant_role = any($3::text[])
           on conflict (event_id,recipient_auth_user_id) do nothing`,
          [id,tenantId,docEvent(eventType)?['owner','admin']:['owner','admin','member','counter_staff']]);
        await db.query('COMMIT');
        return { eventId:id };
      } catch (error) {
        try { await db.query('ROLLBACK'); } catch { /* keep source error */ }
        throw error;
      } finally { db.release(); }
    },
  };
}
