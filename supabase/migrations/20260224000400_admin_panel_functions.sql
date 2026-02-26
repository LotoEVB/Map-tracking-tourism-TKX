-- Admin panel helper functions

create or replace function public.admin_list_users()
returns table (
  user_id uuid,
  email text,
  user_role public.app_role
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin() then
    raise exception 'Access denied';
  end if;

  return query
  select
    u.id,
    u.email,
    coalesce(ur.user_role, 'visitors'::public.app_role) as user_role
  from auth.users u
  left join public.user_roles ur on ur.user_id = u.id
  where u.deleted_at is null
  order by u.created_at asc nulls last;
end;
$$;

create or replace function public.admin_set_admin(target_user_id uuid, make_admin boolean)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  admins_count integer;
  target_role public.app_role;
begin
  if not public.is_admin() then
    raise exception 'Access denied';
  end if;

  if target_user_id is null then
    raise exception 'target_user_id is required';
  end if;

  select ur.user_role into target_role
  from public.user_roles ur
  where ur.user_id = target_user_id;

  if make_admin then
    insert into public.user_roles (user_id, user_role)
    values (target_user_id, 'admin'::public.app_role)
    on conflict (user_id)
    do update set user_role = 'admin'::public.app_role;
    return;
  end if;

  select count(*)::int into admins_count
  from public.user_roles ur
  where ur.user_role = 'admin'::public.app_role;

  if target_role = 'admin'::public.app_role and admins_count <= 1 then
    raise exception 'Cannot remove the last admin';
  end if;

  insert into public.user_roles (user_id, user_role)
  values (target_user_id, 'publisher'::public.app_role)
  on conflict (user_id)
  do update set user_role = 'publisher'::public.app_role;
end;
$$;

revoke all on function public.admin_list_users() from public;
revoke all on function public.admin_set_admin(uuid, boolean) from public;

grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_set_admin(uuid, boolean) to authenticated;