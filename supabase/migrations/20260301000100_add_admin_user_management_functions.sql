create or replace function public.admin_set_user_password(target_user_id uuid, new_password text)
returns void
language plpgsql
security definer
set search_path = public, auth
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
  set encrypted_password = crypt(new_password, gen_salt('bf')),
      updated_at = now()
  where id = target_user_id;
end;
$$;

create or replace function public.admin_delete_user(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  target_role public.app_role;
  admins_count integer;
begin
  if not public.is_admin() then
    raise exception 'Access denied';
  end if;

  if target_user_id is null then
    raise exception 'target_user_id is required';
  end if;

  if target_user_id = auth.uid() then
    raise exception 'Cannot delete your own account from admin panel';
  end if;

  select coalesce(ur.user_role, 'visitors'::public.app_role) into target_role
  from auth.users u
  left join public.user_roles ur on ur.user_id = u.id
  where u.id = target_user_id
    and u.deleted_at is null;

  if not found then
    raise exception 'User not found';
  end if;

  if target_role = 'admin'::public.app_role then
    select count(*)::int into admins_count
    from public.user_roles ur
    where ur.user_role = 'admin'::public.app_role;

    if admins_count <= 1 then
      raise exception 'Cannot delete the last admin';
    end if;
  end if;

  update auth.users
  set deleted_at = now(),
      updated_at = now()
  where id = target_user_id
    and deleted_at is null;

  delete from public.user_roles where user_id = target_user_id;
end;
$$;

revoke all on function public.admin_set_user_password(uuid, text) from public;
revoke all on function public.admin_delete_user(uuid) from public;

grant execute on function public.admin_set_user_password(uuid, text) to authenticated;
grant execute on function public.admin_delete_user(uuid) to authenticated;
