-- Two-way Google Calendar and Outlook sync (FEAT-01, PLAN D345). Bumps schema_version to 11.
--
-- The `calendar` Edge Function holds the OAuth grants and moves events both ways between the provider
-- and the account's `calendar_events` records (sync_rows, ADR 0005); the apps only see the events.
-- One account per provider per user. The refresh token is AES-GCM encrypted with the function's
-- CALENDAR_TOKEN_KEY and lives in `calendar_tokens`, which no client role can read. The owner reads
-- their `calendar_accounts` row (which calendars sync, where new events go, the last error) but can't
-- write it: changes go through the function.

create table public.calendar_accounts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users on delete cascade,
  provider         text not null check (provider in ('google', 'microsoft')),
  email            text,
  -- [{ id, name, color, primary, canEdit, sync }]
  calendars        jsonb not null default '[]' check (jsonb_typeof(calendars) = 'array'),
  -- The calendar new Momentum events go to; null sends none.
  write_calendar_id text,
  -- Per calendar id: Google's syncToken or Graph's deltaLink.
  cursors          jsonb not null default '{}' check (jsonb_typeof(cursors) = 'object'),
  connected_at     timestamptz not null default now(),
  last_sync        timestamptz,
  error            text,
  unique (user_id, provider)
);
create index calendar_accounts_due on public.calendar_accounts (last_sync nulls first);

create table public.calendar_tokens (
  account_id    uuid primary key references public.calendar_accounts on delete cascade,
  refresh_token text not null -- base64(iv || AES-GCM ciphertext)
);

alter table public.calendar_accounts enable row level security;
alter table public.calendar_tokens enable row level security;
revoke all on public.calendar_accounts, public.calendar_tokens from anon, authenticated;
create policy calendar_accounts_own on public.calendar_accounts for select to authenticated using (user_id = (select auth.uid()));
grant select (id, provider, email, calendars, write_calendar_id, connected_at, last_sync, error) on public.calendar_accounts to authenticated;
grant all on public.calendar_accounts, public.calendar_tokens to service_role;

/*
 * The function's writes into an account's calendar_events: merged like sync patches, each field
 * stamped with the server's time (SYNC-11), so an older offline edit can't undo what the provider
 * said, then one wake-up for the account's devices. `p_rows` is [{ id, fields }].
 */
create function public.calendar_write(p_account uuid, p_rows jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb;
  f jsonb;
  stamps jsonb;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception 'bad_batch' using errcode = '22023';
  end if;
  -- The same locks, in the same order, as sync_push for an account in no share.
  perform pg_advisory_xact_lock(hashtextextended(p_account::text, 0));
  perform pg_advisory_xact_lock_shared(hashtextextended('shares', 0));
  for r in select value from jsonb_array_elements(p_rows) loop
    f := r->'fields';
    if jsonb_typeof(f) <> 'object' or coalesce(r->>'id', '') = '' then
      raise exception 'bad_row' using errcode = '22023';
    end if;
    select coalesce(jsonb_object_agg(k, public.sync_stamp(null, '00000000-0000-0000-0000-000000000000')), '{}')
      into stamps from jsonb_object_keys(f) as k where left(k, 1) <> '_';
    insert into public.sync_rows as s (owner_id, tbl, id, data, version, field_ts)
    values (p_account, 'calendar_events', r->>'id', f, nextval('public.sync_version'), stamps)
    on conflict (owner_id, tbl, id) do update
      set data = s.data || excluded.data, version = excluded.version, updated_at = now(), field_ts = s.field_ts || excluded.field_ts;
  end loop;
  perform public.ping_all(p_account);
end $$;

revoke all on function public.calendar_write(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.calendar_write(uuid, jsonb) to service_role;

/* pg_cron: asks the calendar function to sync accounts every 10 minutes (only when its URL and secret are configured). */
create function public.run_calendar_sync() returns void
language plpgsql security definer set search_path = '' as $$
declare
  url text := (select value from public.server_secrets where key = 'calendar_url');
  secret text := (select value from public.server_secrets where key = 'calendar_cron_secret');
begin
  if url is null or secret is null or not exists (select 1 from public.calendar_accounts) then return; end if;
  perform net.http_post(url := url || '/cron', body := '{}'::jsonb,
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', secret));
end $$;

revoke all on function public.run_calendar_sync() from public, anon, authenticated;
select cron.schedule('calendar-sync', '*/10 * * * *', 'select public.run_calendar_sync()');

-- D289: every migration bumps the schema version by one.
update public.server_meta set schema_version = 11;
