alter table public.locations
drop constraint if exists locations_season_check;

alter table public.locations
add constraint locations_season_check
check (
  season in (
    'Сезон 2015',
    'Сезон 2016',
    'Сезон 2017',
    'Сезон 2018',
    'Сезон 2019',
    'Сезон 2020',
    'Сезон 2021',
    'Сезон 2022',
    'Сезон 2023',
    'Сезон 2024',
    'Сезон 2025',
    'Сезон 2026'
  )
);
