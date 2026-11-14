-- Shared lists and folders (v1.4, PLAN D262, ADR 0004; rules from D129-D142, D153-D157).
--
-- Records still live in sync_rows under one owner (the namespace). A share marks a list or folder
-- in its owner's namespace; members reach it, and everything inside it, through `share_members`.
-- Access adds up from the list's own share and the shares of up to 3 folders above it.
--
-- The client needs no new protocol: sync_push routes a patch to the namespace that holds the
-- record and checks the role there; sync_pull returns your own rows plus the shared rows you can
-- see, with your personal layer laid over them, and a tombstone for anything you stopped seeing.
-- Personal fields (task tags, reminders, pinned; list and folder placement) never reach the shared
-- record: they live in task_personal and container_placement.

-- ---------- Tables ----------

create table public.shares (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users on delete cascade,
  kind         text not null check (kind in ('folder', 'list')),
  container_id text not null check (container_id <> 'inbox' and char_length(container_id) between 1 and 200),
  created_at   timestamptz not null default now(),
  unique (owner_id, kind, container_id)
);

create table public.share_members (
  share_id   uuid not null references public.shares on delete cascade,
  account_id uuid not null references auth.users on delete cascade,
  role       text not null check (role in ('owner', 'editor', 'viewer')),
  -- 'invited' (one tap from the friend list, waiting for them to accept) or 'active'.
  status     text not null default 'active' check (status in ('invited', 'active')),
  joined_at  timestamptz not null default now(),
  primary key (share_id, account_id)
);
create index share_members_account on public.share_members (account_id);
create unique index share_members_one_owner on public.share_members (share_id) where role = 'owner';

/* Personal layer on a shared task: tags, reminders and pinned, per member. */
create table public.task_personal (
  account_id uuid not null references auth.users on delete cascade,
  owner_id   uuid not null references auth.users on delete cascade,
  task_id    text not null,
  fields     jsonb not null default '{}' check (jsonb_typeof(fields) = 'object'),
  version    bigint not null,
  primary key (account_id, owner_id, task_id)
);
create index task_personal_task on public.task_personal (owner_id, task_id);

/* Personal placement of a shared list or folder: sidebar order, pin, archive, tint and, for a
 * container whose parent you can't see, the personal folder it sits in. */
create table public.container_placement (
  account_id   uuid not null references auth.users on delete cascade,
  owner_id     uuid not null references auth.users on delete cascade,
  kind         text not null check (kind in ('folder', 'list')),
  container_id text not null,
  fields       jsonb not null default '{}' check (jsonb_typeof(fields) = 'object'),
  version      bigint not null,
  primary key (account_id, owner_id, kind, container_id)
);

/* A record an account could see and no longer can: pulled as a tombstone. */
create table public.sync_gone (
  account_id uuid not null references auth.users on delete cascade,
  tbl        text not null,
  id         text not null,
  at         timestamptz not null default now(),
  version    bigint not null,
  primary key (account_id, tbl, id)
);
create index sync_gone_version on public.sync_gone (account_id, version);

-- Share links grant a role on one share.
alter table public.invites
  add column share_id uuid references public.shares on delete cascade,
  add column role     text check (role in ('editor', 'viewer')),
  add constraint invites_share_role check ((share_id is null) = (role is null));

-- The list a record belongs to, for the access checks (task activity goes through its task).
alter table public.sync_rows add column list_id text generated always as (
  case tbl when 'lists' then id when 'tasks' then data->>'list_id' when 'sections' then data->>'list_id' end) stored;
create index sync_rows_list on public.sync_rows (owner_id, list_id) where list_id is not null;
create index sync_rows_activity on public.sync_rows (owner_id, (data->>'task_id')) where tbl = 'task_activity';
create index sync_rows_shared_lookup on public.sync_rows (tbl, id) where tbl in ('folders', 'lists', 'sections', 'tasks', 'task_activity');

-- ---------- Access ----------

create function public.role_rank(r text) returns int
language sql immutable set search_path = '' as $$
  select case r when 'owner' then 3 when 'editor' then 2 when 'viewer' then 1 else 0 end;
$$;

/* A folder and the folders above it in one namespace (at most 4, so a bad cycle can't loop). */
create function public.folder_chain(p_owner uuid, p_folder text) returns setof text
language sql stable security definer set search_path = '' as $$
  with recursive c(id, depth) as (
    select p_folder, 1 where p_folder is not null
    union all
    select r.data->>'parent_id', c.depth + 1 from c
    join public.sync_rows r on r.owner_id = p_owner and r.tbl = 'folders' and r.id = c.id
    where c.depth < 4 and r.data->>'parent_id' is not null
  )
  select id from c;
$$;

create function public.list_folder(p_owner uuid, p_list text) returns text
language sql stable security definer set search_path = '' as $$
  select r.data->>'folder_id' from public.sync_rows r where r.owner_id = p_owner and r.tbl = 'lists' and r.id = p_list;
$$;

/* The shares covering a list or folder: its own and those of the folders above it. */
create function public.covering_shares(p_owner uuid, p_kind text, p_id text) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select s.id from public.shares s
  where s.owner_id = p_owner and (
    (s.kind = p_kind and s.container_id = p_id) or
    (s.kind = 'folder' and s.container_id in (
      select public.folder_chain(p_owner, case p_kind when 'list' then public.list_folder(p_owner, p_id) else p_id end))));
$$;

