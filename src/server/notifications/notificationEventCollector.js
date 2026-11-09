// Issue #107: trusted, read-only collector for COMMITTED invoice/quote audit events.
// No browser API, no PayFast writer changes, no outbound push.
// The caller MUST persist the returned cursor only after enqueue completes.
// Outbox deduplication uses stable original event UUIDs for restart/replay.
const MAX_BATCH=100;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const events={
  invoice_approved: 'INVOICE_APPROVED',
  invoice_paid: 'INVOICE_PAID',
  quote_sent: 'QUOTE_SENT',
  quote_accepted: 'QUOTE_ACCEPTED',
  quote_declined: 'QUOTE_DECLINED',
};
export function createNotificationEventCollector({pool,outbox}) {
  if(typeof pool?.connect!=='function' || typeof outbox?.enqueueCommittedEvent!=='function')
    throw new TypeError('COLLECTOR_DEPENDENCIES_REQUIRED');
  return {
    async collect({cursor=null,limit=50}={}) {
      if(!Number.isInteger(limit)||limit<1||limit>MAX_BATCH ||
          cursor!==null && (!cursor?.createdAt || !uuid.test(cursor.id||'') ||
            !Number.isFinite(Date.parse(cursor.createdAt)))) {
        throw new Error('COLLECTOR_CURSOR_INVALID');
      }
      const db=await pool.connect();
      let rows;
      try {
        // Order by both timestamp AND UUID to avoid missing ties.
        // The invoice event is only "paid" when the audited transition
        // says paid: a partial payment receipt is not a paid invoice.
        const response=await db.query(
          `with audited as (
             select a.created_at,a.id,a.tenant_id,
                    a.invoice_id as document_id, 'invoice'::text as kind,
                    case
                      when a.activity_type='invoice_approved'
                        then 'INVOICE_APPROVED'
                      when a.activity_type='invoice_payment_recorded'
                        and a.to_status='paid' then 'INVOICE_PAID'
                      else null
                    end as event_type
             from public.opps_invoice_activity a
             where a.activity_type in ('invoice_approved','invoice_payment_recorded')
             union all
             select q.created_at,q.id,q.tenant_id,
                    q.quote_id as document_id,'quote'::text as kind,
                    case q.event_type
                      when 'sent' then 'QUOTE_SENT'
                      when 'accepted' then 'QUOTE_ACCEPTED'
                      when 'declined' then 'QUOTE_DECLINED'
                      else null
                    end as event_type
             from public.opps_quote_events q
             where q.event_type in ('sent','accepted','declined')
           )
           select created_at,id,tenant_id,document_id,kind,event_type
           from audited
           where event_type is not null
             and ($1::timestamptz is null or (created_at,id)>($1::timestamptz,$2::uuid))
           order by created_at,id limit $3`,
          [cursor?.createdAt??null,cursor?.id??null,limit]);
        rows=response.rows||[];
      } finally {db.release()}
      let next=cursor;
      let processed=0;
      // Keep cursor advancement AFTER a successful outbox commit. If an
      // enqueue fails, the caller keeps its previous durable cursor and
      // can safely replay the batch (outbox has UNIQUE tenant,event_key).
      for(const row of rows) {
        if(!uuid.test(row.id||'')||!uuid.test(row.tenant_id||'')||
           !uuid.test(row.document_id||'') ||
           !Object.values(events).includes(row.event_type)) {
          throw new Error('COLLECTOR_EVENT_INVALID');
        }
        await outbox.enqueueCommittedEvent({
          tenantId:row.tenant_id,
          sourceId:row.document_id,
          eventType:row.event_type,
          eventKey:[row.tenant_id,row.kind,row.document_id,row.id].join(':'),
        });
        next={createdAt:new Date(row.created_at).toISOString(),id:row.id};
        processed++;
      }
      return {processed,cursor:next,hasMore:rows.length===limit};
    },
  };
}
