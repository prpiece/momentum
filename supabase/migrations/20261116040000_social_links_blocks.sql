-- v1.2.4 social findings, second pass (SOC-03, 04, 05, 06, 07, 09, 10, 11, 12, 13, 15, 19, 20). Bumps schema_version to 8.

-- ---------- SOC-04 / SOC-05: link limits, and a removed member can't rejoin on an old link ----------

alter table public.invites
  add column max_uses int check (max_uses is null or max_uses > 0),
  add column uses     int not null default 0;

/* Who an owner removed from a share, and when: a link made before then no longer admits them. */
create table public.share_removed (
  share_id   uuid not null references public.shares on delete cascade,
  account_id uuid not null references auth.users on delete cascade,
  at         timestamptz not null default now(),
  primary key (share_id, account_id)
);
alter table public.share_removed enable row level security;
revoke all on public.share_removed from anon, authenticated;

drop function public.create_friend_invite();
/* Friend links last 14 days; `p_max_uses` null means unlimited. At most 50 links a day. */
create function public.create_friend_invite(p_max_uses int default null) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.me();
  c text := public.new_code();
begin
  if (select count(*) from public.invites where creator = me and created_at > now() - interval '1 day') >= 50 then
    raise exception 'too_many_invites' using errcode = '23514';
  end if;
  insert into public.invites (code, creator, expires_at, max_uses) values (c, me, now() + interval '14 days', p_max_uses);
  return c;
end $$;

drop function public.create_share_invite(uuid, text);
/* Share links last 14 days and work once unless `p_max_uses` says otherwise (null: unlimited). */
create function public.create_share_invite(p_share uuid, p_role text, p_max_uses int default 1) returns text
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
  insert into public.invites (code, creator, share_id, role, expires_at, max_uses)
  values (c, me, p_share, p_role, now() + interval '14 days', p_max_uses);
  return c;
end $$;

