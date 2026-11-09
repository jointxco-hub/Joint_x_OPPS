// Issue #107 - isolated trusted delivery worker DB leasing. No push calls.
// Rows may only be acknowledged by the worker holding their current token.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
export function createNotificationDeliveryLease({pool}){
 if(typeof pool?.connect!=='function')throw new TypeError('POSTGRES_POOL_REQUIRED');
 async function withClient(fn){const db=await pool.connect();try{return await fn(db)}finally{db.release()}}
 return {
  async claimNext(){return withClient(async db=>{
   // One atomic SQL statement uses row locking and SKIP LOCKED so two
   // workers never claim the same delivery. Leases expire after 60 seconds.
   const {rows}=await db.query(`with selected as (
     select d.id from opps_private.notification_deliveries d
     where (d.status in ('pending','failed') and d.next_attempt_at<=now()
       or d.status='processing' and d.claimed_until<now())
       and d.attempt_count<8
     order by d.next_attempt_at,d.id
     for update skip locked limit 1
   )
   update opps_private.notification_deliveries d
      set status='processing',claim_token=gen_random_uuid(),
          claimed_until=now()+interval '60 seconds',
          attempt_count=d.attempt_count+1,updated_at=now()
     from selected where d.id=selected.id
   returning d.id,d.event_id,d.tenant_id,d.recipient_auth_user_id,
     d.claim_token,d.attempt_count`);
   return rows?.[0]||null;
  })},
  async complete({deliveryId,claimToken}){
   if(!UUID.test(deliveryId||'')||!UUID.test(claimToken||''))throw new Error('CLAIM_INVALID');
   return withClient(async db=>{
    const {rows}=await db.query(`update opps_private.notification_deliveries
        set status='sent',sent_at=now(),claimed_until=null,claim_token=null,updated_at=now()
      where id=$1 and claim_token=$2 and status='processing' and claimed_until>now()
      returning id`,[deliveryId,claimToken]);
    return rows?.length===1;
   });
  },
  async fail({deliveryId,claimToken,errorCode}){
   if(!UUID.test(deliveryId||'')||!UUID.test(claimToken||'')||
       typeof errorCode!=='string'||!/^[A-Z0-9_]{2,64}$/.test(errorCode))throw new Error('CLAIM_INVALID');
   return withClient(async db=>{
    const {rows}=await db.query(`update opps_private.notification_deliveries
      set status='failed',claimed_until=null,claim_token=null,
          last_error_code=$3,
          next_attempt_at=now() + make_interval(secs => least(3600, power(2,least(attempt_count,10))::int * 15)),
          updated_at=now()
      where id=$1 and claim_token=$2 and status='processing' and claimed_until>now()
      returning id`,[deliveryId,claimToken,errorCode]);
    return rows?.length===1;
   });
  },
 };
}
