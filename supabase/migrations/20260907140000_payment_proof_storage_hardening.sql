-- ════════════════════════════════════════════════════════════════════
--  PAYMENT PROOF — grant + storage-object hardening
-- ════════════════════════════════════════════════════════════════════
--
-- Narrow follow-up to 20260907130000. Two things, both additive:
--
--   1. Remove the blanket anonymous SELECT on public.payment_attachments.
--      20260907130000 revoked writes from anon but Supabase's default
--      privileges leave anon with SELECT (RLS already returns zero rows to
--      anon, but the grant is unnecessary). authenticated keeps SELECT.
--
--   2. Lock the STORAGE OBJECT behind a linked/superseded proof. The
--      payment_attachments ROW is already immutable (trigger) and
--      write-revoked, but the underlying object in the private `uploads`
--      bucket could still be deleted or overwritten through the Storage
--      API by any staff member a permissive storage.objects policy allows
--      (this is the case on production's tenant-scoped delete policy).
--      Two RESTRICTIVE policies on storage.objects (DELETE, UPDATE) refuse
--      any operation on an `uploads` object whose path is referenced by a
--      payment_attachments row with status in ('linked','superseded').
--      RESTRICTIVE = ANDs with the existing permissive policies, so this
--      never widens access and never touches the existing policies. A
--      still-`staged` proof object stays deletable wherever a permissive
--      delete policy exists, so remove_staged_payment_proof cleanup works.
--
-- Does NOT touch: PayFast, the payment RPCs, the immutability trigger,
-- bucket privacy, or any existing storage.objects policy.
--
-- STAGING-FIRST. NOT APPLIED TO PRODUCTION. NO DEPLOY. NO PUSH.
-- ════════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
begin
  if to_regclass('public.payment_attachments') is null then
    raise exception 'PAYMENT_PROOF_HARDENING: public.payment_attachments is missing — apply 20260907130000 first';
  end if;
  if to_regclass('storage.objects') is null then
    raise exception 'PAYMENT_PROOF_HARDENING: storage.objects is missing';
  end if;
end $$;

-- ── 1. drop the unnecessary anonymous SELECT ──────────────────────
revoke all on public.payment_attachments from anon, public;
grant select on public.payment_attachments to authenticated;

-- ── 2. lock linked / superseded proof objects at the Storage layer ─
create or replace function public._payment_proof_object_locked(p_bucket text, p_name text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.payment_attachments pa
    where pa.storage_bucket = p_bucket
      and pa.storage_path   = p_name
      and pa.status in ('linked', 'superseded')
  );
$$;
revoke all on function public._payment_proof_object_locked(text, text) from public, anon;
grant execute on function public._payment_proof_object_locked(text, text) to authenticated;

drop policy if exists payment_proof_object_locked_delete on storage.objects;
create policy payment_proof_object_locked_delete
  on storage.objects as restrictive for delete to authenticated
  using (
    bucket_id <> 'uploads'
    or not public._payment_proof_object_locked(bucket_id, name)
  );

drop policy if exists payment_proof_object_locked_update on storage.objects;
create policy payment_proof_object_locked_update
  on storage.objects as restrictive for update to authenticated
  using (
    bucket_id <> 'uploads'
    or not public._payment_proof_object_locked(bucket_id, name)
  )
  with check (
    bucket_id <> 'uploads'
    or not public._payment_proof_object_locked(bucket_id, name)
  );

comment on function public._payment_proof_object_locked(text, text) is
  'True when a storage object (bucket, name) is referenced by a linked or superseded payment_attachments row. Used by the RESTRICTIVE storage.objects policies that make recorded proof-of-payment files immutable and undeletable through the Storage API.';

commit;