/* Your live links (not revoked, expired or used up), for the Links list. */
create function public.my_invites()
returns table (code text, kind text, share_id uuid, share_name text, role text, max_uses int, uses int, expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select i.code, case when i.share_id is null then 'friend' else 'share' end, i.share_id, r.data->>'name', i.role,
    i.max_uses, i.uses, i.expires_at
  from public.invites i
  left join public.shares s on s.id = i.share_id
  left join public.sync_rows r on r.owner_id = s.owner_id and r.tbl = s.kind || 's' and r.id = s.container_id
  where i.creator = public.me() and i.revoked_at is null and i.expires_at > now() and (i.max_uses is null or i.uses < i.max_uses)
  order by i.created_at desc;
$$;

/* A used-up link no longer shows in invite_info either. */
create or replace function public.invite_info(p_code text)
returns table (kind text, creator uuid, handle text, display_name text, avatar text, share_name text, role text, expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select case when i.share_id is null then 'friend' else 'share' end, i.creator, p.handle::text, p.display_name, p.avatar,
    r.data->>'name', i.role, i.expires_at
  from public.invites i
  left join public.profiles p on p.id = i.creator
  left join public.shares s on s.id = i.share_id
  left join public.sync_rows r on r.owner_id = s.owner_id and r.tbl = s.kind || 's' and r.id = s.container_id
  where i.code = p_code and i.revoked_at is null and i.expires_at > now() and (i.max_uses is null or i.uses < i.max_uses)
    and not public.is_blocked(i.creator, public.me());
$$;

create or replace function public.redeem_invite(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.me();
  i public.invites;
begin
  select * into i from public.invites
  where code = p_code and revoked_at is null and expires_at > now() and (max_uses is null or uses < max_uses) for update;
  if i.code is null or public.is_blocked(i.creator, me) then
    raise exception 'invite_invalid' using errcode = 'P0002';
  end if;
  if i.share_id is null then
    if i.creator <> me then
      perform public.befriend(me, i.creator);
      update public.invites set uses = uses + 1 where code = i.code;
    end if;
    return jsonb_build_object('kind', 'friend', 'account', i.creator);
  end if;
  if exists (select 1 from public.share_removed r where r.share_id = i.share_id and r.account_id = me and r.at >= i.created_at) then
    raise exception 'invite_invalid' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.share_members where share_id = i.share_id and account_id = me and status = 'active') then
    perform public.add_member(i.share_id, me, i.role, 'active');
    update public.invites set uses = uses + 1 where code = i.code;
  end if;
  return jsonb_build_object('kind', 'share', 'share_id', i.share_id);
end $$;

/* As before, and an owner's removal is remembered (SOC-04). */
create or replace function public.remove_member(p_share uuid, p_account uuid) returns void
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
  if me <> p_account then
    insert into public.share_removed (share_id, account_id) values (p_share, p_account)
    on conflict (share_id, account_id) do update set at = now();
  end if;
  perform public.settle_share(p_share, before);
end $$;

-- ---------- SOC-03: blocking removes each side from the other's shares ----------

create or replace function public.block_account(p_account uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.me();
  m record;
begin
  if p_account = me then raise exception 'bad_account' using errcode = '22023'; end if;
  perform public.remove_friend(p_account);
  insert into public.blocks (blocker, blocked) values (me, p_account) on conflict do nothing;
  -- Their access to your shares, and yours to theirs (pending invitations included).
  for m in select x.share_id, x.account_id from public.share_members x join public.shares s on s.id = x.share_id
           where (s.owner_id = me and x.account_id = p_account) or (s.owner_id = p_account and x.account_id = me) loop
    perform public.remove_member(m.share_id, m.account_id);
  end loop;
end $$;

/* The accounts you blocked (for the Blocked list and Unblock). */
create function public.my_blocks()
returns table (id uuid, handle text, display_name text, avatar text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.handle::text, p.display_name, p.avatar
  from public.blocks b join public.profiles p on p.id = b.blocked
  where b.blocker = public.me() order by p.handle;
$$;

-- ---------- SOC-06 / SOC-07: 8-digit link codes, new chats add-only ----------

delete from public.link_codes;
alter table public.link_codes drop constraint link_codes_code_check;
alter table public.link_codes add constraint link_codes_code_check check (code ~ '^\d{8}$');
alter table public.chat_links alter column permission set default 'add';

create or replace function public.create_link_code() returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.me();
  c text;
begin
  delete from public.link_codes where account_id = me or expires_at < now();
  loop
    select lpad(((get_byte(b, 0)::bigint * 16777216 + get_byte(b, 1) * 65536 + get_byte(b, 2) * 256 + get_byte(b, 3)) % 100000000)::text, 8, '0') into c
    from extensions.gen_random_bytes(4) as b;
    begin
      insert into public.link_codes (code, account_id, expires_at) values (c, me, now() + interval '10 minutes');
      return c;
    exception when unique_violation then
      -- another account holds this code right now: draw again
    end;
  end loop;
end $$;

/* A newly linked chat can only add tasks until the user raises it in Settings → Connections. */
create or replace function public.link_chat(p_code text, p_source text, p_external text, p_label text, p_reply jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  acct uuid;
begin
  if not public.hit_rate('link:all', 120, interval '1 minute') then raise exception 'bad_code' using errcode = 'P0002'; end if;
  delete from public.link_codes where code = p_code and expires_at > now() returning account_id into acct;
  if acct is null then raise exception 'bad_code' using errcode = 'P0002'; end if;
  insert into public.chat_links (account_id, source, external_id, label, reply) values (acct, p_source, p_external, p_label, p_reply)
  on conflict (source, external_id) do update set account_id = excluded.account_id, label = excluded.label,
    reply = excluded.reply, digest_time = null, digest_sent = null, permission = 'add';
  return acct;
end $$;

-- ---------- SOC-12: who can send you friend requests, lookup limits, inbound caps ----------

alter table public.profiles add column allow_requests text not null default 'everyone' check (allow_requests in ('everyone', 'none'));

/* Returns 'pending', 'accepted' (they had asked you), 'friends', or 'no_such_account' (no one with that
   handle, blocked, or not taking requests: all look the same). A miss is a return value, not an error,
   so the attempt counts toward the hourly limit. */
create or replace function public.request_friend(p_handle text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.me();
  them uuid;
  f public.friendships;
begin
  if not public.hit_rate('req:' || me, 60, interval '1 hour') then raise exception 'too_many_requests' using errcode = '23514'; end if;
  select p.id into them from public.profiles p where p.handle = p_handle::extensions.citext;
  if them is null or them = me or public.is_blocked(me, them) then return 'no_such_account'; end if;
  select * into f from public.friendships where a = least(me, them) and b = greatest(me, them);
  if f.status = 'accepted' then return 'friends'; end if;
  if f.status = 'pending' and f.requested_by = them then
    perform public.befriend(me, them);
    return 'accepted';
  end if;
  if f.status = 'pending' then return 'pending'; end if;
  if (select p.allow_requests from public.profiles p where p.id = them) <> 'everyone'
     or (select count(*) from public.friendships x where (x.a = them or x.b = them) and x.status = 'pending' and x.requested_by <> them) >= 100 then
    return 'no_such_account';
  end if;
  if exists (select 1 from public.friend_declines d where d.from_id = me and d.to_id = them and d.at > now() - interval '7 days') then
    raise exception 'declined_recently' using errcode = '23514';
  end if;
  delete from public.friend_request_log where account_id = me and at < now() - interval '1 day';
  if (select count(*) from public.friend_request_log where account_id = me) >= 20 then
    raise exception 'too_many_requests' using errcode = '23514';
  end if;
  if public.friend_count(me) >= 200 then
    raise exception 'too_many_friends' using errcode = '23514';
  end if;
  insert into public.friend_request_log (account_id) values (me);
  insert into public.friendships (a, b, requested_by) values (least(me, them), greatest(me, them), me);
  return 'pending';
end $$;

create or replace function public.find_profile(p_handle text)
returns table (id uuid, handle text, display_name text, avatar text)
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.hit_rate('find:' || public.me(), 60, interval '1 hour') then raise exception 'too_many_requests' using errcode = '23514'; end if;
  return query select p.id, p.handle::text, p.display_name, p.avatar from public.profiles p
    where p.handle = p_handle::extensions.citext and p.id <> public.me() and not public.is_blocked(p.id, public.me())
      and p.allow_requests = 'everyone';
end $$;

/* As in 20261116010000, plus a ceiling of 200 unanswered tasks per recipient. */
create or replace function public.send_task(p_sender uuid, p_recipient uuid, p_payload jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  sid uuid;
  v jsonb;
begin
  if not public.is_friend(p_sender, p_recipient) then
    raise exception 'not_friends' using errcode = '42501';
  end if;
  if (select count(*) from public.sent_tasks where sender = p_sender and created_at > now() - interval '1 day') >= 100
     or (select count(*) from public.sent_tasks where recipient = p_recipient and status = 'pending') >= 200 then
    raise exception 'too_many_sent' using errcode = '23514';
  end if;
  if jsonb_typeof(p_payload->'title') <> 'string' or trim(p_payload->>'title') = '' or char_length(p_payload->>'title') > 500 then
    raise exception 'bad_title' using errcode = '22023';
  end if;
  v := public.pick(p_payload, array['title', 'description', 'checklist', 'subtasks', 'priority', 'due_date']);
  if jsonb_typeof(v->'description') is distinct from 'string' then v := v - 'description'; end if;
  if jsonb_typeof(v->'due_date') is distinct from 'string' then v := v - 'due_date'; end if;
  if jsonb_typeof(v->'checklist') is distinct from 'array' then v := v - 'checklist'; end if;
  if jsonb_typeof(v->'subtasks') is distinct from 'array' then v := v - 'subtasks'; end if;
  if jsonb_typeof(v->'priority') is distinct from 'number' or (v->>'priority') not in ('0', '1', '2', '3') then v := v - 'priority'; end if;
  insert into public.sent_tasks (sender, recipient, payload) values (p_sender, p_recipient, v) returning id into sid;
  return sid;
end $$;

-- ---------- SOC-13 (share list part): invited members are listed to the owner and themselves only ----------

create or replace function public.share_people(p_share uuid)
returns table (account_id uuid, handle text, display_name text, avatar text, role text, status text, joined_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.account_id, p.handle::text, p.display_name, p.avatar, m.role, m.status, m.joined_at
  from public.share_members m left join public.profiles p on p.id = m.account_id
  where m.share_id = p_share
    and exists (select 1 from public.share_members x where x.share_id = p_share and x.account_id = public.me())
    and (m.status = 'active' or m.account_id = public.me() or (select s.owner_id from public.shares s where s.id = p_share) = public.me())
  order by public.role_rank(m.role) desc, m.joined_at;
$$;

-- ---------- SOC-19, SOC-20: buddies can leave, share invitations are limited ----------

/* A buddy stops being one (the owner isn't told). */
create function public.buddy_decline(p_owner uuid, p_habit text) returns void
language sql security definer set search_path = '' as $$
  delete from public.habit_buddies where owner_id = p_owner and habit_id = p_habit and buddy_id = public.me();
$$;

/* As before, at most 50 invitations a day, 5 a day to the same friend, and 50 waiting on one recipient. */
create or replace function public.invite_to_share(p_share uuid, p_friend uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.me();
begin
  if (public.share_of(p_share)).owner_id is distinct from me then raise exception 'owner_only' using errcode = '42501'; end if;
  if not public.is_friend(me, p_friend) then raise exception 'not_friends' using errcode = '42501'; end if;
  if not public.hit_rate('shinv:' || me, 50, interval '1 day') or not public.hit_rate('shinv:' || me || ':' || p_friend, 5, interval '1 day')
     or (select count(*) from public.share_members x where x.account_id = p_friend and x.status = 'invited') >= 50 then
    raise exception 'too_many_invites' using errcode = '23514';
  end if;
  perform public.add_member(p_share, p_friend, p_role, 'invited');
end $$;

-- ---------- SOC-10: the report form and its screenshot bucket ----------

/* Report rows: 300 an hour for everyone, 20 a day for a signed-in account. */
create function public.reports_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not public.hit_rate('report:all', 300, interval '1 hour')
     or (auth.uid() is not null and not public.hit_rate('report:' || auth.uid(), 20, interval '1 day')) then
    raise exception 'too_many_reports' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger reports_limit before insert on public.reports for each row execute function public.reports_limit();

/* Screenshot uploads: 120 an hour across everyone, so the free tier's 1 GB can't be filled in minutes. */
create function public.report_upload_ok() returns boolean
language sql security definer set search_path = '' as $$
  select public.hit_rate('report:upload', 120, interval '1 hour');
$$;
revoke all on function public.report_upload_ok() from public;
grant execute on function public.report_upload_ok() to anon, authenticated;
drop policy reports_upload on storage.objects;
create policy reports_upload on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'reports' and public.report_upload_ok());

-- ---------- Grants ----------

do $$
declare fn regprocedure;
begin
  for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('create_friend_invite', 'create_share_invite', 'my_invites', 'my_blocks', 'buddy_decline',
      'reports_limit', 'request_friend', 'find_profile', 'invite_to_share', 'remove_member', 'block_account', 'redeem_invite', 'invite_info',
      'share_people', 'create_link_code', 'link_chat', 'send_task')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
  end loop;
end $$;
grant execute on function public.create_friend_invite(int), public.create_share_invite(uuid, text, int), public.my_invites(),
  public.my_blocks(), public.buddy_decline(uuid, text), public.request_friend(text), public.find_profile(text),
  public.invite_to_share(uuid, uuid, text), public.remove_member(uuid, uuid), public.block_account(uuid), public.redeem_invite(text),
  public.invite_info(text), public.share_people(uuid), public.create_link_code() to authenticated;
-- The inbound function (service role) calls these two.
grant execute on function public.link_chat(text, text, text, text, jsonb), public.send_task(uuid, uuid, jsonb) to service_role;

-- ---------- SOC-09 (rest) and SOC-15: push_shared ----------
-- The v1.2.1 body, plus: a task's `priority` and `status` must be values the apps accept, and an
-- activity row is only edited by an editor of where it lives now.

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

update public.server_meta set schema_version = 8;
