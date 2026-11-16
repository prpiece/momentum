-- v1.2.4 sync findings SYNC-08 and SYNC-16 (PLAN D334). Bumps schema_version to 7.
--
-- SYNC-08: apps from v1.2.5 send `_add_<col>`/`_del_<col>` next to `exdates` and `tags` (what the edit
-- added and removed). sync_push merges those into the stored value as sets, so two devices that edit
-- the same task's skipped dates or tags both keep their change. A patch without them (older apps, a
-- create) still replaces the value.
-- SYNC-16: the global 'shares' lock is taken in shared mode by accounts outside every share, so their
-- pushes no longer queue behind each other; members' pushes and share changes still take it exclusively.

/* A JSON array held as a jsonb array or as a string of JSON (how the apps store these columns); anything else is []. */
create function public.json_arr(j jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(j) = 'array' then return j; end if;
  if jsonb_typeof(j) = 'string' then
    begin
      j := (j #>> '{}')::jsonb;
    exception when others then
      return '[]';
    end;
    if jsonb_typeof(j) = 'array' then return j; end if;
  end if;
  return '[]';
end $$;

/*
 * Resolves a patch's set deltas against the record as `me` sees it (a shared task's tags are the
 * member's personal layer). The result keeps the pushing device's order and drops what another
 * device removed meanwhile, then appends what another device added meanwhile:
 *   [x in sent | x added here or x still stored] ++ [x stored | x not in sent and not removed here].
 * The deltas never reach the stored record.
 */
create function public.merge_sets(me uuid, p_tbl text, p_id text, p_fields jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  f jsonb := p_fields;
  k text;
  add_ jsonb;
  del_ jsonb;
  sent jsonb;
  base jsonb;
  merged jsonb;
begin
  foreach k in array array['exdates', 'tags'] loop
    continue when not (f ? ('_add_' || k) or f ? ('_del_' || k));
    add_ := public.json_arr(f->('_add_' || k));
    del_ := public.json_arr(f->('_del_' || k));
    f := f - ('_add_' || k) - ('_del_' || k);
    continue when not f ? k;
    select x.v->k into base from (
      select public.view_row(r.owner_id, r.tbl, r.id, r.data, me) as v, r.owner_id = me as mine
      from public.sync_rows r where r.tbl = p_tbl and r.id = p_id) x
    where x.v is not null order by x.mine desc limit 1;
    continue when base is null;
    base := public.json_arr(base);
    sent := public.json_arr(f->k);
    select coalesce(jsonb_agg(g.x order by g.o), '[]') into merged from (
      select u.x, min(u.o) as o from (
        select e.x, e.o from jsonb_array_elements(sent) with ordinality e(x, o)
        where add_ @> jsonb_build_array(e.x) or base @> jsonb_build_array(e.x)
        union all
        select b.x, 1000000000 + b.o from jsonb_array_elements(base) with ordinality b(x, o)
        where not sent @> jsonb_build_array(b.x) and not del_ @> jsonb_build_array(b.x)) u
      group by u.x) g;
    f := f || jsonb_build_object(k, merged::text);
  end loop;
  return f;
end $$;

/* As in 20261114020000_shares.sql, plus the set merge (SYNC-08) and the shared-mode lock (SYNC-16). */
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
  -- Shared records take the global lock exclusively, so two members' pushes can't interleave. An account
  -- in no share only needs share changes to stay out while it pushes: shared mode, so such pushes run side
  -- by side (SYNC-16). If a share started between the check and the lock, take it exclusively after all
  -- (a deadlock with another such upgrade is detected by Postgres; that client retries on its next run).
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

revoke all on function public.json_arr(jsonb) from public, anon, authenticated;
revoke all on function public.merge_sets(uuid, text, text, jsonb) from public, anon, authenticated;

-- D289: every migration bumps the schema version by one.
update public.server_meta set schema_version = 7;
