-- Per-account quotas on synced rows and cloud backups.
--
-- sync_push had only the 1 MB per-record cap, so one account could loop it and fill the disk for everyone.
-- `sync_usage` now counts, per account, the records and bytes (octets of the JSON text) in sync_rows. A trigger keeps
-- it exact for every write path (creates, edits, moves between namespaces, deletes, service-role functions).
-- While sync_push runs, the same trigger refuses a write that grows an account over `sync_rows` records or
-- `sync_bytes` bytes (plan_limits): the namespace that gains the row is charged, so an editor's creates or moves
-- into the owner's list count against the owner. The refused patch is rolled back and reported ('quota_exceeded').
-- Exempt: a tombstone (only `deleted_at` / `_purged`), so an account over its cap can still clean up. Nothing stored is deleted.
-- ponytail: field_ts (stamps) isn't counted in sync_usage; it is bounded by the keys a record has. Count it if it grows.
-- Service-role writes (calendar sync, inbound tasks, connections) are counted but never refused.
-- The `backups` bucket gets an object and byte cap.

create or replace function public.plan_limits(p_account uuid) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('plan', 'pro', 'share_members', 25, 'storage_bytes', 10737418240::bigint,
    'sync_rows', 250000, 'sync_bytes', 268435456::bigint);
$$;

/* As in 20261116060000_sync_lww_pings_profiles.sql, plus the quota. */
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
  mark bigint;             -- a version taken before a shared write: newer means the write landed
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
      -- The quota trigger (sync_usage_track) refuses growth past a cap while this is on, except for a tombstone.
      perform set_config('momentum.quota', case when not exists (select 1 from jsonb_object_keys(f) x where x not in ('deleted_at', '_purged'))
        and pg_column_size(f) <= 500 then 'tombstone' else 'on' end, true);
      if shared_tbl then
        mark := nextval('public.sync_version');
        touched := touched || public.push_shared(me, p->>'tbl', p->>'id', f);
        -- push_shared drops a viewer's activity silently. Nothing was written, so leave no stamp, change or ping either.
        continue patches when p->>'tbl' = 'task_activity'
          and not exists (select 1 from public.sync_rows x where x.tbl = 'task_activity' and x.id = p->>'id' and x.version > mark);
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

create table public.sync_usage (
  owner_id uuid primary key references auth.users on delete cascade,
  records  bigint not null default 0,
  bytes    bigint not null default 0
);
alter table public.sync_usage enable row level security;
revoke all on public.sync_usage from anon, authenticated;

create function public.sync_size(d jsonb) returns bigint
language sql immutable set search_path = '' as $$ select octet_length(d::text)::bigint $$;

/* Keeps sync_usage exact and, inside sync_push (momentum.quota = on), refuses growth past a cap. */
create function public.sync_usage_track() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  lim jsonb;
  u record;
  d bigint;
  grew boolean := false;
  entering boolean := false;
begin
  -- The row leaves a namespace (deleted, or moved to another owner).
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.owner_id <> new.owner_id) then
    update public.sync_usage set records = records - 1, bytes = bytes - public.sync_size(old.data) where owner_id = old.owner_id;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'INSERT' or old.owner_id <> new.owner_id then
    -- The row enters a namespace.
    insert into public.sync_usage as g (owner_id, records, bytes) values (new.owner_id, 1, public.sync_size(new.data))
    on conflict (owner_id) do update set records = g.records + 1, bytes = g.bytes + excluded.bytes
    returning g.records, g.bytes into u;
    grew := true;
    entering := true;
  else
    -- Same namespace: only the size change matters (field_ts and version aren't counted).
    d := public.sync_size(new.data) - public.sync_size(old.data);
    if d <> 0 then
      update public.sync_usage set bytes = bytes + d where owner_id = new.owner_id returning records, bytes into u;
      grew := d > 0;
    end if;
  end if;
  -- A tombstone edit is exempt, but a tombstone can't create a record or move one in.
  if grew and (current_setting('momentum.quota', true) = 'on' or (entering and current_setting('momentum.quota', true) = 'tombstone')) then
    lim := public.plan_limits(new.owner_id);
    if u.records > (lim->>'sync_rows')::bigint or u.bytes > (lim->>'sync_bytes')::bigint then
      raise exception 'quota_exceeded' using errcode = '53400';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.sync_size(jsonb), public.sync_usage_track() from public, anon, authenticated;

lock table public.sync_rows in share row exclusive mode;
insert into public.sync_usage (owner_id, records, bytes)
  select owner_id, count(*), sum(public.sync_size(data)) from public.sync_rows group by owner_id;
create trigger sync_rows_usage after insert or update of data, owner_id or delete on public.sync_rows
  for each row execute function public.sync_usage_track();

/* Whether the account may add another cloud backup: under 70 files (the client keeps at most 60) and 2 GiB. */
create function public.backups_room() returns boolean
language sql stable security definer set search_path = '' as $$
  select count(*) < 70 and coalesce(sum((o.metadata->>'size')::bigint), 0) < 2147483648
  from storage.objects o where o.bucket_id = 'backups' and o.name like auth.uid()::text || '/%';
$$;
revoke all on function public.backups_room() from public, anon;
grant execute on function public.backups_room() to authenticated;

drop policy backups_write on storage.objects;
create policy backups_write on storage.objects for insert to authenticated
  with check (bucket_id = 'backups' and (storage.foldername(name))[1] = (select auth.uid())::text and public.backups_room());


update public.server_meta set schema_version = 15;
