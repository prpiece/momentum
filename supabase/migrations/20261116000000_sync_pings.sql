-- Server-side changes wake every device of the account, a single device included (SYNC-09).
-- `ping`/`ping_all` used to only touch `devices.last_seen`, and a device ignores events for its own
-- row (the echo of its own push), so an account with one device waited for the 5-minute poll.
-- They now also touch the account's `sync_pings` row, which the app listens to over Realtime. The
-- `devices` update stays for older apps, which only listen there.
--
-- Like `social_pings`: the row carries only the account it belongs to, and RLS lets each account
-- see its own (Realtime sends DELETE events unfiltered, which is why `devices` itself is a poor channel).

create table public.sync_pings (
  account_id uuid primary key references auth.users on delete cascade,
  at         timestamptz not null default now()
);
alter table public.sync_pings enable row level security;
create policy "own pings" on public.sync_pings for select to authenticated using (account_id = auth.uid());
grant select on public.sync_pings to authenticated;
grant all on public.sync_pings to service_role;

/* Wakes other accounts' devices so they pull. */
create or replace function public.ping(p_accounts uuid[]) returns void
language sql security definer set search_path = '' as $$
  update public.devices set last_seen = now() where owner_id = any(p_accounts) and owner_id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000');
  insert into public.sync_pings (account_id, at)
  select distinct x, now() from unnest(p_accounts) as x
  where x <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000')
    and exists (select 1 from auth.users u where u.id = x)
  on conflict (account_id) do update set at = excluded.at;
$$;

/* Wakes every device of an account so it pulls. */
create or replace function public.ping_all(p_account uuid) returns void
language sql security definer set search_path = '' as $$
  update public.devices set last_seen = now() where owner_id = p_account;
  insert into public.sync_pings (account_id, at)
  select p_account, now() where exists (select 1 from auth.users u where u.id = p_account)
  on conflict (account_id) do update set at = excluded.at;
$$;

alter publication supabase_realtime add table public.sync_pings;

-- D289: every migration bumps the schema version by one.
update public.server_meta set schema_version = 4;
