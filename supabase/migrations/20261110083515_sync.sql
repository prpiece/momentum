-- Accounts and sync (v1.1, PLAN D225). One generic table holds every synced record as jsonb;
-- devices push field patches through sync_push and read changes through sync_pull.
-- Clients get no direct write access to sync_rows: every write goes through sync_push.

create extension if not exists citext with schema extensions;

-- ---------- Profiles and devices ----------

create table public.profiles (
  id                uuid primary key references auth.users on delete cascade,
  handle            extensions.citext unique check (handle ~ '^[a-z0-9_]{3,20}$'),
  display_name      text check (char_length(display_name) between 1 and 50),
  avatar            text check (char_length(avatar) <= 40),
  handle_changed_at timestamptz,
  created_at        timestamptz not null default now()
);

create table public.reserved_handles (handle extensions.citext primary key);
insert into public.reserved_handles (handle) values
  ('admin'), ('administrator'), ('root'), ('support'), ('help'), ('momentum'), ('official'), ('staff'),
  ('system'), ('moderator'), ('mod'), ('null'), ('undefined'), ('anonymous'), ('everyone'), ('security');

-- Handles: not reserved, and changeable once every 30 days.
create function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.handle is distinct from old.handle then
    if exists (select 1 from public.reserved_handles r where r.handle = new.handle) then
      raise exception 'handle_reserved' using errcode = '23514';
    end if;
    if old.handle_changed_at is not null and old.handle_changed_at > now() - interval '30 days' then
      raise exception 'handle_changed_recently' using errcode = '23514';
    end if;
    new.handle_changed_at := now();
  end if;
  new.id := old.id;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles for each row execute function public.profiles_guard();

create function public.profiles_guard_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.handle is not null and exists (select 1 from public.reserved_handles r where r.handle = new.handle) then
    raise exception 'handle_reserved' using errcode = '23514';
  end if;
  new.handle_changed_at := case when new.handle is null then null else now() end;
  return new;
end $$;
create trigger profiles_guard_insert before insert on public.profiles for each row execute function public.profiles_guard_insert();

create table public.devices (
  owner_id  uuid not null references auth.users on delete cascade,
  id        uuid not null,
  name      text check (char_length(name) <= 100),
  platform  text check (char_length(platform) <= 20),
  last_seen timestamptz not null default now(),
  -- Highest outbox seq applied from this device: a retried push never applies a patch twice.
  last_seq  bigint not null default 0,
  primary key (owner_id, id)
);

-- ---------- Synced records ----------

create sequence public.sync_version;

create table public.sync_rows (
  owner_id   uuid not null references auth.users on delete cascade,
  tbl        text not null check (tbl in (
    'folders', 'lists', 'sections', 'tags', 'tasks', 'task_activity', 'calendar_events', 'habit_groups',
    'habits', 'habit_checkins', 'focus_sessions', 'rest_days', 'celebrations', 'settings')),
  id         text not null check (char_length(id) between 1 and 200),
  data       jsonb not null check (jsonb_typeof(data) = 'object'),
  version    bigint not null,
  updated_at timestamptz not null default now(),
  primary key (owner_id, tbl, id),
  -- ponytail: one size cap per record instead of per-field domain limits (amends D155); add
  -- field checks if abuse shows up.
  constraint sync_rows_size check (pg_column_size(data) <= 1000000)
);
create index sync_rows_owner_version on public.sync_rows (owner_id, version);

create table public.server_meta (
  id                int primary key default 1 check (id = 1),
  min_client_schema int not null default 0
);
insert into public.server_meta default values;

-- ---------- Push and pull ----------

/*
 * Applies a device's outbox patches in order: fields merge into the record (last writer wins per
 * field, in arrival order); `_delta` adds to a check-in's `value` (from 0 if the row was deleted).
 * A patch that fails a check is refused alone and reported; the rest still apply.
 */
create function public.sync_push(p_device uuid, p_schema int, p_patches jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  last bigint;
  p jsonb;
  seq bigint;
  f jsonb;
  cur jsonb;
  refused jsonb := '[]';
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
  -- One push per account at a time, so versions commit in order and a pull never skips one.
  perform pg_advisory_xact_lock(hashtextextended(me::text, 0));

  insert into public.devices (owner_id, id) values (me, p_device)
  on conflict (owner_id, id) do update set last_seen = now()
  returning last_seq into last;

  for p in select value from jsonb_array_elements(p_patches) loop
    seq := (p->>'seq')::bigint;
    continue when seq is null or seq <= last;
    last := seq;
    f := p->'fields';
    begin
      if jsonb_typeof(f) <> 'object' or p->>'id' is null then
        raise exception 'bad_patch' using errcode = '22023';
      end if;
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
    exception when others then
      refused := refused || jsonb_build_object('seq', seq, 'tbl', p->>'tbl', 'id', p->>'id', 'reason', sqlerrm);
    end;
  end loop;

  update public.devices set last_seq = last, last_seen = now() where owner_id = me and id = p_device;
  return jsonb_build_object('last_seq', last, 'refused', refused);
end $$;

/* Records changed after `p_cursor`, oldest first, tombstones included. */
create function public.sync_pull(p_cursor bigint, p_limit int default 1000)
returns table (tbl text, id text, data jsonb, version bigint)
language sql stable security invoker set search_path = '' as $$
  select r.tbl, r.id, r.data, r.version from public.sync_rows r
  where r.owner_id = auth.uid() and r.version > p_cursor
  order by r.version
  limit least(greatest(p_limit, 1), 1000);
$$;

-- ---------- Access ----------

alter table public.profiles enable row level security;
alter table public.reserved_handles enable row level security;
alter table public.devices enable row level security;
alter table public.sync_rows enable row level security;
alter table public.server_meta enable row level security;

revoke all on public.profiles, public.reserved_handles, public.devices, public.sync_rows, public.server_meta from anon, authenticated;
revoke all on function public.sync_push(uuid, int, jsonb), public.sync_pull(bigint, int) from public, anon;
revoke all on function public.profiles_guard(), public.profiles_guard_insert() from public, anon, authenticated;

grant select, insert, update on public.profiles to authenticated;
create policy profiles_own_read on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_own_insert on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy profiles_own_update on public.profiles for update to authenticated using (id = (select auth.uid()));

grant select, update (name, platform), delete on public.devices to authenticated;
create policy devices_own on public.devices for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

grant select on public.sync_rows to authenticated;
create policy sync_rows_own_read on public.sync_rows for select to authenticated using (owner_id = (select auth.uid()));

grant select on public.server_meta to anon, authenticated;
create policy server_meta_read on public.server_meta for select to anon, authenticated using (true);

grant execute on function public.sync_push(uuid, int, jsonb), public.sync_pull(bigint, int) to authenticated;

-- Other devices learn about a push from the devices row it touches (Realtime, RLS-filtered).
alter publication supabase_realtime add table public.devices;
