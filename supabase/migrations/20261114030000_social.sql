-- Working together with friends (v1.4, PLAN D260): sent tasks, Focus together, check-in buddies
-- and nudges. Each friend sees only what the glossary allows; nothing here is a score.

-- ---------- Inbox inserts (shared by sent tasks and the inbound function, ADR 0008) ----------

/* Wakes every device of an account so it pulls (Realtime on `devices`). */
create function public.ping_all(p_account uuid) returns void
language sql security definer set search_path = '' as $$
  update public.devices set last_seen = now() where owner_id = p_account;
$$;

create function public.iso_now() returns text
language sql stable set search_path = '' as $$
  select to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$$;

/*
 * Adds a task to an account's Inbox as a normal synced record, with optional subtasks
 * (`subtasks`: [{title, description?, checklist?}]). Only known fields are taken from `p_fields`.
 * Returns the new task's id.
 */
create function public.insert_inbox_task(p_account uuid, p_fields jsonb, p_list text default 'inbox') returns text
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
  n int := 0;
begin
  if coalesce(trim(p_fields->>'title'), '') = '' or char_length(p_fields->>'title') > 500 then
    raise exception 'bad_title' using errcode = '22023';
  end if;
  insert into public.sync_rows (owner_id, tbl, id, data, version)
  values (p_account, 'tasks', v_id, base || public.pick(p_fields, allowed) || jsonb_build_object('id', v_id, 'created_by', p_account),
          nextval('public.sync_version'));
  for sub in select value from jsonb_array_elements(coalesce(p_fields->'subtasks', '[]')) loop
    n := n + 1;
    exit when n > 50;
    continue when coalesce(trim(sub->>'title'), '') = '';
    insert into public.sync_rows (owner_id, tbl, id, data, version)
    select p_account, 'tasks', s.id, base || public.pick(sub, array['title', 'description', 'checklist'])
      || jsonb_build_object('id', s.id, 'parent_id', v_id, 'sort_order', n, 'created_by', p_account), nextval('public.sync_version')
    from (select gen_random_uuid()::text as id) s;
  end loop;
  perform public.ping_all(p_account);
  return v_id;
end $$;

-- ---------- Sent tasks ----------

/* A task a friend sent you. The sender only ever learns Accepted or Declined. */
create table public.sent_tasks (
  id           uuid primary key default gen_random_uuid(),
  sender       uuid not null references auth.users on delete cascade,
  recipient    uuid not null references auth.users on delete cascade,
  payload      jsonb not null check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 200000),
  status       text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  check (sender <> recipient)
);
create index sent_tasks_recipient on public.sent_tasks (recipient, status);
create index sent_tasks_sender on public.sent_tasks (sender, created_at);

