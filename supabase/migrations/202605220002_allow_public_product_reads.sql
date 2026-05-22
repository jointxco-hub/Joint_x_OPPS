do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'products'
      and policyname = 'Public can select products'
  ) then
    create policy "Public can select products"
      on public.products for select
      to anon
      using (true);
  end if;
end $$;
