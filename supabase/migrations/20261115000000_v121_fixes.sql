-- v1.2.1 server fixes (docs/specs/v1.2.1-fixes.md, G3; PLAN D288, D289).
--
-- RULE (D289): every migration from this one on bumps `server_meta.schema_version` by one, as its
-- last statement. The apps compare it with the version they need, and show "needs a server
-- update" for sharing and connections when the server is behind. This migration sets it to 1.

-- ---------- Server version (D289) ----------

alter table public.server_meta add column schema_version int not null default 0;

-- ---------- C2 and shared writes: push_shared ----------

/*
 * As in 20261114020000_shares.sql, plus one rule (C2): a patch that finds no record of yours or
 * shared with you is a create, and a create into another namespace that already holds this id
 * would merge into a record you can't see. It's refused whether or not the patch carries `id`.
 */
create or replace function public.push_shared(me uuid, p_tbl text, p_id text, p_fields jsonb) returns uuid[]
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

  -- An edit (not a create, which carries every column including `id`) to a record that exists
  -- only where you can't see it: you lost access before your device heard. Refused, so the
  -- device gets the tombstone, instead of a stray copy in your namespace.
  if cur is null and not f ? 'id' and exists (select 1 from public.sync_rows r where r.tbl = p_tbl and r.id = p_id and r.owner_id <> me) then
    raise exception 'no_access' using errcode = '42501';
  end if;

  -- task_activity: lives with its task; viewers' activity is dropped (they can't edit).
  if p_tbl = 'task_activity' then
    o := coalesce(cur_owner, (select r.owner_id from public.sync_rows r where r.tbl = 'tasks' and r.id = new_parent
      and (r.owner_id = me or public.row_role(r.owner_id, 'tasks', r.id, r.data, me) is not null)
      order by r.owner_id = me desc limit 1), me);
    if cur is null and o <> me and exists (select 1 from public.sync_rows r where r.owner_id = o and r.tbl = p_tbl and r.id = p_id) then
      raise exception 'no_access' using errcode = '42501';
    end if;
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
      if o is null and exists (select 1 from public.sync_rows r where r.tbl = case when p_tbl in ('lists', 'folders') then 'folders' else 'lists' end
                               and r.id = new_parent and r.owner_id <> me) then
        -- A list or folder you can't see (you lost access before your device heard).
        raise exception 'no_access' using errcode = '42501';
      end if;
      if o is null then
        o := coalesce(cur_owner, me); -- an unknown parent: the client's problem, as before sharing
      end if;
    end if;
  end if;

  -- C2: a create can't land on an id another namespace already holds.
  if cur is null and o <> me and exists (select 1 from public.sync_rows r where r.owner_id = o and r.tbl = p_tbl and r.id = p_id) then
    raise exception 'no_access' using errcode = '42501';
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

-- ---------- Server-side writes go through push_shared, under sync_push's locks ----------