/* The highest role an account has on a list or folder in p_owner's namespace (null: none). */
create function public.container_role(p_owner uuid, p_kind text, p_id text, p_account uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when p_owner = p_account then 'owner' else (
    select m.role from public.share_members m
    where m.account_id = p_account and m.status = 'active' and m.share_id in (select public.covering_shares(p_owner, p_kind, p_id))
    order by public.role_rank(m.role) desc limit 1) end;
$$;

create function public.list_role(p_owner uuid, p_list text, p_account uuid) returns text
language sql stable security definer set search_path = '' as $$
  select public.container_role(p_owner, 'list', p_list, p_account);
$$;

/* Everyone who can see a list or folder: its owner plus the active members of every covering share. */
create function public.container_members(p_owner uuid, p_kind text, p_id text) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select array(select p_owner union
    select m.account_id from public.share_members m
    where m.status = 'active' and m.share_id in (select public.covering_shares(p_owner, p_kind, p_id)));
$$;

create function public.is_shared(p_owner uuid, p_kind text, p_id text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select public.covering_shares(p_owner, p_kind, p_id));
$$;

/* The one access check (D154): does the signed-in account hold at least p_min on the list? */
create function public.can_access(p_owner uuid, p_list text, p_min text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.role_rank(public.list_role(p_owner, p_list, auth.uid())) >= public.role_rank(p_min);
$$;

/* The list a record of a shared table belongs to (activity: its task's list; folders: none). */
create function public.row_list(p_owner uuid, p_tbl text, p_id text, p_data jsonb) returns text
language sql stable security definer set search_path = '' as $$
  select case p_tbl
    when 'lists' then p_id
    when 'tasks' then p_data->>'list_id'
    when 'sections' then p_data->>'list_id'
    when 'task_activity' then (select t.data->>'list_id' from public.sync_rows t
                               where t.owner_id = p_owner and t.tbl = 'tasks' and t.id = p_data->>'task_id')
  end;
$$;

create function public.row_role(p_owner uuid, p_tbl text, p_id text, p_data jsonb, p_account uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when p_tbl = 'folders' then public.container_role(p_owner, 'folder', p_id, p_account)
    else public.container_role(p_owner, 'list', public.row_list(p_owner, p_tbl, p_id, p_data), p_account) end;
$$;

-- People in a share with you can see your profile.
create or replace function public.profile_visible(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_id = auth.uid()
    or exists (select 1 from public.friendships f where f.a = least(p_id, auth.uid()) and f.b = greatest(p_id, auth.uid()))
    or exists (select 1 from public.share_members x join public.share_members y on y.share_id = x.share_id
               where x.account_id = auth.uid() and y.account_id = p_id);
$$;

-- ---------- Personal fields ----------

create function public.personal_keys(p_tbl text) returns text[]
language sql immutable set search_path = '' as $$
  select case p_tbl
    when 'tasks' then array['tags', 'reminders', 'pinned']
    when 'lists' then array['sort_order', 'pinned', 'archived', 'tint']
    when 'folders' then array['sort_order', 'collapsed']
    else array[]::text[] end;
$$;

/* What a member sees before setting any personal field. */
create function public.personal_defaults(p_tbl text) returns jsonb
language sql immutable set search_path = '' as $$
  select case p_tbl
    when 'tasks' then '{"tags": "[]", "reminders": "[]", "pinned": 0}'::jsonb
    when 'lists' then '{"pinned": 0, "archived": 0}'::jsonb
    when 'folders' then '{"collapsed": 0}'::jsonb
    else '{}'::jsonb end;
$$;

create function public.pick(p jsonb, keys text[]) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(k, p->k), '{}') from unnest(keys) k where p ? k;
$$;

create function public.save_personal(p_account uuid, p_owner uuid, p_tbl text, p_id text, p_fields jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_fields = '{}' then return; end if;
  if p_tbl = 'tasks' then
    insert into public.task_personal as t (account_id, owner_id, task_id, fields, version)
    values (p_account, p_owner, p_id, p_fields, nextval('public.sync_version'))
    on conflict (account_id, owner_id, task_id) do update set fields = t.fields || excluded.fields, version = excluded.version;
  else
    insert into public.container_placement as t (account_id, owner_id, kind, container_id, fields, version)
    values (p_account, p_owner, rtrim(p_tbl, 's'), p_id, p_fields, nextval('public.sync_version'))
    on conflict (account_id, owner_id, kind, container_id) do update set fields = t.fields || excluded.fields, version = excluded.version;
  end if;
end $$;

/*
 * A record as one account sees it, or null if it can't. Shared records get the account's personal
 * layer; a shared list or folder whose parent the account can't see sits in its personal folder
 * (or at the top level).
 */
create function public.view_row(p_owner uuid, p_tbl text, p_id text, p_data jsonb, p_account uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  shared boolean;
  mine jsonb;
  parent_key text := case p_tbl when 'lists' then 'folder_id' when 'folders' then 'parent_id' end;
  out jsonb := p_data;
begin
  if p_tbl not in ('folders', 'lists', 'sections', 'tasks', 'task_activity') then
    return case when p_owner = p_account then p_data end;
  end if;
  if p_owner <> p_account and public.row_role(p_owner, p_tbl, p_id, p_data, p_account) is null then
    return null;
  end if;
  if p_tbl in ('sections', 'task_activity') then return out; end if;
  shared := case p_tbl when 'folders' then public.is_shared(p_owner, 'folder', p_id)
    else public.is_shared(p_owner, 'list', public.row_list(p_owner, p_tbl, p_id, p_data)) end;
  if not shared then return out; end if;
  if p_tbl = 'tasks' then
    select t.fields into mine from public.task_personal t where t.account_id = p_account and t.owner_id = p_owner and t.task_id = p_id;
  else
    select c.fields into mine from public.container_placement c
    where c.account_id = p_account and c.owner_id = p_owner and c.kind = rtrim(p_tbl, 's') and c.container_id = p_id;
  end if;
  -- Sort order and tint stay the owner's until the member sets their own.
  out := out - public.personal_keys(p_tbl) || public.pick(p_data, array['sort_order', 'tint']) || public.personal_defaults(p_tbl) || coalesce(mine, '{}');
  -- A parent folder the account can't see: personal placement, or the top level (D140).
  if parent_key is not null and p_owner <> p_account and p_data->>parent_key is not null
     and public.container_role(p_owner, 'folder', p_data->>parent_key, p_account) is null then
    out := jsonb_set(out, array[parent_key], coalesce(mine->parent_key, 'null'));
  end if;
  return out;
end $$;

-- ---------- Access changes ----------

/* Lists and folders under a container, each with who can see it now: {"lists": {id: [..]}, "folders": {..}}. */
create function public.scope_snapshot(p_owner uuid, p_kind text, p_id text) returns jsonb
language sql stable security definer set search_path = '' as $$
  with folders as (
    select r.id from public.sync_rows r
    where p_kind = 'folder' and r.owner_id = p_owner and r.tbl = 'folders' and p_id in (select public.folder_chain(p_owner, r.id))),
  lists as (
    select r.id from public.sync_rows r where r.owner_id = p_owner and r.tbl = 'lists'
      and ((p_kind = 'list' and r.id = p_id) or r.data->>'folder_id' in (select id from folders)))
  select jsonb_build_object(
    'owner', p_owner,
    'lists', coalesce((select jsonb_object_agg(id, to_jsonb(public.container_members(p_owner, 'list', id))) from lists), '{}'),
    'folders', coalesce((select jsonb_object_agg(id, to_jsonb(public.container_members(p_owner, 'folder', id))) from folders), '{}'),
    'shared', coalesce((select jsonb_object_agg(id, public.is_shared(p_owner, 'list', id)) from lists), '{}'));
$$;

/*
 * Settles a change in who sees a container, given snapshots from before and after (the namespace
 * may differ when the container moved into someone else's folder; reown_scope has already moved
 * the rows, so everything is looked up in the new one). Newcomers get every record
 * re-sent; leavers get tombstones and lose their personal layer and assignments; the owner's
 * personal fields move out of (or back into) the records when sharing starts (or ends).
 */
create function public.apply_scope_change(p_before jsonb, p_after jsonb) returns uuid[]
language plpgsql security definer set search_path = '' as $$
declare
  o_before uuid := (p_before->>'owner')::uuid;
  o_after uuid := (p_after->>'owner')::uuid;
  l text;
  f text;
  was uuid[];
  now_ uuid[];
  lost uuid[];
  touched uuid[] := '{}';
begin
  for l in select jsonb_object_keys(p_before->'lists') union select jsonb_object_keys(p_after->'lists') loop
    was := coalesce(array(select jsonb_array_elements_text(p_before->'lists'->l)::uuid), '{}');
    now_ := coalesce(array(select jsonb_array_elements_text(p_after->'lists'->l)::uuid), '{}');
    lost := array(select unnest(was) except select unnest(now_));
    touched := touched || was || now_;

    if coalesce((p_after->'shared'->>l)::boolean, false) and not coalesce((p_before->'shared'->>l)::boolean, false) then
      -- Sharing starts: the owner's tags, reminders and pins become their personal layer.
      insert into public.task_personal (account_id, owner_id, task_id, fields, version)
      select o_before, o_after, r.id, public.pick(r.data, public.personal_keys('tasks')), nextval('public.sync_version')
      from public.sync_rows r where r.owner_id = o_after and r.tbl = 'tasks' and r.list_id = l
      on conflict (account_id, owner_id, task_id) do nothing;
      update public.sync_rows r set data = r.data - public.personal_keys('tasks')
      where r.owner_id = o_after and r.tbl = 'tasks' and r.list_id = l;
    elsif coalesce((p_before->'shared'->>l)::boolean, false) and not coalesce((p_after->'shared'->>l)::boolean, false) then
      -- Sharing ends: the owner's personal layer goes back into the records; everyone else's goes.
      update public.sync_rows r set data = r.data || coalesce(t.fields, '{}')
      from public.task_personal t
      where r.owner_id = o_after and r.tbl = 'tasks' and r.list_id = l
        and t.account_id = o_after and t.owner_id = o_after and t.task_id = r.id;
      delete from public.task_personal t using public.sync_rows r
      where t.owner_id = o_after and t.task_id = r.id and r.owner_id = o_after and r.tbl = 'tasks' and r.list_id = l;
    end if;

    if array_length(lost, 1) > 0 then
      insert into public.sync_gone as g (account_id, tbl, id, version)
      select a, 'lists', l, nextval('public.sync_version') from unnest(lost) a
      on conflict (account_id, tbl, id) do update set at = now(), version = excluded.version;
      delete from public.task_personal t using public.sync_rows r
      where t.account_id = any(lost) and t.owner_id = o_after and t.task_id = r.id
        and r.owner_id = o_after and r.tbl = 'tasks' and r.list_id = l;
      delete from public.container_placement c where c.account_id = any(lost) and c.owner_id = o_after and c.kind = 'list' and c.container_id = l;
      update public.sync_rows r set data = r.data || '{"assignee_id": null}'
      where r.owner_id = o_after and r.tbl = 'tasks' and r.list_id = l and (r.data->>'assignee_id')::uuid = any(lost);
    end if;

    -- Re-send the list and everything in it (newcomers start from nothing; the rest re-apply it).
    update public.sync_rows r set version = nextval('public.sync_version'), updated_at = now()
    where r.owner_id = o_after and (r.list_id = l or (r.tbl = 'task_activity' and r.data->>'task_id' in (
      select t.id from public.sync_rows t where t.owner_id = o_after and t.tbl = 'tasks' and t.list_id = l)));
  end loop;

  for f in select jsonb_object_keys(p_before->'folders') union select jsonb_object_keys(p_after->'folders') loop
    was := coalesce(array(select jsonb_array_elements_text(p_before->'folders'->f)::uuid), '{}');
    now_ := coalesce(array(select jsonb_array_elements_text(p_after->'folders'->f)::uuid), '{}');
    lost := array(select unnest(was) except select unnest(now_));
    touched := touched || was || now_;
    if array_length(lost, 1) > 0 then
      insert into public.sync_gone as g (account_id, tbl, id, version)
      select a, 'folders', f, nextval('public.sync_version') from unnest(lost) a
      on conflict (account_id, tbl, id) do update set at = now(), version = excluded.version;
      delete from public.container_placement c where c.account_id = any(lost) and c.owner_id = o_after and c.kind = 'folder' and c.container_id = f;
    end if;
    update public.sync_rows r set version = nextval('public.sync_version'), updated_at = now()
    where r.owner_id = o_after and r.tbl = 'folders' and r.id = f;
  end loop;
  return array(select distinct unnest(touched));
end $$;

/* Moves a container and everything inside it to another namespace (rows keep their ids). */
create function public.reown_scope(p_from uuid, p_to uuid, p_snapshot jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  lists text[] := array(select jsonb_object_keys(p_snapshot->'lists'));
  folders text[] := array(select jsonb_object_keys(p_snapshot->'folders'));
begin
  if p_from = p_to then return; end if;
  update public.sync_rows r set owner_id = p_to
  where r.owner_id = p_from and r.tbl = 'task_activity' and r.data->>'task_id' in (
    select t.id from public.sync_rows t where t.owner_id = p_from and t.tbl = 'tasks' and t.list_id = any(lists));
  update public.sync_rows r set owner_id = p_to where r.owner_id = p_from and r.list_id = any(lists);
  update public.sync_rows r set owner_id = p_to where r.owner_id = p_from and r.tbl = 'folders' and r.id = any(folders);
  update public.task_personal t set owner_id = p_to where t.owner_id = p_from and t.task_id in (
    select r.id from public.sync_rows r where r.owner_id = p_to and r.tbl = 'tasks' and r.list_id = any(lists));
  update public.container_placement c set owner_id = p_to where c.owner_id = p_from
    and ((c.kind = 'list' and c.container_id = any(lists)) or (c.kind = 'folder' and c.container_id = any(folders)));
  update public.shares s set owner_id = p_to where s.owner_id = p_from
    and ((s.kind = 'list' and s.container_id = any(lists)) or (s.kind = 'folder' and s.container_id = any(folders)));
end $$;

/* Wakes other accounts' devices (Realtime on `devices`) so they pull. */
create function public.ping(p_accounts uuid[]) returns void
language sql security definer set search_path = '' as $$
  update public.devices set last_seen = now() where owner_id = any(p_accounts) and owner_id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000');
$$;

-- ---------- Push ----------

/* The namespace holding a list or folder the account may reach (its own first). */
create function public.container_owner(p_account uuid, p_kind text, p_id text) returns uuid
language sql stable security definer set search_path = '' as $$
  select r.owner_id from public.sync_rows r
  where r.tbl = p_kind || 's' and r.id = p_id
    and (r.owner_id = p_account or public.container_role(r.owner_id, p_kind, p_id, p_account) is not null)
  order by r.owner_id = p_account desc limit 1;
$$;

/*
 * Applies one patch to a record of a shared-capable table, wherever it lives, and returns the
 * accounts to ping. Raises (and the caller refuses the patch) when the account's role forbids it.
 */
create function public.push_shared(me uuid, p_tbl text, p_id text, p_fields jsonb) returns uuid[]
language plpgsql security definer set search_path = '' as $$
declare
  f jsonb := p_fields - 'created_by' - 'completed_by' - 'actor_id';
  cur_owner uuid;
  cur jsonb;
  o uuid;                   -- the namespace the record ends up in
  v_role text;
  v_kind text := case p_tbl when 'folders' then 'folder' when 'lists' then 'list' end;
  parent_key text := case p_tbl when 'lists' then 'folder_id' when 'folders' then 'parent_id' when 'task_activity' then 'task_id' else 'list_id' end;
  old_parent text;
  new_parent text;
  shared boolean;
  personal jsonb;
  before jsonb;
  after jsonb;
  touched uuid[] := '{}';
  root boolean;
begin
  -- The record: your own, or one shared with you.
  select r.owner_id, r.data into cur_owner, cur from public.sync_rows r
  where r.tbl = p_tbl and r.id = p_id
    and (r.owner_id = me or public.row_role(r.owner_id, r.tbl, r.id, r.data, me) is not null)
  order by r.owner_id = me desc limit 1;
  old_parent := cur->>parent_key;
  new_parent := case when f ? parent_key then f->>parent_key else old_parent end;

  -- task_activity: lives with its task; viewers' activity is dropped (they can't edit).
  if p_tbl = 'task_activity' then
    o := coalesce(cur_owner, (select r.owner_id from public.sync_rows r where r.tbl = 'tasks' and r.id = new_parent
      and (r.owner_id = me or public.row_role(r.owner_id, 'tasks', r.id, r.data, me) is not null)
      order by r.owner_id = me desc limit 1), me);
    if public.role_rank(public.row_role(o, 'task_activity', p_id, coalesce(cur, '{}') || f, me)) < 2 then
      return '{}';
    end if;
    insert into public.sync_rows as r (owner_id, tbl, id, data, version)
    values (o, p_tbl, p_id, f || jsonb_build_object('actor_id', me), nextval('public.sync_version'))
    on conflict (owner_id, tbl, id) do update set data = r.data || excluded.data, version = excluded.version, updated_at = now();
    return case when o = me and not public.is_shared(o, 'list', public.row_list(o, p_tbl, p_id, f)) then '{}'
      else public.container_members(o, 'list', public.row_list(o, p_tbl, p_id, f)) end;
  end if;

  -- Where the record goes: tasks and sections follow their list, lists and folders their folder.
  o := cur_owner;
  if new_parent is distinct from old_parent or cur_owner is null then
    if new_parent is null then
      o := coalesce(cur_owner, me);
    else
      o := public.container_owner(me, case when p_tbl in ('lists', 'folders') then 'folder' else 'list' end, new_parent);
      if o is null then
        o := coalesce(cur_owner, me); -- an unknown parent: the client's problem, as before sharing
      end if;
    end if;
  end if;

  -- A shared list or folder whose parent the member can't see: the parent is personal placement.
  if cur_owner is not null and cur_owner <> me and v_kind is not null and f ? parent_key
     and (old_parent is null or public.container_role(cur_owner, 'folder', old_parent, me) is null)
     and (new_parent is null or o = me) then
    perform public.save_personal(me, cur_owner, p_tbl, p_id, jsonb_build_object(parent_key, f->parent_key));
    f := f - parent_key;
    o := cur_owner;
    new_parent := old_parent;
  end if;

  shared := case when v_kind is not null then
      public.is_shared(o, v_kind, p_id) or (new_parent is not null and public.is_shared(o, 'folder', new_parent))
    else new_parent is not null and public.is_shared(o, 'list', new_parent) end;

  -- Personal fields of a shared record go to the personal layer.
  if shared then
    personal := public.pick(f, public.personal_keys(p_tbl));
    perform public.save_personal(me, o, p_tbl, p_id, personal);
    f := f - public.personal_keys(p_tbl);
    if f = '{}' then return '{}'; end if;
  end if;

  -- Role on the record (for a new or moved one, on where it goes).
  v_role := case
    when o = me and cur_owner is null then 'owner'
    when v_kind is not null and cur_owner is not null then public.container_role(cur_owner, v_kind, p_id, me)
    when new_parent is null then case when o = me then 'owner' end
    else public.container_role(o, case when p_tbl in ('lists', 'folders') then 'folder' else 'list' end, new_parent, me) end;
  if public.role_rank(v_role) < 2 then
    raise exception 'read_only' using errcode = '42501';
  end if;
  -- A list or folder moving under another folder needs editor there too.
  if v_kind is not null and cur_owner is not null and new_parent is distinct from old_parent and new_parent is not null
     and public.role_rank(public.container_role(o, 'folder', new_parent, me)) < 2 then
    raise exception 'read_only' using errcode = '42501';
  end if;
  if cur_owner is not null and cur_owner <> me and public.role_rank(public.row_role(cur_owner, p_tbl, p_id, cur, me)) < 2 then
    raise exception 'read_only' using errcode = '42501';
  end if;

  -- The share itself (a shared list or folder): only its owner renames, deletes or moves it.
  root := v_kind is not null and cur_owner is not null and exists (
    select 1 from public.shares s where s.owner_id = cur_owner and s.kind = v_kind and s.container_id = p_id);
  if root and me <> cur_owner and (f ? 'name' or (f ? 'deleted_at' and f->>'deleted_at' is not null) or f ? parent_key) then
    raise exception 'owner_only' using errcode = '42501';
  end if;

  if p_tbl = 'tasks' then
    if f ? 'assignee_id' and f->>'assignee_id' is not null
       and public.role_rank(public.list_role(o, new_parent, (f->>'assignee_id')::uuid)) < 2 then
      raise exception 'bad_assignee' using errcode = '23514';
    end if;
    if cur is null then
      f := f || jsonb_build_object('created_by', me);
    end if;
    if f ? 'status' then
      f := f || jsonb_build_object('completed_by', case when f->>'status' = 'done' then to_jsonb(me) else 'null'::jsonb end);
    end if;
  end if;

  -- Moving a task out of a share: its creator, its parent task's creator, or the owner (D135).
  if p_tbl = 'tasks' and cur is not null and new_parent is distinct from old_parent
     and exists (select unnest(public.container_members(cur_owner, 'list', old_parent))
                 except select unnest(public.container_members(o, 'list', new_parent)))
     and me <> cur_owner and me::text is distinct from cur->>'created_by'
     and me::text is distinct from (select p.data->>'created_by' from public.sync_rows p
                                    where p.owner_id = cur_owner and p.tbl = 'tasks' and p.id = cur->>'parent_id') then
    raise exception 'only_creator_moves_out' using errcode = '42501';
  end if;

  -- Moving lists and folders across the boundary (D141, D153).
  if v_kind is not null and cur is not null and new_parent is distinct from old_parent then
    if me <> cur_owner then
      raise exception 'owner_only' using errcode = '42501';
    end if;
    if v_kind = 'folder' and new_parent is not null and public.is_shared(o, 'folder', new_parent)
       and not (o = cur_owner and old_parent is not null and public.is_shared(cur_owner, 'folder', old_parent)) then
      raise exception 'personal_folder_into_share' using errcode = '42501';
    end if;
    if o <> cur_owner and exists (select 1 from public.shares s where s.owner_id = cur_owner and s.kind = v_kind and s.container_id = p_id) then
      raise exception 'share_into_other_owner' using errcode = '42501';
    end if;
    before := public.scope_snapshot(cur_owner, v_kind, p_id);
  end if;
  if v_kind = 'folder' and new_parent is not null and (select count(*) from public.folder_chain(o, new_parent)) >= 3 then
    raise exception 'folder_too_deep' using errcode = '23514';
  end if;

  -- A task moving into another namespace takes its activity with it.
  if p_tbl in ('tasks', 'sections') and cur_owner is not null and o <> cur_owner then
    if p_tbl = 'sections' then
      raise exception 'section_across_owners' using errcode = '42501';
    end if;
    update public.sync_rows r set owner_id = o, version = nextval('public.sync_version')
    where r.owner_id = cur_owner and r.tbl = 'task_activity' and r.data->>'task_id' = p_id;
    update public.sync_rows r set owner_id = o where r.owner_id = cur_owner and r.tbl = 'tasks' and r.id = p_id;
    update public.task_personal t set owner_id = o where t.owner_id = cur_owner and t.task_id = p_id;
  end if;

  if before is not null then
    perform public.reown_scope(cur_owner, o, before);
  end if;

  insert into public.sync_rows as r (owner_id, tbl, id, data, version)
  values (o, p_tbl, p_id, f, nextval('public.sync_version'))
  on conflict (owner_id, tbl, id) do update set data = r.data || excluded.data, version = excluded.version, updated_at = now();

  if before is not null then
    after := public.scope_snapshot(o, v_kind, p_id);
    touched := public.apply_scope_change(before, after);
  end if;

  -- A task crossing the boundary: its old audience gets a tombstone; personal fields follow.
  if p_tbl = 'tasks' and cur is not null and (new_parent is distinct from old_parent or o <> cur_owner) then
    declare
      was uuid[] := public.container_members(cur_owner, 'list', old_parent);
      now_ uuid[] := public.container_members(o, 'list', new_parent);
      lost uuid[] := array(select unnest(was) except select unnest(now_));
      was_shared boolean := public.is_shared(cur_owner, 'list', old_parent);
    begin
      touched := touched || was || now_;
      if array_length(lost, 1) > 0 then
        insert into public.sync_gone (account_id, tbl, id, version)
        select a, 'tasks', p_id, nextval('public.sync_version') from unnest(lost) a
        on conflict (account_id, tbl, id) do update set at = now(), version = excluded.version;
        delete from public.task_personal t where t.owner_id = o and t.task_id = p_id and t.account_id = any(lost);
        update public.sync_rows r set data = r.data || '{"assignee_id": null}'
        where r.owner_id = o and r.tbl = 'tasks' and r.id = p_id and (r.data->>'assignee_id')::uuid = any(lost);
      end if;
      if not was_shared and shared then
        perform public.save_personal(me, o, 'tasks', p_id, public.pick(cur, public.personal_keys('tasks')) || coalesce(personal, '{}'));
        update public.sync_rows r set data = r.data - public.personal_keys('tasks') where r.owner_id = o and r.tbl = 'tasks' and r.id = p_id;
      elsif was_shared and not shared then
        update public.sync_rows r set data = r.data || coalesce((select t.fields from public.task_personal t
          where t.account_id = me and t.owner_id = o and t.task_id = p_id), '{}') || public.pick(f, public.personal_keys('tasks'))
        where r.owner_id = o and r.tbl = 'tasks' and r.id = p_id;
        delete from public.task_personal t where t.owner_id = o and t.task_id = p_id;
      end if;
      -- Its history goes to the new audience too.
      update public.sync_rows r set version = nextval('public.sync_version')
      where r.owner_id = o and r.tbl = 'task_activity' and r.data->>'task_id' = p_id;
    end;
  elsif shared or (cur_owner is not null and cur_owner <> me) then
    touched := touched || case when v_kind is not null then public.container_members(o, v_kind, p_id)
      else public.container_members(o, 'list', new_parent) end;
  end if;
  return touched;
end $$;

/*
 * Applies a device's outbox patches in order (PLAN D225), routing records of shared lists and
 * folders to the namespace that holds them. A refused patch is reported, and the record is
 * re-sent (or, if the device made it, taken back) so the device returns to the server's state.
 */
create or replace function public.sync_push(p_device uuid, p_schema int, p_patches jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  last bigint;
  p jsonb;
  seq bigint;
  f jsonb;
  cur jsonb;
  refused jsonb := '[]';
  touched uuid[] := '{}';
  shared_tbl boolean;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  if p_schema < (select min_client_schema from public.server_meta) then
    return jsonb_build_object('error', 'update_required');
  end if;
  if jsonb_typeof(p_patches) <> 'array' or jsonb_array_length(p_patches) > 500 then
    raise exception 'bad_batch' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(me::text, 0));
  -- Shared records take a second, global lock: two members' pushes then can't interleave.
  -- ponytail: one lock for all shares; per-share locks if pushes queue up.
  perform pg_advisory_xact_lock(hashtextextended('shares', 0));

  insert into public.devices (owner_id, id) values (me, p_device)
  on conflict (owner_id, id) do update set last_seen = now()
  returning last_seq into last;

  for p in select value from jsonb_array_elements(p_patches) loop
    seq := (p->>'seq')::bigint;
    continue when seq is null or seq <= last;
    last := seq;
    f := p->'fields';
    shared_tbl := p->>'tbl' in ('folders', 'lists', 'sections', 'tasks', 'task_activity');
    begin
      if jsonb_typeof(f) <> 'object' or p->>'id' is null then
        raise exception 'bad_patch' using errcode = '22023';
      end if;
      if shared_tbl then
        touched := touched || public.push_shared(me, p->>'tbl', p->>'id', f);
      else
        if f ? '_delta' then
          select r.data into cur from public.sync_rows r where r.owner_id = me and r.tbl = p->>'tbl' and r.id = p->>'id';
          f := (f - '_delta') || jsonb_build_object('value',
            (case when cur is null or cur->>'deleted_at' is not null then 0 else coalesce((cur->>'value')::numeric, 0) end)
            + (f->>'_delta')::numeric);
        end if;
        insert into public.sync_rows as r (owner_id, tbl, id, data, version)
        values (me, p->>'tbl', p->>'id', f, nextval('public.sync_version'))
        on conflict (owner_id, tbl, id) do update
          set data = r.data || excluded.data, version = excluded.version, updated_at = now();
      end if;
    exception when others then
      refused := refused || jsonb_build_object('seq', seq, 'tbl', p->>'tbl', 'id', p->>'id', 'reason', sqlerrm);
      -- Refused for the account's role: send the server's copy back, or take back a record it made.
      if shared_tbl and sqlstate = '42501' then
        update public.sync_rows r set version = nextval('public.sync_version')
        where r.tbl = p->>'tbl' and r.id = p->>'id'
          and (r.owner_id = me or public.row_role(r.owner_id, r.tbl, r.id, r.data, me) is not null);
        if not found then
          insert into public.sync_gone as g (account_id, tbl, id, version)
          values (me, p->>'tbl', p->>'id', nextval('public.sync_version'))
          on conflict (account_id, tbl, id) do update set at = now(), version = excluded.version;
        end if;
      end if;
    end;
  end loop;

  update public.devices set last_seq = last, last_seen = now() where owner_id = me and id = p_device;
  perform public.ping(array(select distinct unnest(touched)));
  return jsonb_build_object('last_seq', last, 'refused', refused);
end $$;

-- ---------- Pull ----------

/*
 * Everything that changed for you after `p_cursor`, oldest first: your records, shared records you
 * can see (with your personal layer), personal-layer changes, and tombstones for what you lost.
 */
create or replace function public.sync_pull(p_cursor bigint, p_limit int default 1000)
returns table (tbl text, id text, data jsonb, version bigint)
language sql stable security definer set search_path = '' as $$
  with me as (select public.me() as id),
  owners as (
    select distinct s.owner_id from public.shares s join public.share_members m on m.share_id = s.id
    where m.account_id = (select id from me) and m.status = 'active' and s.owner_id <> (select id from me)),
  changed as (
    select r.owner_id, r.tbl, r.id, r.data, r.version from public.sync_rows r
    where r.owner_id = (select id from me) and r.version > p_cursor
    union all
    select r.owner_id, r.tbl, r.id, r.data, r.version from public.sync_rows r
    where r.owner_id in (select owner_id from owners) and r.version > p_cursor
      and r.tbl in ('folders', 'lists', 'sections', 'tasks', 'task_activity')),
  out as (
    select c.tbl, c.id, public.view_row(c.owner_id, c.tbl, c.id, c.data, (select id from me)) as data, c.version from changed c
    union all
    select g.tbl, g.id, jsonb_build_object('deleted_at', to_char(g.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), g.version
    from public.sync_gone g where g.account_id = (select id from me) and g.version > p_cursor
    union all
    select 'tasks', t.task_id, t.fields, t.version from public.task_personal t
    join public.sync_rows r on r.owner_id = t.owner_id and r.tbl = 'tasks' and r.id = t.task_id
    where t.account_id = (select id from me) and t.version > p_cursor
      and public.row_role(r.owner_id, r.tbl, r.id, r.data, (select id from me)) is not null
    union all
    select c.kind || 's', c.container_id, c.fields, c.version from public.container_placement c
    where c.account_id = (select id from me) and c.version > p_cursor
      and public.container_role(c.owner_id, c.kind, c.container_id, (select id from me)) is not null)
  select o.tbl, o.id, o.data, o.version from out o where o.data is not null
  order by o.version
  limit least(greatest(p_limit, 1), 1000);
$$;

-- ---------- Sharing and membership ----------

create function public.share_of(p_share uuid) returns public.shares
language sql stable security definer set search_path = '' as $$
  select * from public.shares where id = p_share;
$$;

/* Wraps a membership change in before/after snapshots of the share's scope. */
create function public.settle_share(p_share uuid, p_before jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.shares := public.share_of(p_share);
begin
  perform public.ping(public.apply_scope_change(p_before, public.scope_snapshot(s.owner_id, s.kind, s.container_id)));
end $$;

/* Shares one of your lists or folders and returns the share id (existing shares are reused). */
create function public.create_share(p_kind text, p_container text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.me();
  sid uuid;
  before jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('shares', 0));
  if not exists (select 1 from public.sync_rows r where r.owner_id = me and r.tbl = p_kind || 's' and r.id = p_container
                 and r.data->>'deleted_at' is null) then
    raise exception 'no_such_container' using errcode = 'P0002';
  end if;
  select id into sid from public.shares where owner_id = me and kind = p_kind and container_id = p_container;
  if sid is not null then return sid; end if;
  before := public.scope_snapshot(me, p_kind, p_container);
  insert into public.shares (owner_id, kind, container_id) values (me, p_kind, p_container) returning id into sid;
  insert into public.share_members (share_id, account_id, role) values (sid, me, 'owner');
  perform public.settle_share(sid, before);
  return sid;
end $$;

/* Distinct people across a share's whole tree, for the member cap (D153). */
create function public.tree_people(p_share uuid) returns int
language sql stable security definer set search_path = '' as $$
  with s as (select * from public.shares where id = p_share),
  snap as (select public.scope_snapshot(s.owner_id, s.kind, s.container_id) j from s)
  select count(distinct m.account_id)::int from public.share_members m
  where m.share_id in (
    select x.id from public.shares x, s, snap
    where x.owner_id = s.owner_id and (
      (x.kind = 'list' and x.container_id in (select jsonb_object_keys(snap.j->'lists'))) or
      (x.kind = 'folder' and x.container_id in (select jsonb_object_keys(snap.j->'folders')))))
  or m.share_id in (select public.covering_shares(s.owner_id, s.kind, s.container_id) from s);
$$;

/* Adds or re-roles a member. Only the owner. Friends are invited ('invited' until they accept). */
create function public.add_member(p_share uuid, p_account uuid, p_role text, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.shares := public.share_of(p_share);
  before jsonb;
begin
  if p_role not in ('editor', 'viewer') then raise exception 'bad_role' using errcode = '22023'; end if;
  if p_account = s.owner_id then raise exception 'bad_account' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('shares', 0));
  before := public.scope_snapshot(s.owner_id, s.kind, s.container_id);
  insert into public.share_members as m (share_id, account_id, role, status) values (p_share, p_account, p_role, p_status)
  on conflict (share_id, account_id) do update set role = excluded.role,
    status = case when m.status = 'active' then 'active' else excluded.status end;
  if public.tree_people(p_share) > (public.plan_limits(s.owner_id)->>'share_members')::int then
    raise exception 'too_many_members' using errcode = '23514';
  end if;
  perform public.settle_share(p_share, before);
end $$;

create function public.invite_to_share(p_share uuid, p_friend uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.me();
begin
  if (public.share_of(p_share)).owner_id is distinct from me then raise exception 'owner_only' using errcode = '42501'; end if;
  if not public.is_friend(me, p_friend) then raise exception 'not_friends' using errcode = '42501'; end if;
  perform public.add_member(p_share, p_friend, p_role, 'invited');
end $$;

create function public.set_member_role(p_share uuid, p_account uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (public.share_of(p_share)).owner_id is distinct from public.me() then raise exception 'owner_only' using errcode = '42501'; end if;
  if not exists (select 1 from public.share_members where share_id = p_share and account_id = p_account) then
    raise exception 'no_such_member' using errcode = 'P0002';
  end if;
  perform public.add_member(p_share, p_account, p_role, 'active');
end $$;

/* Accepts or declines a share invitation sent to you. */
create function public.respond_share(p_share uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.me();
  s public.shares := public.share_of(p_share);
  before jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('shares', 0));
  before := public.scope_snapshot(s.owner_id, s.kind, s.container_id);
  if p_accept then
    update public.share_members set status = 'active', joined_at = now() where share_id = p_share and account_id = me and status = 'invited';
  else
    delete from public.share_members where share_id = p_share and account_id = me and status = 'invited';
  end if;
  if not found then raise exception 'no_such_invitation' using errcode = 'P0002'; end if;
  perform public.settle_share(p_share, before);
end $$;

/* Removes a member (the owner), or leaves (yourself). The owner can't leave: transfer first. */
create function public.remove_member(p_share uuid, p_account uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.me();
  s public.shares := public.share_of(p_share);
  before jsonb;
begin
  if s.id is null then raise exception 'no_such_share' using errcode = 'P0002'; end if;
  if p_account = s.owner_id then raise exception 'transfer_first' using errcode = '42501'; end if;
  if me <> s.owner_id and me <> p_account then raise exception 'owner_only' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('shares', 0));
  before := public.scope_snapshot(s.owner_id, s.kind, s.container_id);
  delete from public.share_members where share_id = p_share and account_id = p_account;
  perform public.settle_share(p_share, before);
end $$;

/* Stops sharing: every member loses it, the owner keeps the records. */
create function public.delete_share(p_share uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.shares := public.share_of(p_share);
  before jsonb;
begin
  if s.owner_id is distinct from public.me() then raise exception 'owner_only' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('shares', 0));
  before := public.scope_snapshot(s.owner_id, s.kind, s.container_id);
  delete from public.shares where id = p_share;
  perform public.ping(public.apply_scope_change(before, public.scope_snapshot(s.owner_id, s.kind, s.container_id)));
end $$;

/*
 * Hands a share (and every share nested in it) to another active member, who becomes owner; the
 * records move to their namespace. The old owner stays on as an editor.
 */
create function public.transfer_share_as(p_share uuid, p_to uuid, me uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.shares := public.share_of(p_share);
  snap jsonb;
  before jsonb;
  inner_share uuid;
begin
  if s.owner_id is distinct from me then raise exception 'owner_only' using errcode = '42501'; end if;
  if not exists (select 1 from public.share_members where share_id = p_share and account_id = p_to and status = 'active') then
    raise exception 'no_such_member' using errcode = 'P0002';
  end if;
  -- A shared folder sitting in the owner's personal folder moves to the new owner's top level.
  perform pg_advisory_xact_lock(hashtextextended('shares', 0));
  snap := public.scope_snapshot(s.owner_id, s.kind, s.container_id);
  before := snap;
  for inner_share in select x.id from public.shares x where x.owner_id = s.owner_id and (
      (x.kind = 'list' and x.container_id in (select jsonb_object_keys(snap->'lists'))) or
      (x.kind = 'folder' and x.container_id in (select jsonb_object_keys(snap->'folders')))) loop
    update public.share_members set role = 'editor' where share_id = inner_share and account_id = me;
    insert into public.share_members as m (share_id, account_id, role) values (inner_share, p_to, 'owner')
    on conflict (share_id, account_id) do update set role = 'owner', status = 'active';
  end loop;
  perform public.reown_scope(me, p_to, snap);
  update public.sync_rows r set data = jsonb_set(r.data, array[case s.kind when 'list' then 'folder_id' else 'parent_id' end], 'null')
  where r.owner_id = p_to and r.tbl = s.kind || 's' and r.id = s.container_id;
  before := jsonb_set(before, '{owner}', to_jsonb(me));
  perform public.ping(public.apply_scope_change(before, public.scope_snapshot(p_to, s.kind, s.container_id)));
end $$;

create function public.transfer_share(p_share uuid, p_to uuid) returns void
language sql security definer set search_path = '' as $$
  select public.transfer_share_as(p_share, p_to, public.me());
$$;

/* Shares you're in (owner, member or invited), with your role and the container's name. */
create function public.my_shares()
returns table (share_id uuid, owner_id uuid, kind text, container_id text, name text, role text, status text, members int)
language sql stable security definer set search_path = '' as $$
  select s.id, s.owner_id, s.kind, s.container_id, r.data->>'name', m.role, m.status,
    (select count(*)::int from public.share_members x where x.share_id = s.id and x.status = 'active')
  from public.share_members m
  join public.shares s on s.id = m.share_id
  left join public.sync_rows r on r.owner_id = s.owner_id and r.tbl = s.kind || 's' and r.id = s.container_id
  where m.account_id = public.me();
$$;

/* A share's members with their profiles (for members of that share only). */
create function public.share_people(p_share uuid)
returns table (account_id uuid, handle text, display_name text, avatar text, role text, status text, joined_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.account_id, p.handle::text, p.display_name, p.avatar, m.role, m.status, m.joined_at
  from public.share_members m left join public.profiles p on p.id = m.account_id
  where m.share_id = p_share
    and exists (select 1 from public.share_members x where x.share_id = p_share and x.account_id = public.me())
  order by public.role_rank(m.role) desc, m.joined_at;
$$;

/* Who gains access if a task or list moves to a list or folder: for the confirmation (D135). */
create function public.audience(p_kind text, p_id text)
returns table (account_id uuid, handle text, display_name text)
language sql stable security definer set search_path = '' as $$
  select a, p.handle::text, p.display_name
  from unnest(public.container_members(public.container_owner(public.me(), p_kind, p_id), p_kind, p_id)) a
  left join public.profiles p on p.id = a
  where a <> public.me();
$$;

-- ---------- Share links ----------

create function public.create_share_invite(p_share uuid, p_role text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.me();
  c text := public.new_code();
begin
  if (public.share_of(p_share)).owner_id is distinct from me then raise exception 'owner_only' using errcode = '42501'; end if;
  if p_role not in ('editor', 'viewer') then raise exception 'bad_role' using errcode = '22023'; end if;
  if (select count(*) from public.invites where creator = me and created_at > now() - interval '1 day') >= 50 then
    raise exception 'too_many_invites' using errcode = '23514';
  end if;
  insert into public.invites (code, creator, share_id, role, expires_at) values (c, me, p_share, p_role, now() + interval '7 days');
  return c;
end $$;

/* What a link offers, before accepting it. */
create function public.invite_info(p_code text)
returns table (kind text, creator uuid, handle text, display_name text, avatar text, share_name text, role text, expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select case when i.share_id is null then 'friend' else 'share' end, i.creator, p.handle::text, p.display_name, p.avatar,
    r.data->>'name', i.role, i.expires_at
  from public.invites i
  left join public.profiles p on p.id = i.creator
  left join public.shares s on s.id = i.share_id
  left join public.sync_rows r on r.owner_id = s.owner_id and r.tbl = s.kind || 's' and r.id = s.container_id
  where i.code = p_code and i.revoked_at is null and i.expires_at > now() and not public.is_blocked(i.creator, public.me());
$$;

/* Opens a link: makes you a friend of its creator, or a member of its share. */
create function public.redeem_invite(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.me();
  i public.invites;
begin
  select * into i from public.invites where code = p_code and revoked_at is null and expires_at > now();
  if i.code is null or public.is_blocked(i.creator, me) then
    raise exception 'invite_invalid' using errcode = 'P0002';
  end if;
  if i.share_id is null then
    if i.creator <> me then perform public.befriend(me, i.creator); end if;
    return jsonb_build_object('kind', 'friend', 'account', i.creator);
  end if;
  if not exists (select 1 from public.share_members where share_id = i.share_id and account_id = me and status = 'active') then
    perform public.add_member(i.share_id, me, i.role, 'active');
  end if;
  return jsonb_build_object('kind', 'share', 'share_id', i.share_id);
end $$;

-- ---------- Account deletion: ownership passes on (D136) ----------

/* Before an owner's account goes, each of their shares passes to its longest-standing editor. */
create function public.pass_on_shares(p_account uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.shares;
  heir uuid;
begin
  for s in select * from public.shares x where x.owner_id = p_account
    and not exists (select 1 from public.shares y where y.owner_id = p_account and y.id <> x.id and y.kind = 'folder'
                    and y.container_id in (select public.folder_chain(p_account, case x.kind when 'list' then public.list_folder(p_account, x.container_id) else (select r.data->>'parent_id' from public.sync_rows r where r.owner_id = p_account and r.tbl = 'folders' and r.id = x.container_id) end)))
  loop
    select m.account_id into heir from public.share_members m
    where m.share_id = s.id and m.role = 'editor' and m.status = 'active' order by m.joined_at limit 1;
    if heir is not null then
      perform public.transfer_share_as(s.id, heir, p_account);
    end if;
  end loop;
end $$;

create or replace function public.purge_deleted() returns void
language plpgsql security definer set search_path = '' as $$
declare
  gone uuid;
begin
  for gone in select d.owner_id from public.account_deletions d where d.requested_at < now() - interval '7 days' loop
    perform public.pass_on_shares(gone);
    delete from auth.users where id = gone;
  end loop;
  update public.sync_rows set data = jsonb_build_object('deleted_at', data->'deleted_at')
  where data->>'deleted_at' ~ '^\d{4}-\d\d-\d\dT'
    and (data->>'deleted_at')::timestamptz < now() - interval '30 days'
    and data <> jsonb_build_object('deleted_at', data->'deleted_at');
end $$;

-- ---------- Attachments (D156, D157) ----------

-- Private bucket: images only, 10 MB each, paths `share/<share_id>/<list_id>/<file>`.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 10485760, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

create function public.attachment_access(p_name text, p_min text) returns boolean
language sql stable security definer set search_path = '' as $$
  select (storage.foldername(p_name))[1] = 'share'
    and exists (select 1 from public.shares s where s.id::text = (storage.foldername(p_name))[2]
                and public.can_access(s.owner_id, (storage.foldername(p_name))[3], p_min));
$$;

/* Bytes an account has uploaded, against plan_limits (D137). */
create function public.storage_used() returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum((o.metadata->>'size')::bigint), 0) from storage.objects o where o.bucket_id = 'attachments' and o.owner_id = auth.uid()::text;
$$;

create policy attachments_read on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and public.attachment_access(name, 'viewer'));
create policy attachments_write on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and public.attachment_access(name, 'editor')
              and public.storage_used() < (public.plan_limits((select auth.uid()))->>'storage_bytes')::bigint);
create policy attachments_delete on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and public.attachment_access(name, 'editor'));

-- ---------- Grants ----------

alter table public.shares enable row level security;
alter table public.share_members enable row level security;
alter table public.task_personal enable row level security;
alter table public.container_placement enable row level security;
alter table public.sync_gone enable row level security;
revoke all on public.shares, public.share_members, public.task_personal, public.container_placement, public.sync_gone from anon, authenticated;

-- Membership is readable by the share's own members; everything else goes through the functions.
grant select on public.shares, public.share_members to authenticated;
create function public.in_share(p_share uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.share_members m where m.share_id = p_share and m.account_id = auth.uid());
$$;
create policy shares_members on public.shares for select to authenticated
  using (public.in_share(id));
create policy share_members_members on public.share_members for select to authenticated using (public.in_share(share_id));

-- Every function above is private unless granted here.
do $$
declare fn regprocedure;
begin
  for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('role_rank', 'folder_chain', 'list_folder', 'covering_shares', 'container_role',
      'list_role', 'container_members', 'is_shared', 'can_access', 'row_list', 'row_role', 'personal_keys', 'personal_defaults',
      'pick', 'save_personal', 'view_row', 'scope_snapshot', 'apply_scope_change', 'reown_scope', 'ping', 'container_owner',
      'push_shared', 'share_of', 'settle_share', 'create_share', 'tree_people', 'add_member', 'invite_to_share',
      'set_member_role', 'respond_share', 'remove_member', 'delete_share', 'transfer_share', 'my_shares', 'share_people',
      'audience', 'create_share_invite', 'transfer_share_as', 'invite_info', 'redeem_invite', 'pass_on_shares', 'attachment_access',
      'storage_used', 'in_share')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
  end loop;
end $$;
grant execute on function public.can_access(uuid, text, text), public.attachment_access(text, text), public.in_share(uuid),
  public.storage_used(), public.create_share(text, text), public.invite_to_share(uuid, uuid, text),
  public.set_member_role(uuid, uuid, text), public.respond_share(uuid, boolean), public.remove_member(uuid, uuid),
  public.delete_share(uuid), public.my_shares(), public.share_people(uuid), public.audience(text, text),
  public.create_share_invite(uuid, text), public.invite_info(text), public.redeem_invite(text) to authenticated;
grant execute on function public.transfer_share(uuid, uuid) to authenticated;
grant execute on function public.purge_deleted() to service_role;
