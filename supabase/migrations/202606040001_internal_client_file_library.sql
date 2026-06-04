-- Internal OPPS visibility for X LAB client account file links.
-- Keeps client file rows protected by RLS and exposes read access only through
-- the existing internal-user guard used by Client Requests.

create table if not exists public.client_file_folders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid null,
  client_id uuid null references public.clients(id) on delete set null,
  client_email text not null,
  name text not null,
  folder_type text null,
  parent_folder_id uuid null references public.client_file_folders(id) on delete set null,
  created_by text null,
  source_app text not null default 'xlab',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_file_links (
  id uuid primary key default gen_random_uuid(),
  store_id uuid null,
  client_id uuid null references public.clients(id) on delete set null,
  client_email text not null,
  file_url text not null,
  file_name text not null,
  file_type text null,
  file_size bigint null,
  folder_id uuid null references public.client_file_folders(id) on delete set null,
  linked_order_id uuid null references public.orders(id) on delete set null,
  linked_project_id uuid null,
  linked_tech_pack_id uuid null,
  uploaded_by_type text not null default 'client',
  uploaded_by_user_id uuid null,
  source_app text not null default 'xlab',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_client_file_folders_email on public.client_file_folders (lower(client_email));
create index if not exists idx_client_file_links_email on public.client_file_links (lower(client_email));
create index if not exists idx_client_file_links_folder on public.client_file_links (folder_id);
create index if not exists idx_client_file_links_order on public.client_file_links (linked_order_id);

alter table public.client_file_folders enable row level security;
alter table public.client_file_links enable row level security;

create or replace function public.get_internal_client_file_library(
  p_client_email text,
  p_limit int default 80
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_email text := lower(trim(coalesce(p_client_email, '')));
  safe_limit int := least(greatest(coalesce(p_limit, 80), 1), 200);
begin
  if not public.can_manage_internal_client_requests() then
    raise exception 'Not authorised to view client files.';
  end if;

  if clean_email = '' then
    return jsonb_build_object('folders', '[]'::jsonb, 'files', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'folders', coalesce((
      select jsonb_agg(to_jsonb(f) order by f.created_at asc)
      from public.client_file_folders f
      where lower(trim(f.client_email)) = clean_email
    ), '[]'::jsonb),
    'files', coalesce((
      select jsonb_agg(to_jsonb(l) order by l.created_at desc)
      from (
        select *
        from public.client_file_links l
        where lower(trim(l.client_email)) = clean_email
        order by l.created_at desc
        limit safe_limit
      ) l
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.get_internal_client_file_library(text, int) to authenticated;
revoke execute on function public.get_internal_client_file_library(text, int) from anon;
