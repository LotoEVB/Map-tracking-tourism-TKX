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
    u.email::text,
    coalesce(ur.user_role, 'visitors'::public.app_role)::public.app_role as user_role
  from auth.users u
  left join public.user_roles ur on ur.user_id = u.id
  where u.deleted_at is null
  order by u.created_at asc nulls last;
end;
$$;