/* Called by the inbound function once it has checked the sender (ADR 0008). 100 a day per sender. */
create function public.send_task(p_sender uuid, p_recipient uuid, p_payload jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  sid uuid;
begin
  if not public.is_friend(p_sender, p_recipient) then
    raise exception 'not_friends' using errcode = '42501';
  end if;
  if (select count(*) from public.sent_tasks where sender = p_sender and created_at > now() - interval '1 day') >= 100 then
    raise exception 'too_many_sent' using errcode = '23514';
  end if;
  if coalesce(trim(p_payload->>'title'), '') = '' then
    raise exception 'bad_title' using errcode = '22023';
  end if;
  insert into public.sent_tasks (sender, recipient, payload)
  values (p_sender, p_recipient, public.pick(p_payload, array['title', 'description', 'checklist', 'subtasks', 'priority', 'due_date']))
  returning id into sid;
  return sid;
end $$;

/* Accepting copies the task into your Inbox; the two copies aren't connected afterwards. */
create function public.respond_sent_task(p_id uuid, p_accept boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.me();
  t public.sent_tasks;
  task_id text;
begin
  select * into t from public.sent_tasks where id = p_id and recipient = me and status = 'pending' for update;
  if t.id is null then raise exception 'no_such_request' using errcode = 'P0002'; end if;
  if p_accept then
    task_id := public.insert_inbox_task(me, t.payload);
  end if;
  -- The copy is made: drop the content and keep only the outcome for the sender.
  update public.sent_tasks set status = case when p_accept then 'accepted' else 'declined' end,
    responded_at = now(), payload = jsonb_build_object('title', t.payload->>'title')
  where id = p_id;
  return task_id;
end $$;

/* Requests waiting for you, with who sent them. */
create function public.incoming_tasks()
returns table (id uuid, sender uuid, handle text, display_name text, payload jsonb, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select t.id, t.sender, p.handle::text, p.display_name, t.payload, t.created_at
  from public.sent_tasks t left join public.profiles p on p.id = t.sender
  where t.recipient = public.me() and t.status = 'pending' and not public.is_blocked(t.sender, t.recipient)
  order by t.created_at;
$$;

/* What you sent in the last 30 days: title, recipient and outcome only. */
create function public.outgoing_tasks()
returns table (id uuid, recipient uuid, handle text, title text, status text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select t.id, t.recipient, p.handle::text, t.payload->>'title', t.status, t.created_at
  from public.sent_tasks t left join public.profiles p on p.id = t.recipient
  where t.sender = public.me() and t.created_at > now() - interval '30 days'
  order by t.created_at desc;
$$;

-- ---------- Focus together ----------

/* Only that a session is running and when it ends; never what it's for. */
create table public.focus_status (
  account_id uuid primary key references auth.users on delete cascade,
  ends_at    timestamptz,
  updated_at timestamptz not null default now()
);

/* Starts (an end time) or stops (null) your published session. Published only with share_focus on. */
create function public.set_focus(p_ends_at timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.me();
begin
  if p_ends_at is not null and (p_ends_at < now() or p_ends_at > now() + interval '12 hours') then
    raise exception 'bad_end' using errcode = '22023';
  end if;
  if p_ends_at is not null and not coalesce((select share_focus from public.profiles where id = me), false) then
    return;
  end if;
  insert into public.focus_status as f (account_id, ends_at) values (me, p_ends_at)
  on conflict (account_id) do update set ends_at = excluded.ends_at, updated_at = now();
end $$;

create function public.focus_visible(p_account uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_account = auth.uid() or (public.is_friend(p_account, auth.uid())
    and coalesce((select p.share_focus from public.profiles p where p.id = p_account), false));
$$;

/* Turning the setting off takes a running session off the air at once. */
create function public.profiles_focus_off() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not new.share_focus and old.share_focus then
    update public.focus_status set ends_at = null, updated_at = now() where account_id = new.id;
  end if;
  return new;
end $$;
create trigger profiles_focus_off after update of share_focus on public.profiles for each row execute function public.profiles_focus_off();

-- ---------- Check-in buddies and nudges ----------

create table public.habit_buddies (
  owner_id   uuid not null references auth.users on delete cascade,
  habit_id   text not null check (char_length(habit_id) between 1 and 200),
  buddy_id   uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, habit_id, buddy_id),
  check (owner_id <> buddy_id)
);
create index habit_buddies_buddy on public.habit_buddies (buddy_id);

/* Habits whose nudges the owner turned off. */
create table public.habit_quiet (
  owner_id uuid not null references auth.users on delete cascade,
  habit_id text not null,
  primary key (owner_id, habit_id)
);

create table public.nudges (
  id         uuid primary key default gen_random_uuid(),
  from_id    uuid not null references auth.users on delete cascade,
  to_id      uuid not null references auth.users on delete cascade,
  habit_id   text not null,
  day        date not null,
  created_at timestamptz not null default now(),
  unique (from_id, to_id, habit_id, day)
);
create index nudges_to on public.nudges (to_id, created_at);

/* A profile's time zone must be one Postgres knows (checked once here, so readers can trust it). */
create function public.profiles_check_zone() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.time_zone is not null then
    perform now() at time zone new.time_zone;
  end if;
  return new;
exception when others then
  raise exception 'bad_time_zone' using errcode = '22023';
end $$;
create trigger profiles_check_zone before insert or update of time_zone on public.profiles
  for each row execute function public.profiles_check_zone();

/* The owner's local date (their profile's time zone; UTC when unset). */
create function public.local_today(p_account uuid) returns date
language sql stable security definer set search_path = '' as $$
  select (now() at time zone coalesce((select p.time_zone from public.profiles p where p.id = p_account), 'UTC'))::date;
$$;

/* Sets who buddies a habit of yours (friends only) and whether they can nudge. */
create function public.set_buddies(p_habit text, p_buddies uuid[], p_nudges boolean default true) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.me();
begin
  if not exists (select 1 from public.sync_rows r where r.owner_id = me and r.tbl = 'habits' and r.id = p_habit) then
    raise exception 'no_such_habit' using errcode = 'P0002';
  end if;
  if exists (select 1 from unnest(p_buddies) b where not public.is_friend(me, b)) then
    raise exception 'not_friends' using errcode = '42501';
  end if;
  if coalesce(array_length(p_buddies, 1), 0) > 20 then raise exception 'too_many_buddies' using errcode = '23514'; end if;
  delete from public.habit_buddies where owner_id = me and habit_id = p_habit and not (buddy_id = any(p_buddies));
  insert into public.habit_buddies (owner_id, habit_id, buddy_id) select me, p_habit, b from unnest(p_buddies) b
  on conflict do nothing;
  if p_nudges then
    delete from public.habit_quiet where owner_id = me and habit_id = p_habit;
  else
    insert into public.habit_quiet values (me, p_habit) on conflict do nothing;
  end if;
end $$;

/* Your habits' buddies (for the habit's settings). */
create function public.my_buddies()
returns table (habit_id text, buddy_id uuid, handle text, nudges boolean)
language sql stable security definer set search_path = '' as $$
  select b.habit_id, b.buddy_id, p.handle::text,
    not exists (select 1 from public.habit_quiet q where q.owner_id = b.owner_id and q.habit_id = b.habit_id)
  from public.habit_buddies b left join public.profiles p on p.id = b.buddy_id
  where b.owner_id = public.me();
$$;

/* Habits you buddy: the habit's name and today's check-in (in the owner's day), nothing else. */
create function public.buddy_habits()
returns table (owner_id uuid, handle text, display_name text, habit_id text, name text, today numeric, can_nudge boolean)
language sql stable security definer set search_path = '' as $$
  select b.owner_id, p.handle::text, p.display_name, b.habit_id, h.data->>'name',
    coalesce((select case when c.data->>'deleted_at' is null then (c.data->>'value')::numeric end from public.sync_rows c
              where c.owner_id = b.owner_id and c.tbl = 'habit_checkins'
                and c.id = b.habit_id || '|' || to_char(public.local_today(b.owner_id), 'YYYY-MM-DD')), 0),
    not exists (select 1 from public.habit_quiet q where q.owner_id = b.owner_id and q.habit_id = b.habit_id)
      and not exists (select 1 from public.nudges n where n.from_id = b.buddy_id and n.to_id = b.owner_id
                      and n.habit_id = b.habit_id and n.day = public.local_today(b.owner_id))
  from public.habit_buddies b
  join public.sync_rows h on h.owner_id = b.owner_id and h.tbl = 'habits' and h.id = b.habit_id and h.data->>'deleted_at' is null
  left join public.profiles p on p.id = b.owner_id
  where b.buddy_id = public.me() and public.is_friend(b.owner_id, b.buddy_id);
$$;

/* A buddy's nudge: once a day per habit, unless the owner turned nudges off. */
create function public.nudge(p_owner uuid, p_habit text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.me();
begin
  if not exists (select 1 from public.habit_buddies b where b.owner_id = p_owner and b.habit_id = p_habit and b.buddy_id = me)
     or not public.is_friend(me, p_owner) then
    raise exception 'not_a_buddy' using errcode = '42501';
  end if;
  if exists (select 1 from public.habit_quiet q where q.owner_id = p_owner and q.habit_id = p_habit) then
    raise exception 'nudges_off' using errcode = '42501';
  end if;
  insert into public.nudges (from_id, to_id, habit_id, day) values (me, p_owner, p_habit, public.local_today(p_owner))
  on conflict do nothing;
  if not found then raise exception 'already_nudged' using errcode = '23514'; end if;
end $$;

-- ---------- Access ----------

alter table public.sent_tasks enable row level security;
alter table public.focus_status enable row level security;
alter table public.habit_buddies enable row level security;
alter table public.habit_quiet enable row level security;
alter table public.nudges enable row level security;
revoke all on public.sent_tasks, public.focus_status, public.habit_buddies, public.habit_quiet, public.nudges from anon, authenticated;

-- Read for Realtime: your own nudges and sent-task changes, friends' published focus.
grant select on public.focus_status, public.nudges to authenticated;
grant select (id, sender, recipient, status, created_at, responded_at) on public.sent_tasks to authenticated;
create policy focus_status_read on public.focus_status for select to authenticated using (public.focus_visible(account_id));
create policy nudges_own on public.nudges for select to authenticated using (to_id = (select auth.uid()));
create policy sent_tasks_own on public.sent_tasks for select to authenticated using ((select auth.uid()) in (sender, recipient));

alter publication supabase_realtime add table public.focus_status, public.nudges, public.sent_tasks;

do $$
declare fn regprocedure;
begin
  for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('ping_all', 'iso_now', 'insert_inbox_task', 'send_task', 'respond_sent_task',
      'incoming_tasks', 'outgoing_tasks', 'set_focus', 'focus_visible', 'profiles_focus_off', 'profiles_check_zone', 'local_today', 'set_buddies',
      'my_buddies', 'buddy_habits', 'nudge')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
  end loop;
end $$;
grant execute on function public.respond_sent_task(uuid, boolean), public.incoming_tasks(), public.outgoing_tasks(),
  public.set_focus(timestamptz), public.focus_visible(uuid), public.set_buddies(text, uuid[], boolean), public.my_buddies(),
  public.buddy_habits(), public.nudge(uuid, text) to authenticated;
grant execute on function public.send_task(uuid, uuid, jsonb), public.insert_inbox_task(uuid, jsonb, text) to service_role;
