-- Disposable PostgreSQL compatibility for future live settlement candidate.
-- No real PayFast requests or external credentials are involved.
create or replace function auth.role() returns text language sql stable as $role$
 select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'service_role')
$role$;
alter table commerce.service_orders add column customer_name text,
 add column customer_email text;
alter table commerce.service_order_payments add column pf_payment_id text,
 add column raw_itn jsonb;
-- Replace stub only for the isolated settlement test. The real production
-- canonical function has separate, already-reviewed behavior and protections.
create or replace function commerce.qs_apply_payfast_payment(
 p_order_id uuid,p_amount numeric,p_payment_id text,p_itn jsonb
) returns jsonb language plpgsql as $fake$
declare v_id uuid;
begin
 update commerce.service_order_payments
 set status='completed',amount=p_amount,pf_payment_id=p_payment_id,
     raw_itn=p_itn,completed_at=now()
 where service_order_id=p_order_id and provider='payfast' and status='pending'
 returning id into v_id;
 if v_id is null then return jsonb_build_object('ok',false,'ignored',true);end if;
 update commerce.service_orders set payment_status='paid' where id=p_order_id;
 return jsonb_build_object('ok',true,'ignored',false);
end $fake$;
