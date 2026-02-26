create or replace function public.admin_set_user_role(target_user_id uuid, target_role public.app_role)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  admins_count integer;
  current_target_role public.app_role;
begin
  if not public.is_admin() then
    raise exception 'Access denied';
  end if;

  if target_user_id is null then
    raise exception 'target_user_id is required';
  end if;

  if target_role is null then
    raise exception 'target_role is required';
  end if;

  select ur.user_role into current_target_role
  from public.user_roles ur
  where ur.user_id = target_user_id;

  if current_target_role = 'admin'::public.app_role and target_role <> 'admin'::public.app_role then
    select count(*)::int into admins_count
    from public.user_roles ur
    where ur.user_role = 'admin'::public.app_role;

    if admins_count <= 1 then
      raise exception 'Cannot remove the last admin';
    end if;
  end if;

  insert into public.user_roles (user_id, user_role)
  values (target_user_id, target_role)
  on conflict (user_id)
  do update set user_role = excluded.user_role;
end;
$$;

revoke all on function public.admin_set_user_role(uuid, public.app_role) from public;
grant execute on function public.admin_set_user_role(uuid, public.app_role) to authenticated;
