-- Add dedicated popup image path for map marker popup

alter table public.locations
add column if not exists popup_image_path text;