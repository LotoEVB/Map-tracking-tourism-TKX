-- RLS and storage setup for Map tracking tourism TKX

alter table public.location_lists enable row level security;
alter table public.locations enable row level security;

-- Everyone signed in can read all lists and locations.
create policy "Authenticated users can read all location lists"
on public.location_lists
for select
to authenticated
using (true);

create policy "Owners can insert their own location lists"
on public.location_lists
for insert
to authenticated
with check (auth.uid() = owner_user_id);

create policy "Owners can update their own location lists"
on public.location_lists
for update
to authenticated
using (auth.uid() = owner_user_id)
with check (auth.uid() = owner_user_id);

create policy "Owners can delete their own location lists"
on public.location_lists
for delete
to authenticated
using (auth.uid() = owner_user_id);

create policy "Authenticated users can read all locations"
on public.locations
for select
to authenticated
using (true);

create policy "Owners can insert their own locations"
on public.locations
for insert
to authenticated
with check (
  auth.uid() = owner_user_id
  and exists (
    select 1
    from public.location_lists l
    where l.id = list_id
      and l.owner_user_id = auth.uid()
  )
);

create policy "Owners can update their own locations"
on public.locations
for update
to authenticated
using (auth.uid() = owner_user_id)
with check (
  auth.uid() = owner_user_id
  and exists (
    select 1
    from public.location_lists l
    where l.id = list_id
      and l.owner_user_id = auth.uid()
  )
);

create policy "Owners can delete their own locations"
on public.locations
for delete
to authenticated
using (auth.uid() = owner_user_id);

-- Storage bucket for optional location pictures.
insert into storage.buckets (id, name, public)
values ('location-images', 'location-images', true)
on conflict (id) do nothing;

-- Everyone signed in can view pictures.
create policy "Authenticated users can view location images"
on storage.objects
for select
to authenticated
using (bucket_id = 'location-images');

-- Users can upload only into their own folder: <uid>/filename
create policy "Users can upload own location images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'location-images'
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "Users can update own location images"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'location-images'
  and auth.uid()::text = (storage.foldername(name))[1]
)
with check (
  bucket_id = 'location-images'
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "Users can delete own location images"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'location-images'
  and auth.uid()::text = (storage.foldername(name))[1]
);