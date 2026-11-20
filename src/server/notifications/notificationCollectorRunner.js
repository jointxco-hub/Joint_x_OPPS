// Issue #107 — trusted scheduler wrapper for durable, restart-safe
// notification audit collection. NOT DEPLOYED OR SCHEDULED.
// Pool must allow 2+ clients: the checkpoint lock stays held while
// the collector and outbox use their own DB connections.
export function createNotificationCollectorRunner({pool,collector}){
  if(typeof pool?.connect!=='function'||typeof collector?.collect!=='function')
    throw new TypeError('COLLECTOR_RUNNER_DEPENDENCIES_REQUIRED');
  return {
    async runOnce({name='opps_business_events',limit=50}={}){
      if(!/^[a-z_]{4,48}$/.test(name)||!Number.isInteger(limit)||limit<1||limit>100)
        throw new Error('COLLECTOR_RUN_INVALID');
      const db=await pool.connect();
      try{
        await db.query('BEGIN');
        await db.query(
          `insert into opps_private.notification_collectors(name)
           values ($1) on conflict (name) do nothing`,[name]);
        const {rows}=await db.query(
          `select cursor_created_at,cursor_id
             from opps_private.notification_collectors
            where name=$1 for update skip locked`,[name]);
        if(!rows?.length){
          await db.query('ROLLBACK');
          return {status:'busy'};
        }
        // No checkpoint means no historical push backlog should be sent.
        // The operator must explicitly initialize the start watermark
        // at deployment. This prevents hundreds of old invoice/quote alerts.
        if (!rows[0].cursor_created_at || !rows[0].cursor_id) {
          await db.query('COMMIT');
          return {status:'needs_bootstrap'};
        }
        const cursor=rows[0].cursor_created_at && rows[0].cursor_id ?
          {createdAt:new Date(rows[0].cursor_created_at).toISOString(),id:rows[0].cursor_id}:null;
        // This call commits durable outbox inserts before returning.
        // If a later checkpoint update fails, safe replay is guaranteed
        // by (tenant_id,event_key) and (event_id,recipient_auth_user_id).
        const result=await collector.collect({cursor,limit});
        if(result.cursor){
          await db.query(
            `update opps_private.notification_collectors
                set cursor_created_at=$2::timestamptz,cursor_id=$3::uuid,
                    updated_at=now()
              where name=$1`,
            [name,result.cursor.createdAt,result.cursor.id]);
        }
        await db.query('COMMIT');
        return {status:'collected',processed:result.processed,hasMore:result.hasMore};
      }catch(error){
        try{await db.query('ROLLBACK')}catch{}
        throw error;
      }finally{db.release()}
    }
  }
}
