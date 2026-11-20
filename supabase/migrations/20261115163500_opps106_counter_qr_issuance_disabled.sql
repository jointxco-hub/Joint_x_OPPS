-- OPPS-106 counter QR issuance gate. DISABLED unless explicitly enabled
-- after reviewed scan/PayFast reconciliation adapter is deployed.
-- Private configuration; no browser role can enable payments.
create table if not exists qr_payments.issuance_controls (
  target_type text primary key check (target_type in ('cafe_order','opps_invoice')),
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into qr_payments.issuance_controls(target_type,enabled)
values ('cafe_order',false),('opps_invoice',false)
on conflict (target_type) do nothing;
alter table qr_payments.issuance_controls enable row level security;
revoke all on qr_payments.issuance_controls from public,anon,authenticated,service_role;
grant select on qr_payments.issuance_controls to service_role;

-- This RPC is deliberately not reachable anonymously. Staff identity is
-- derived from the signed JWT by auth.uid(); zero user-controlled price.
create or replace function public.qs_opps106_issue_counter_qr(
  p_order_id uuid, p_operation_key text
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog
as $function$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_ready jsonb;
  v_amount bigint;
  v_existing qr_payments.payment_requests%rowtype;
  v_new uuid;
  v_now timestamptz := clock_timestamp();
  v_expiry timestamptz;
  v_url text;
begin
  if v_actor is null or p_order_id is null or
     p_operation_key is null or
     p_operation_key !~ '^[A-Za-z0-9_-]{8,128}$' then
    return jsonb_build_object('ok',false,'reason','NOT_AUTHORIZED');
  end if;

  -- Strict serial lock on the canonical order. Call preflight AFTER lock.
  select so.tenant_id into v_tenant
    from commerce.service_orders so
    where so.id = p_order_id
    for update;
  if not found then
    return jsonb_build_object('ok',false,'reason','NOT_AUTHORIZED');
  end if;

  v_ready := public.qs_opps106_counter_qr_preflight(p_order_id);
  if v_ready->>'ok' is distinct from 'true' then
    return jsonb_build_object('ok',false,'reason',coalesce(v_ready->>'reason','NOT_PAYABLE'));
  end if;

  -- Disabled until dedicated scan redirect and verified PayFast QR
  -- callback reconciliation have both been approved.
  if not exists(
    select 1 from qr_payments.issuance_controls
    where target_type='cafe_order' and enabled=true
  ) then
    return jsonb_build_object('ok',false,'reason','QR_ISSUANCE_DISABLED');
  end if;

  v_amount := (v_ready->>'amountCents')::bigint;
  -- Resolve canonical same-tenant order, independently of caller claims.
  select * into v_existing
    from qr_payments.payment_requests
    where tenant_id=v_tenant and target_type='cafe_order'
      and target_id=p_order_id and operation_key=p_operation_key
    for update;
  if found then
    if v_existing.amount_cents <> v_amount then
      return jsonb_build_object('ok',false,'reason','STALE_OPERATION_KEY');
    end if;
    if v_existing.status='active' and v_existing.expires_at>v_now then
      return jsonb_build_object('ok',true,'paymentRequestId',v_existing.id,
        'amountCents',v_amount,'currency','ZAR',
        'expiresAt',v_existing.expires_at,'status','active',
        'scanUrl',v_existing.checkout_url,'reused',true);
    end if;
    return jsonb_build_object('ok',false,'reason','OPERATION_KEY_ALREADY_USED');
  end if;

  -- Reuse one outstanding request across two staff devices, even if
  -- their operation keys differ. Never issue a second simultaneous QR.
  select * into v_existing
    from qr_payments.payment_requests
    where tenant_id=v_tenant and target_type='cafe_order'
      and target_id=p_order_id and status='active'
    for update;
  if found then
    if v_existing.expires_at>v_now and
       v_existing.amount_cents=v_amount then
      return jsonb_build_object('ok',true,'paymentRequestId',v_existing.id,
        'amountCents',v_amount,'currency','ZAR',
        'expiresAt',v_existing.expires_at,'status','active',
        'scanUrl',v_existing.checkout_url,'reused',true);
    end if;
    update qr_payments.payment_requests
      set status=case when expires_at<=v_now then 'expired' else 'revoked' end,
          checkout_url=null, updated_at=v_now
      where id=v_existing.id;
  end if;

  v_new := gen_random_uuid();
  v_expiry := v_now + interval '2 minutes';
  -- This is an intermediate URL, NOT a PayFast checkout URL.
  -- The scanner will refuse redirects until the gateway is wired.
  v_url := 'https://tijiamrfnxrbitafiflj.supabase.co/functions/v1/quick-solution-qr-opps106-scan?rid='
    || v_new::text;

  insert into qr_payments.payment_requests
    (id,tenant_id,target_type,target_id,operation_key,
     amount_cents,status,checkout_url,created_at,expires_at)
  values
    (v_new,v_tenant,'cafe_order',p_order_id,p_operation_key,
     v_amount,'active',v_url,v_now,v_expiry);

  return jsonb_build_object('ok',true,'paymentRequestId',v_new,
     'amountCents',v_amount,'currency','ZAR','expiresAt',v_expiry,
     'status','active','scanUrl',v_url,'reused',false);
end
$function$;

revoke all on function public.qs_opps106_issue_counter_qr(uuid,text)
  from public,anon,authenticated;
grant execute on function public.qs_opps106_issue_counter_qr(uuid,text)
  to authenticated;
