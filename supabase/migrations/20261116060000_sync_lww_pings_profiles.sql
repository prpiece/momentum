-- v1.2.4 findings SYNC-11, SYNC-15 and SOC-13 (PLAN D342-D344). Bumps schema_version to 10.
--
-- SYNC-11: per-field last writer wins. Apps from v1.2.5 send, with each patch, when its fields were
-- edited (`ts`: one time for the patch, or a map per field). sync_push keeps, per record, the newest
-- edit stamp of each field (`sync_rows.field_ts`: "<utc time>|<device>", compared byte-wise, so equal
-- times fall back to device id order) and drops a field whose stored stamp is newer. A device that
-- was offline for a day no longer overwrites what was edited elsewhere meanwhile. Client times are
-- clamped to now() + 5 minutes, so a fast clock can't pin a field for long. Patches without `ts`
-- (older apps) always apply, as before, and are stamped with the server's time. Increments (`_delta`)
-- and set deltas (`_add_*`/`_del_*`, SYNC-08) merge instead, so they're never dropped.
-- Personal fields of a shared record (tags, pins…) are stamped per account (`tags@<account>`).
--
-- SYNC-15: device wake-ups move to `sync_pings` (SYNC-09), which now names the device whose push
-- caused it (null for a server-side change), so a device skips its own echo. `devices` leaves the
-- Realtime publication: its DELETE events reached every subscriber. Apps up to v1.2.3 listened on
-- `devices` and now wake for a sibling's push on their next own edit, focus or 5-minute poll instead.
--
-- SOC-13: `profiles` rows are readable only by their owner. Every read of someone else's profile
-- (friends, requests, share people, invites, sent tasks, buddies) goes through SECURITY DEFINER
-- functions that return handle, display name and avatar only, so a stranger with a pending request
-- or a share link no longer reads time_zone, share_focus or handle_changed_at.

-- ---------- SYNC-11 ----------

alter table public.sync_rows add column field_ts jsonb not null default '{}' check (jsonb_typeof(field_ts) = 'object');

/* A field's edit stamp: the client's time (a JSON string; missing or unreadable = now), at most 5 minutes ahead of the server, and the device. */
create function public.sync_stamp(p_ts jsonb, p_device uuid) returns text
language plpgsql stable set search_path = '' as $$
declare
  t timestamptz;
begin
  begin
    t := (p_ts #>> '{}')::timestamptz;
  exception when others then
    t := null;
  end;
  t := least(coalesce(t, now()), now() + interval '5 minutes');
  return to_char(t at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || p_device::text;
end $$;

/* As in 20261116030000_sync_merge_lock.sql, plus per-field last writer wins (SYNC-11) and the push ping (SYNC-15). */
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
  rec jsonb;               -- the record's stored field stamps
  stamps jsonb;            -- this patch's stamps for the fields it writes
  k text;
  sk text;
  stamp text;
  dropped boolean;
  changed boolean := false;
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
  -- Shared records take the global lock exclusively; accounts in no share take it in shared mode (SYNC-16).
  -- ponytail: one lock for every share; per-share locks if members' pushes queue up.
  if exists (select 1 from public.share_members m where m.account_id = me and m.status = 'active') then
    perform pg_advisory_xact_lock(hashtextextended('shares', 0));
  else
    perform pg_advisory_xact_lock_shared(hashtextextended('shares', 0));
    if exists (select 1 from public.share_members m where m.account_id = me and m.status = 'active') then
      perform pg_advisory_xact_lock(hashtextextended('shares', 0));
    end if;
  end if;

  insert into public.devices (owner_id, id) values (me, p_device)
  on conflict (owner_id, id) do update set last_seen = now()
  returning last_seq into last;

  <<patches>>
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

      -- SYNC-11: keep each field's newest edit. The record as this account sees it: its own, or a shared one.
      select r.field_ts into rec from public.sync_rows r
      where r.tbl = p->>'tbl' and r.id = p->>'id'
        and (r.owner_id = me or (shared_tbl and public.row_role(r.owner_id, r.tbl, r.id, r.data, me) is not null))
      order by r.owner_id = me desc limit 1;
      stamps := '{}';
      dropped := false;
      for k in select jsonb_object_keys(f) loop
        -- Markers and deltas aren't fields; a set sent with its deltas merges (SYNC-08) instead of replacing.
        continue when left(k, 1) = '_' or f ? ('_add_' || k) or f ? ('_del_' || k);
        sk := case when k = any(public.personal_keys(p->>'tbl')) then k || '@' || me::text else k end;
        stamp := public.sync_stamp(case jsonb_typeof(p->'ts') when 'object' then p->'ts'->k when 'string' then p->'ts' end, p_device);
        if p ? 'ts' and (rec->>sk) collate "C" > stamp collate "C" then
          f := f - k;
          -- A delete that lost to a newer restore takes its purge marker with it.
          if k = 'deleted_at' then f := f - '_purged'; end if;
          dropped := true;
        else
          stamps := stamps || jsonb_build_object(sk, stamp);
        end if;
      end loop;
      continue patches when dropped and not exists (select 1 from jsonb_object_keys(f) x where x <> '_purged');

      f := public.merge_sets(me, p->>'tbl', p->>'id', f);
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
      changed := true;

      -- Stamp the record where it is now (a create or a move into a share lands in another namespace).
      -- ponytail: a record that moved namespaces starts over with only this patch's stamps.
      if stamps <> '{}' then
        update public.sync_rows r set field_ts = r.field_ts || stamps
        where (r.owner_id, r.tbl, r.id) = (
          select x.owner_id, x.tbl, x.id from public.sync_rows x
          where x.tbl = p->>'tbl' and x.id = p->>'id'
            and (x.owner_id = me or (shared_tbl and public.row_role(x.owner_id, x.tbl, x.id, x.data, me) is not null))
          order by x.owner_id = me desc limit 1);
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
  -- SYNC-15: wake this account's other devices; the pushing device knows its own id and skips the echo.
  if changed then
    insert into public.sync_pings (account_id, at, device) values (me, now(), p_device)
    on conflict (account_id) do update set at = excluded.at, device = excluded.device;
  end if;
  return jsonb_build_object('last_seq', last, 'refused', refused);
end $$;

revoke all on function public.sync_stamp(jsonb, uuid) from public, anon, authenticated;

-- ---------- SYNC-15 ----------

alter table public.sync_pings add column device uuid;

/* Wakes other accounts' devices so they pull (a server-side change: no device). */
create or replace function public.ping(p_accounts uuid[]) returns void
language sql security definer set search_path = '' as $$
  insert into public.sync_pings (account_id, at, device)
  select distinct x, now(), null::uuid from unnest(p_accounts) as x
  where x <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000')
    and exists (select 1 from auth.users u where u.id = x)
  on conflict (account_id) do update set at = excluded.at, device = null;
$$;

/* Wakes every device of an account so it pulls. */
create or replace function public.ping_all(p_account uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.sync_pings (account_id, at, device)
  select p_account, now(), null::uuid where exists (select 1 from auth.users u where u.id = p_account)
  on conflict (account_id) do update set at = excluded.at, device = null;
$$;

alter publication supabase_realtime drop table public.devices;

-- ---------- SOC-13 ----------

drop policy profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (id = (select auth.uid()));

-- D289: every migration bumps the schema version by one.
update public.server_meta set schema_version = 10;
