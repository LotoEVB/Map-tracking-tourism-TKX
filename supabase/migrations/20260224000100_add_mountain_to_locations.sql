-- Add mountain field to locations

alter table public.locations
add column if not exists mountain text;