/* Bot commands (D305). Tasks and activity take the shared-write path: role checks, personal layer, creator stamps. */
create or replace function public.server_write(p_account uuid, p_tbl text, p_id text, p_fields jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  f jsonb := p_fields;
  cur jsonb;
begin
  if p_tbl not in ('tasks', 'tags', 'habit_checkins', 'task_activity') then
    raise exception 'bad_table' using errcode = '22023';
  end if;
  -- The same two locks, in the same order, as sync_push.
  perform pg_advisory_xact_lock(hashtextextended(p_account::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('shares', 0));
  if p_tbl in ('tasks', 'task_activity') then
    perform public.ping(public.push_shared(p_account, p_tbl, p_id, f));
  else
    if f ? '_delta' then
      select r.data into cur from public.sync_rows r where r.owner_id = p_account and r.tbl = p_tbl and r.id = p_id;
      f := (f - '_delta') || jsonb_build_object('value',
        (case when cur is null or cur->>'deleted_at' is not null then 0 else coalesce((cur->>'value')::numeric, 0) end)
        + (f->>'_delta')::numeric);
    end if;
    insert into public.sync_rows as r (owner_id, tbl, id, data, version)
    values (p_account, p_tbl, p_id, f, nextval('public.sync_version'))
    on conflict (owner_id, tbl, id) do update set data = r.data || excluded.data, version = excluded.version, updated_at = now();
  end if;
  perform public.ping_all(p_account);
end $$;

/* As in 20261114030000_social.sql, but each row goes through push_shared under sync_push's locks. */
create or replace function public.insert_inbox_task(p_account uuid, p_fields jsonb, p_list text default 'inbox') returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_id text := gen_random_uuid()::text;
  at text := public.iso_now();
  base jsonb := jsonb_build_object(
    'list_id', p_list, 'parent_id', null, 'section_id', null, 'status', 'open', 'priority', 0,
    'due_date', null, 'start_at', null, 'end_at', null, 'rrule', null, 'exdates', '[]', 'recurrence_parent_id', null,
    'tags', '[]', 'checklist', '[]', 'reminders', '[]', 'description', '', 'pinned', 0,
    'sort_order', -extract(epoch from now()), 'created_at', at, 'updated_at', at, 'completed_at', null, 'deleted_at', null);
  allowed text[] := array['title', 'description', 'priority', 'due_date', 'start_at', 'end_at', 'rrule', 'checklist',
    'deadline', 'duration_min', 'someday'];
  sub jsonb;
  sub_id text;
  n int := 0;
  touched uuid[] := '{}';
begin
  if coalesce(trim(p_fields->>'title'), '') = '' or char_length(p_fields->>'title') > 500 then
    raise exception 'bad_title' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_account::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('shares', 0));
  touched := public.push_shared(p_account, 'tasks', v_id, base || public.pick(p_fields, allowed) || jsonb_build_object('id', v_id));
  for sub in select value from jsonb_array_elements(coalesce(p_fields->'subtasks', '[]')) loop
    n := n + 1;
    exit when n > 50;
    continue when coalesce(trim(sub->>'title'), '') = '';
    sub_id := gen_random_uuid()::text;
    touched := touched || public.push_shared(p_account, 'tasks', sub_id, base || public.pick(sub, array['title', 'description', 'checklist'])
      || jsonb_build_object('id', sub_id, 'parent_id', v_id, 'sort_order', n));
  end loop;
  perform public.ping(array(select distinct unnest(touched)));
  perform public.ping_all(p_account);
  return v_id;
end $$;

-- ---------- Membership ----------

/* Changes a member's role; an invitation stays an invitation until they accept it. */
create or replace function public.set_member_role(p_share uuid, p_account uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_status text;
begin
  if (public.share_of(p_share)).owner_id is distinct from public.me() then raise exception 'owner_only' using errcode = '42501'; end if;
  select m.status into v_status from public.share_members m where m.share_id = p_share and m.account_id = p_account;
  if v_status is null then
    raise exception 'no_such_member' using errcode = 'P0002';
  end if;
  perform public.add_member(p_share, p_account, p_role, v_status);
end $$;

/*
 * As in 20261114020000_shares.sql, and the old owner's share links (for this share and every
 * share nested in it) are revoked: they were the old owner's to give.
 */
create or replace function public.transfer_share_as(p_share uuid, p_to uuid, me uuid) returns void
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
    update public.invites set revoked_at = now() where share_id = inner_share and creator = me and revoked_at is null;
  end loop;
  perform public.reown_scope(me, p_to, snap);
  update public.sync_rows r set data = jsonb_set(r.data, array[case s.kind when 'list' then 'folder_id' else 'parent_id' end], 'null')
  where r.owner_id = p_to and r.tbl = s.kind || 's' and r.id = s.container_id;
  before := jsonb_set(before, '{owner}', to_jsonb(me));
  perform public.ping(public.apply_scope_change(before, public.scope_snapshot(p_to, s.kind, s.container_id)));
end $$;

-- ---------- Account deletion ----------

/*
 * Before an owner's account goes, each share passes to its longest-standing editor, outermost
 * first (passing a folder passes the shares inside it). A nested share whose folder found no heir
 * is passed on its own. Shares nobody inherits end like delete_share: every member gets
 * tombstones now, because the records themselves are about to cascade away unseen.
 */
create or replace function public.pass_on_shares(p_account uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.shares;
  heir uuid;
  before jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('shares', 0));
  for s in select x.* from public.shares x where x.owner_id = p_account
    order by (select count(*) from public.folder_chain(p_account, case x.kind
      when 'list' then public.list_folder(p_account, x.container_id)
      else (select r.data->>'parent_id' from public.sync_rows r where r.owner_id = p_account and r.tbl = 'folders' and r.id = x.container_id) end))
  loop
    continue when (select x.owner_id from public.shares x where x.id = s.id) is distinct from p_account; -- passed on with its folder
    select m.account_id into heir from public.share_members m
    where m.share_id = s.id and m.role = 'editor' and m.status = 'active' order by m.joined_at limit 1;
    if heir is not null then
      perform public.transfer_share_as(s.id, heir, p_account);
    end if;
  end loop;
  for s in select x.* from public.shares x where x.owner_id = p_account loop
    before := public.scope_snapshot(s.owner_id, s.kind, s.container_id);
    delete from public.shares where id = s.id;
    perform public.ping(public.apply_scope_change(before, public.scope_snapshot(s.owner_id, s.kind, s.container_id)));
  end loop;
end $$;

/* A stored instant, or null when it doesn't parse. */
create function public.try_instant(p text) returns timestamptz
language plpgsql stable set search_path = '' as $$
begin
  return p::timestamptz;
exception when others then
  return null;
end $$;

/*
 * As before, but a tombstone keeps the ids access checks walk (list, folder, parent, task), so it
 * still reaches share members, and a malformed `deleted_at` is skipped instead of failing the run.
 */
create or replace function public.purge_deleted() returns void
language plpgsql security definer set search_path = '' as $$
declare
  gone uuid;
  keep text[] := array['deleted_at', 'list_id', 'folder_id', 'parent_id', 'task_id'];
begin
  for gone in select d.owner_id from public.account_deletions d where d.requested_at < now() - interval '7 days' loop
    perform public.pass_on_shares(gone);
    delete from auth.users where id = gone;
  end loop;
  -- ponytail: a full scan of sync_rows once a day; index deleted records if it gets slow.
  update public.sync_rows set data = public.pick(data, keep)
  where data->>'deleted_at' ~ '^\d{4}-\d\d-\d\dT'
    and public.try_instant(data->>'deleted_at') < now() - interval '30 days'
    and data <> public.pick(data, keep);
end $$;

-- ---------- Connection permissions (D288) ----------

-- 'add': add tasks only. 'full': every command. Chats start full, the webhook add-only.
alter table public.chat_links add column permission text not null default 'full' check (permission in ('add', 'full'));
alter table public.webhooks
  add column permission text not null default 'add' check (permission in ('add', 'full')),
  -- The webhook's last numbered listing (chats keep theirs in chat_listings).
  add column listing    jsonb check (listing is null or jsonb_typeof(listing) = 'array'),
  add column listing_at timestamptz;

/* Re-linking a chat to another account starts it at full again. */
create or replace function public.link_chat(p_code text, p_source text, p_external text, p_label text, p_reply jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  acct uuid;
begin
  delete from public.link_codes where code = p_code and expires_at > now() returning account_id into acct;
  if acct is null then raise exception 'bad_code' using errcode = 'P0002'; end if;
  insert into public.chat_links (account_id, source, external_id, label, reply) values (acct, p_source, p_external, p_label, p_reply)
  on conflict (source, external_id) do update set account_id = excluded.account_id, label = excluded.label,
    reply = excluded.reply, digest_time = null, digest_sent = null, permission = 'full';
  return acct;
end $$;

drop function public.my_connections();
create function public.my_connections()
returns table (id uuid, source text, label text, digest_time time, created_at timestamptz, permission text)
language sql stable security definer set search_path = '' as $$
  select l.id, l.source, l.label, l.digest_time, l.created_at, l.permission from public.chat_links l
  where l.account_id = public.me() order by l.created_at;
$$;

/* An add-only chat reads nothing, so its Digest stops too. */
create function public.set_connection_permission(p_id uuid, p_permission text) returns void
language sql security definer set search_path = '' as $$
  update public.chat_links set permission = p_permission,
    digest_time = case when p_permission = 'add' then null else digest_time end
  where id = p_id and account_id = public.me();
$$;

/* The webhook's permission, or null when there's no webhook. */
create function public.webhook_permission() returns text
language sql stable security definer set search_path = '' as $$
  select w.permission from public.webhooks w where w.account_id = public.me();
$$;

create function public.set_webhook_permission(p_permission text) returns void
language sql security definer set search_path = '' as $$
  update public.webhooks set permission = p_permission where account_id = public.me();
$$;

-- ---------- Grants ----------

do $$
declare fn regprocedure;
begin
  for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('try_instant', 'my_connections', 'set_connection_permission',
      'webhook_permission', 'set_webhook_permission')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
  end loop;
end $$;
grant execute on function public.my_connections(), public.set_connection_permission(uuid, text),
  public.webhook_permission(), public.set_webhook_permission(text) to authenticated;

update public.server_meta set schema_version = 1;
