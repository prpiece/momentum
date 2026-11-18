-- server_write (chat-bot edits) set no per-field stamps, and the SYNC-11 check treats a missing stamp as
-- older than anything, so a device pushing an earlier offline edit after the bot's later one undid it.
-- As in 20261115000000_v121_fixes.sql, plus: each field written is stamped with the server's time under
-- the all-zero device id, as calendar_write does, and as sync_push stamps (personal fields per account).

create or replace function public.server_write(p_account uuid, p_tbl text, p_id text, p_fields jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  f jsonb := p_fields;
  cur jsonb;
  stamps jsonb;
begin
  if p_tbl not in ('tasks', 'tags', 'habit_checkins', 'task_activity') then
    raise exception 'bad_table' using errcode = '22023';
  end if;
  -- The fields written (markers and deltas aren't fields), as sync_push stamps them.
  select coalesce(jsonb_object_agg(
      case when x = any(public.personal_keys(p_tbl)) then x || '@' || p_account::text else x end,
      public.sync_stamp(null, '00000000-0000-0000-0000-000000000000')), '{}')
    into stamps from jsonb_object_keys(f) as x where left(x, 1) <> '_';
  -- The same two locks, in the same order, as sync_push.
  perform pg_advisory_xact_lock(hashtextextended(p_account::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('shares', 0));
  if p_tbl in ('tasks', 'task_activity') then
    perform public.ping(public.push_shared(p_account, p_tbl, p_id, f));
    -- Stamp the record where it lives now: the account's own, or a shared one it can reach.
    update public.sync_rows r set field_ts = r.field_ts || stamps
    where r.tbl = p_tbl and r.id = p_id and r.owner_id = (
      select x.owner_id from public.sync_rows x
      where x.tbl = p_tbl and x.id = p_id
        and (x.owner_id = p_account or public.row_role(x.owner_id, x.tbl, x.id, x.data, p_account) is not null)
      order by x.owner_id = p_account desc limit 1);
  else
    if f ? '_delta' then
      select r.data into cur from public.sync_rows r where r.owner_id = p_account and r.tbl = p_tbl and r.id = p_id;
      f := (f - '_delta') || jsonb_build_object('value',
        (case when cur is null or cur->>'deleted_at' is not null then 0 else coalesce((cur->>'value')::numeric, 0) end)
        + (f->>'_delta')::numeric);
    end if;
    insert into public.sync_rows as r (owner_id, tbl, id, data, version, field_ts)
    values (p_account, p_tbl, p_id, f, nextval('public.sync_version'), stamps)
    on conflict (owner_id, tbl, id) do update
      set data = r.data || excluded.data, version = excluded.version, updated_at = now(), field_ts = r.field_ts || excluded.field_ts;
  end if;
  perform public.ping_all(p_account);
end $$;

update public.server_meta set schema_version = 22;
