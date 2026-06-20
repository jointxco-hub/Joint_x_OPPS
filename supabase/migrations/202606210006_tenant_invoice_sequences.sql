-- Phase 2F: tenant-aware invoice numbering with Joint X continuity preserved.

alter table public.opps_invoice_number_sequences
  add column if not exists tenant_id uuid references public.tenants(id) on delete restrict;

update public.opps_invoice_number_sequences
set tenant_id = (select id from public.tenants where slug = 'joint-x')
where tenant_id is null;

alter table public.opps_invoice_number_sequences
  drop constraint if exists opps_invoice_number_sequences_pkey;
alter table public.opps_invoice_number_sequences
  add primary key (tenant_id, year);

alter table public.opps_invoices
  drop constraint if exists opps_invoices_invoice_number_key;
create unique index if not exists idx_opps_invoices_tenant_invoice_number
  on public.opps_invoices(tenant_id, invoice_number);

drop policy if exists finance_admin_manage_opps_invoice_number_sequences on public.opps_invoice_number_sequences;
drop policy if exists tenant_finance_manage_opps_invoice_number_sequences on public.opps_invoice_number_sequences;
create policy tenant_finance_manage_opps_invoice_number_sequences
  on public.opps_invoice_number_sequences for all to authenticated
  using ((public.is_app_admin() or public.user_finance_level() in (1, 2)) and public.can_access_tenant(tenant_id))
  with check ((public.is_app_admin() or public.user_finance_level() in (1, 2)) and public.can_access_tenant(tenant_id));

drop function if exists public.next_opps_invoice_number();
create function public.next_opps_invoice_number(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare invoice_year integer := extract(year from now())::integer; next_number integer;
begin
  if p_tenant_id is null or not public.can_access_tenant(p_tenant_id) then
    raise exception 'Not authorised to create invoice numbers for this tenant.';
  end if;
  insert into public.opps_invoice_number_sequences (tenant_id, year, last_number)
  values (p_tenant_id, invoice_year, 1)
  on conflict (tenant_id, year) do update
    set last_number = public.opps_invoice_number_sequences.last_number + 1, updated_at = now()
  returning last_number into next_number;
  return 'OPPS-INV-' || invoice_year::text || '-' || lpad(next_number::text, 4, '0');
end;
$$;

grant execute on function public.next_opps_invoice_number(uuid) to authenticated;
revoke execute on function public.next_opps_invoice_number(uuid) from anon;
