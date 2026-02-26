-- User roles and RLS model

create extension if not exists pgcrypto;

-- 1) Role enum
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'app_role'
      AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.app_role AS ENUM ('visitors', 'publisher', 'editor', 'admin');
  END IF;
END
$$;

-- 2) Role mapping table
create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  user_role public.app_role not null default 'visitors',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_user_roles_set_updated_at
before update on public.user_roles
for each row
execute function public.set_updated_at();

-- Seed existing users as publishers, then ensure one admin
insert into public.user_roles (user_id, user_role)
select u.id, 'publisher'::public.app_role
from auth.users u
on conflict (user_id) do nothing;

update public.user_roles ur
set user_role = 'admin'::public.app_role
where ur.user_id = (
  select u.id
  from auth.users u
  where u.email = 'ebratovanov@abv.bg'
  limit 1
);

with first_user as (
  select u.id
  from auth.users u
  order by u.created_at asc nulls last
  limit 1
)
insert into public.user_roles (user_id, user_role)
select fu.id, 'admin'::public.app_role
from first_user fu
where not exists (
  select 1 from public.user_roles ur where ur.user_role = 'admin'::public.app_role
)
on conflict (user_id) do update set user_role = 'admin'::public.app_role;

-- 3) Role helper functions
create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(
    (
      select ur.user_role
      from public.user_roles ur
      where ur.user_id = auth.uid()
      limit 1
    ),
    'visitors'::public.app_role
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.current_app_role() = 'admin'::public.app_role;
$$;

-- 4) Enable RLS
alter table public.user_roles enable row level security;
alter table public.location_lists enable row level security;
alter table public.locations enable row level security;

-- 5) Drop old policies (if any)
drop policy if exists "Authenticated users can read all location lists" on public.location_lists;
drop policy if exists "Owners can insert their own location lists" on public.location_lists;
drop policy if exists "Owners can update their own location lists" on public.location_lists;
drop policy if exists "Owners can delete their own location lists" on public.location_lists;

drop policy if exists "Authenticated users can read all locations" on public.locations;
drop policy if exists "Owners can insert their own locations" on public.locations;
drop policy if exists "Owners can update their own locations" on public.locations;
drop policy if exists "Owners can delete their own locations" on public.locations;

drop policy if exists "Everyone can read user_roles" on public.user_roles;
drop policy if exists "Only admins can insert user_roles" on public.user_roles;
drop policy if exists "Only admins can update user_roles" on public.user_roles;
drop policy if exists "Only admins can delete user_roles" on public.user_roles;

-- 6) user_roles policies
create policy "Everyone can read user_roles"
on public.user_roles
for select
to public
using (true);

create policy "Only admins can insert user_roles"
on public.user_roles
for insert
to authenticated
with check (public.is_admin());

create policy "Only admins can update user_roles"
on public.user_roles
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "Only admins can delete user_roles"
on public.user_roles
for delete
to authenticated
using (public.is_admin());

-- 7) Public read for app data
create policy "Everyone can read location lists"
on public.location_lists
for select
to public
using (true);

create policy "Everyone can read locations"
on public.locations
for select
to public
using (true);

-- 8) location_lists write rules
-- publisher -> own only
-- admin -> all
create policy "Publishers own and admins insert location lists"
on public.location_lists
for insert
to authenticated
with check (
  (
    public.current_app_role() = 'publisher'::public.app_role
    and owner_user_id = auth.uid()
  )
  or public.is_admin()
);

create policy "Publishers own and admins update location lists"
on public.location_lists
for update
to authenticated
using (
  (
    public.current_app_role() = 'publisher'::public.app_role
    and owner_user_id = auth.uid()
  )
  or public.is_admin()
)
with check (
  (
    public.current_app_role() = 'publisher'::public.app_role
    and owner_user_id = auth.uid()
  )
  or public.is_admin()
);

create policy "Publishers own and admins delete location lists"
on public.location_lists
for delete
to authenticated
using (
  (
    public.current_app_role() = 'publisher'::public.app_role
    and owner_user_id = auth.uid()
  )
  or public.is_admin()
);

-- 9) locations write rules
-- publisher -> own only
-- editor -> all locations
-- admin -> all
create policy "Role based insert locations"
on public.locations
for insert
to authenticated
with check (
  (
    public.current_app_role() = 'publisher'::public.app_role
    and owner_user_id = auth.uid()
    and exists (
      select 1
      from public.location_lists l
      where l.id = list_id
        and l.owner_user_id = auth.uid()
    )
  )
  or public.current_app_role() = 'editor'::public.app_role
  or public.is_admin()
);

create policy "Role based update locations"
on public.locations
for update
to authenticated
using (
  (
    public.current_app_role() = 'publisher'::public.app_role
    and owner_user_id = auth.uid()
  )
  or public.current_app_role() = 'editor'::public.app_role
  or public.is_admin()
)
with check (
  (
    public.current_app_role() = 'publisher'::public.app_role
    and owner_user_id = auth.uid()
  )
  or public.current_app_role() = 'editor'::public.app_role
  or public.is_admin()
);

create policy "Role based delete locations"
on public.locations
for delete
to authenticated
using (
  (
    public.current_app_role() = 'publisher'::public.app_role
    and owner_user_id = auth.uid()
  )
  or public.current_app_role() = 'editor'::public.app_role
  or public.is_admin()
);