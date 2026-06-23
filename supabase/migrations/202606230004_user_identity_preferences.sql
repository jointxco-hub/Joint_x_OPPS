alter table public.users add column if not exists preferred_name text;
update public.users set preferred_name = nullif(trim(preferred_name), '') where preferred_name is not null;