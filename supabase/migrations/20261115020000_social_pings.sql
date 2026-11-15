-- Friend requests and share changes reach the other person at once (they used to wait for the
-- app's 3-minute refresh). Each account has one `social_pings` row; a trigger touches it whenever
-- a friendship or share membership involving that account changes, and the app listens for its
-- own row over Realtime, then reloads Friends.
--
-- Why not publish `friendships` itself: Realtime sends DELETE events to every subscriber without
-- RLS, and a friendship's key is the two account ids, which would tell everyone who was friends.
-- A ping row carries only the account it belongs to, and RLS lets each account see its own.

create table public.social_pings (
  account_id uuid primary key references auth.users on delete cascade,
  at         timestamptz not null default now()
);
alter table public.social_pings enable row level security;
create policy "own pings" on public.social_pings for select to authenticated using (account_id = auth.uid());
grant select on public.social_pings to authenticated;
grant all on public.social_pings to service_role;

create function public.social_ping(p_accounts uuid[]) returns void
language sql security definer set search_path = '' as $$
  insert into public.social_pings (account_id, at)
  select distinct x, now() from unnest(p_accounts) as x
  -- An account being deleted drops its memberships on the way out: it has no one left to tell.
  where exists (select 1 from auth.users u where u.id = x)
  on conflict (account_id) do update set at = excluded.at;
$$;
revoke all on function public.social_ping(uuid[]) from public, anon, authenticated;

create function public.ping_friendship() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then perform public.social_ping(array[old.a, old.b]);
  else perform public.social_ping(array[new.a, new.b]);
  end if;
  return null;
end $$;

create trigger social_ping after insert or update or delete on public.friendships
for each row execute function public.ping_friendship();

-- A membership change concerns its member and everyone else in that share, owner included.
create function public.ping_share_member() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r public.share_members := case when tg_op = 'DELETE' then old else new end;
begin
  perform public.social_ping(array(
    select m.account_id from public.share_members m where m.share_id = r.share_id
    union select s.owner_id from public.shares s where s.id = r.share_id
    union select r.account_id));
  return null;
end $$;

create trigger social_ping after insert or update or delete on public.share_members
for each row execute function public.ping_share_member();

alter publication supabase_realtime add table public.social_pings;

-- D289: every migration bumps the schema version by one.
update public.server_meta set schema_version = 3;
