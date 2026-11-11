-- Account deletion (PLAN D160, D231). A request signs out every device; after a 7-day grace period a
-- daily job deletes the auth user, and the cascades take its profile, devices and records. The same
-- job strips records deleted more than 30 days ago down to their tombstone, so deleted content
-- doesn't stay on the server. Cancelling is deleting your own request row.

create extension if not exists pg_cron;

create table public.account_deletions (
  owner_id     uuid primary key references auth.users on delete cascade,
  requested_at timestamptz not null default now()
);
alter table public.account_deletions enable row level security;
revoke all on public.account_deletions from anon, authenticated;
grant select, delete on public.account_deletions to authenticated;
create policy account_deletions_own on public.account_deletions for all to authenticated using (owner_id = (select auth.uid()));

/* Returns when the account will be deleted. Asking again keeps the first date. */
create function public.request_account_deletion() returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  at timestamptz;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  insert into public.account_deletions as d (owner_id) values (me)
  on conflict (owner_id) do update set requested_at = d.requested_at
  returning requested_at into at;
  -- Every refresh token stops working: each device is signed out when its access token expires (at most an hour).
  delete from auth.sessions where user_id = me;
  return at + interval '7 days';
end $$;

create function public.purge_deleted() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from auth.users u using public.account_deletions d
  where d.owner_id = u.id and d.requested_at < now() - interval '7 days';
  -- ponytail: a full scan of sync_rows once a day; index deleted records if it gets slow.
  update public.sync_rows set data = jsonb_build_object('deleted_at', data->'deleted_at')
  where data->>'deleted_at' ~ '^\d{4}-\d\d-\d\dT'
    and (data->>'deleted_at')::timestamptz < now() - interval '30 days'
    and data <> jsonb_build_object('deleted_at', data->'deleted_at');
end $$;

revoke all on function public.request_account_deletion(), public.purge_deleted() from public, anon, authenticated;
grant execute on function public.request_account_deletion() to authenticated;
grant execute on function public.purge_deleted() to service_role;

select cron.schedule('purge-deleted', '17 3 * * *', 'select public.purge_deleted()');
