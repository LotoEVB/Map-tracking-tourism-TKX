-- Initial schema for Map tracking tourism TKX

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.location_lists (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_location_lists_owner_user_id
  on public.location_lists(owner_user_id);

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.location_lists(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  latitude double precision not null check (latitude >= -90 and latitude <= 90),
  longitude double precision not null check (longitude >= -180 and longitude <= 180),
  image_paths text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_locations_list_id
  on public.locations(list_id);

create index if not exists idx_locations_owner_user_id
  on public.locations(owner_user_id);

create trigger trg_location_lists_set_updated_at
before update on public.location_lists
for each row
execute function public.set_updated_at();

create trigger trg_locations_set_updated_at
before update on public.locations
for each row
execute function public.set_updated_at();