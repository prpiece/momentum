-- One sync of a calendar account at a time (cron, the apps' debounced /sync, choose and connect can overlap).
-- `sync_until` is a lease: the function takes it with calendar_try_lock before syncing and clears it when
-- it finishes. If the function is killed the lease just runs out, so no run ever waits on a dead one.
-- Bumps schema_version to 24 (D289: every migration does).

alter table public.calendar_accounts add column sync_until timestamptz;

-- Returns the lease it took (the new sync_until), or null when another run holds the account; the run
-- releases with `sync_until = <that lease>`, so one that outlived its lease can't clear a newer run's.
create function public.calendar_try_lock(p_account uuid, p_seconds int) returns timestamptz
language sql security definer set search_path = '' as $$
  update public.calendar_accounts
     set sync_until = now() + make_interval(secs => p_seconds)
   where id = p_account and (sync_until is null or sync_until < now())
  returning sync_until;
$$;
revoke all on function public.calendar_try_lock(uuid, int) from public, anon, authenticated;
grant execute on function public.calendar_try_lock(uuid, int) to service_role;

update public.server_meta set schema_version = 24;
