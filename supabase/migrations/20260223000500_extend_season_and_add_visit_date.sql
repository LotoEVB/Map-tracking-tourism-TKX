-- Extend season options and add explicit visit date

alter table public.locations
add column if not exists visit_date date;

alter table public.locations
drop constraint if exists locations_season_check;

alter table public.locations
add constraint locations_season_check
check (season in ('Сезон 2015', 'Сезон 2016', 'Сезон 2024'));