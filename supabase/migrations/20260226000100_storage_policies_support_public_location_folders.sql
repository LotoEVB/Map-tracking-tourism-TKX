drop policy if exists "Users can upload own location images" on storage.objects;
drop policy if exists "Users can update own location images" on storage.objects;
drop policy if exists "Users can delete own location images" on storage.objects;

create policy "Users can upload own location images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'location-images'
  and (
    (auth.uid()::text = (storage.foldername(name))[1])
    or (
      (storage.foldername(name))[1] = 'public'
      and nullif((storage.foldername(name))[2], '') is not null
    )
  )
);

create policy "Users can update own location images"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'location-images'
  and (
    (auth.uid()::text = (storage.foldername(name))[1])
    or (
      (storage.foldername(name))[1] = 'public'
      and nullif((storage.foldername(name))[2], '') is not null
    )
  )
)
with check (
  bucket_id = 'location-images'
  and (
    (auth.uid()::text = (storage.foldername(name))[1])
    or (
      (storage.foldername(name))[1] = 'public'
      and nullif((storage.foldername(name))[2], '') is not null
    )
  )
);

create policy "Users can delete own location images"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'location-images'
  and (
    (auth.uid()::text = (storage.foldername(name))[1])
    or (
      (storage.foldername(name))[1] = 'public'
      and nullif((storage.foldername(name))[2], '') is not null
    )
  )
);
