-- Only explicitly approved owners may promote or demote system administrators.
create or replace function public.enforce_approved_admin_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requester_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  approved boolean := requester_email in (
    'jointx.co@gmail.com',
    'jointsexclusive@gmail.com',
    'jasperjaimataruse@gmail.com',
    'jaicreativerealm@gmail.com'
  );
begin
  if tg_op = 'INSERT' and new.role = 'admin' and not approved then
    raise exception 'Only approved owners can assign administrator access.';
  end if;
  if tg_op = 'UPDATE' and new.role is distinct from old.role
    and (new.role = 'admin' or old.role = 'admin') and not approved then
    raise exception 'Only approved owners can change administrator access.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_users_enforce_admin_role_change on public.users;
create trigger trg_users_enforce_admin_role_change
  before insert or update of role on public.users
  for each row execute function public.enforce_approved_admin_role_change();