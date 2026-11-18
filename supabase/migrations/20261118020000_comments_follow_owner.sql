-- Comments follow their task to a new namespace (transfer_share, pass_on_shares, a task or container moving owner).
-- task_comments.owner_id is the task's namespace, but reown_scope and push_shared's task move never re-owned it,
-- so the comments went unreadable and purge_comments then deleted them.
-- No repair of comments already orphaned: matching them to a task by id alone is not deterministic (ids are
-- client-chosen, so another account could hold the same id), and the nightly purge has already removed most.

/* The v1.1 body (20261114020000_shares.sql), plus the task_comments re-own. */
create or replace function public.reown_scope(p_from uuid, p_to uuid, p_snapshot jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  lists text[] := array(select jsonb_object_keys(p_snapshot->'lists'));
  folders text[] := array(select jsonb_object_keys(p_snapshot->'folders'));
begin
  if p_from = p_to then return; end if;
  update public.sync_rows r set owner_id = p_to
  where r.owner_id = p_from and r.tbl = 'task_activity' and r.data->>'task_id' in (
    select t.id from public.sync_rows t where t.owner_id = p_from and t.tbl = 'tasks' and t.list_id = any(lists));
  update public.task_comments c set owner_id = p_to
  where c.owner_id = p_from and c.task_id in (
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

/* The v1.2.4 body (20261116040000_social_links_blocks.sql), plus: a task moving namespace takes its comments. */
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
    -- SOC-15: editing an existing row needs editor where it lives now, not only where the patch says it goes.
    if cur is not null and public.role_rank(public.row_role(cur_owner, 'task_activity', p_id, cur, me)) < 2 then
      return '{}';
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
    -- SOC-09: values the apps' CHECK constraints refuse would make the task unsyncable on every device.
    if (f ? 'priority' and (jsonb_typeof(f->'priority') <> 'number' or f->>'priority' not in ('0', '1', '2', '3')))
       or (f ? 'status' and (jsonb_typeof(f->'status') <> 'string' or f->>'status' not in ('open', 'done', 'wont_do'))) then
      raise exception 'bad_value' using errcode = '22023';
    end if;
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
    update public.task_comments c set owner_id = o where c.owner_id = cur_owner and c.task_id = p_id;
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


update public.server_meta set schema_version = 14;
