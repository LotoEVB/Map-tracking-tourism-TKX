do $$
begin
  if exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'app_role'
  ) then
    alter type public.app_role add value if not exists 'visitors';
    alter type public.app_role add value if not exists 'publisher';
    alter type public.app_role add value if not exists 'editor';
    alter type public.app_role add value if not exists 'admin';
  else
    create type public.app_role as enum ('visitors', 'publisher', 'editor', 'admin');
  end if;
end
$$;
