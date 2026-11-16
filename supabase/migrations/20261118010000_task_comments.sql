-- Comments on shared tasks (FEAT-14). Online only: no local table, no sync.
--
-- A comment belongs to a task in its owner's namespace and is reached only through the functions
-- below, which resolve the task through the share rules (`can_access`). A private task has no
-- audience, so it takes no comments. View-only members read; editors and the owner write (D262).

create table public.task_comments (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users on delete cascade,
  task_id    text not null,
  author_id  uuid not null references auth.users on delete cascade,
  body       text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  edited_at  timestamptz,
  deleted_at timestamptz
);
create index task_comments_task on public.task_comments (owner_id, task_id, created_at);
alter table public.task_comments enable row level security;
revoke all on public.task_comments from public, anon, authenticated;
grant all on public.task_comments to service_role;

/* The namespace holding a shared task the caller holds at least p_min on (null: none, or not shared). */
create function public.comment_owner(p_task text, p_min text) returns uuid
language sql stable security definer set search_path = '' as $$
  select r.owner_id from public.sync_rows r
  where r.tbl = 'tasks' and r.id = p_task and r.data->>'deleted_at' is null
    and public.can_access(r.owner_id, r.data->>'list_id', p_min)
    and public.is_shared(r.owner_id, 'list', r.data->>'list_id')
  limit 1;
$$;

create function public.task_comments(p_task text)
returns table (id uuid, author_id uuid, handle text, display_name text, avatar text, body text, created_at timestamptz, edited_at timestamptz, mine boolean)
language sql stable security definer set search_path = '' as $$
  select c.id, c.author_id, p.handle::text, p.display_name, p.avatar, c.body, c.created_at, c.edited_at, c.author_id = public.me()
  from public.task_comments c
  left join public.profiles p on p.id = c.author_id
  where c.owner_id = public.comment_owner(p_task, 'viewer') and c.task_id = p_task and c.deleted_at is null
    and (c.author_id = public.me() or not public.is_blocked(c.author_id, public.me()))
  order by c.created_at, c.id;
$$;

create function public.add_task_comment(p_task text, p_body text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.me();
  o uuid := public.comment_owner(p_task, 'editor');
  list_id text;
  c uuid;
begin
  if o is null then raise exception 'no_such_task' using errcode = 'P0002'; end if;
  if p_body is null or char_length(btrim(p_body)) not between 1 and 4000 then raise exception 'bad_value' using errcode = '23514'; end if;
  if not public.hit_rate('comment:' || me, 120, interval '1 hour') then raise exception 'too_many_comments' using errcode = '23514'; end if;
  insert into public.task_comments (owner_id, task_id, author_id, body) values (o, p_task, me, btrim(p_body)) returning id into c;
  select r.data->>'list_id' into list_id from public.sync_rows r where r.owner_id = o and r.tbl = 'tasks' and r.id = p_task;
  perform public.social_ping(array(select a from unnest(public.container_members(o, 'list', list_id)) a where a <> me));
  return c;
end $$;

create function public.edit_task_comment(p_id uuid, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.task_comments;
begin
  select * into c from public.task_comments x where x.id = p_id and x.deleted_at is null and x.author_id = public.me();
  if c.id is null or public.comment_owner(c.task_id, 'editor') is distinct from c.owner_id then raise exception 'no_such_task' using errcode = 'P0002'; end if;
  if p_body is null or char_length(btrim(p_body)) not between 1 and 4000 then raise exception 'bad_value' using errcode = '23514'; end if;
  update public.task_comments set body = btrim(p_body), edited_at = now() where id = p_id;
end $$;

/* The author removes their own comment; the task's owner may remove any. */
create function public.delete_task_comment(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.task_comments;
begin
  select * into c from public.task_comments x where x.id = p_id and x.deleted_at is null;
  if c.id is null or not (c.owner_id = public.me() or (c.author_id = public.me() and public.comment_owner(c.task_id, 'viewer') = c.owner_id)) then
    raise exception 'no_such_task' using errcode = 'P0002';
  end if;
  update public.task_comments set deleted_at = now() where id = p_id;
end $$;

/* Comments follow their task out: gone 30 days after the task was deleted (as the task's own record is stripped), or once it no longer exists. */
create function public.purge_comments() returns void
language sql security definer set search_path = '' as $$
  delete from public.task_comments c
  where c.deleted_at < now() - interval '30 days'
    or not exists (select 1 from public.sync_rows r where r.owner_id = c.owner_id and r.tbl = 'tasks' and r.id = c.task_id)
    or exists (select 1 from public.sync_rows r where r.owner_id = c.owner_id and r.tbl = 'tasks' and r.id = c.task_id
               and public.try_instant(r.data->>'deleted_at') < now() - interval '30 days');
$$;
revoke all on function public.comment_owner(text, text), public.purge_comments() from public, anon, authenticated;
grant execute on function public.purge_comments() to service_role;
select cron.schedule('purge-comments', '27 3 * * *', 'select public.purge_comments()');

grant execute on function public.task_comments(text), public.add_task_comment(text, text),
  public.edit_task_comment(uuid, text), public.delete_task_comment(uuid) to authenticated;

-- D289: every migration bumps the schema version by one.
update public.server_meta set schema_version = 13;
