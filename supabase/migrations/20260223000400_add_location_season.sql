-- Add season support to locations

alter table public.locations
add column if not exists season text;

update public.locations
set season = 'Сезон 2015'
where season is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'locations_season_check'
      and conrelid = 'public.locations'::regclass
  ) then
    alter table public.locations
    add constraint locations_season_check
    check (season in ('Сезон 2015', 'Сезон 2016'));
  end if;
end
$$;

alter table public.locations
alter column season set default 'Сезон 2015';

alter table public.locations
alter column season set not null;