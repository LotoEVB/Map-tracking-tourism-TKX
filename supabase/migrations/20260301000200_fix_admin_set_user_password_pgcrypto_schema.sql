create extension if not exists pgcrypto;

create or replace function public.admin_set_user_password(target_user_id uuid, new_password text)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  target_deleted_at timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Access denied';
  end if;

  if target_user_id is null then
    raise exception 'target_user_id is required';
  end if;

  if coalesce(length(new_password), 0) < 8 then
    raise exception 'Password must be at least 8 characters';
  end if;

  select u.deleted_at into target_deleted_at
  from auth.users u
  where u.id = target_user_id;

  if not found then
    raise exception 'User not found';
  end if;

  if target_deleted_at is not null then
    raise exception 'User is already deleted';
  end if;

  update auth.users
  set encrypted_password = extensions.crypt(new_password, extensions.gen_salt('bf')),
      updated_at = now()
  where id = target_user_id;
end;
$$;

revoke all on function public.admin_set_user_password(uuid, text) from public;
grant execute on function public.admin_set_user_password(uuid, text) to authenticated;
