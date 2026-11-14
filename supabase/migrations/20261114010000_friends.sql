-- Friends, blocks, friend invite links and plan limits (v1.4, PLAN D260, D261, D266).
-- Every write goes through a function below; clients only read their own rows.

create extension if not exists pgcrypto with schema extensions;

alter table public.profiles
  -- The account's IANA zone: the bots' "today" and the Digest's send time use it.
  add column time_zone   text check (time_zone is null or time_zone ~ '^[A-Za-z0-9_+/-]{1,64}$'),
  -- "Let friends see when I'm focusing" (off by default, D260).
  add column share_focus boolean not null default false;

-- ---------- Plan limits ----------

/* The caps for an account. Everyone gets the Pro limits until v1.5 adds plans (D266). */
create function public.plan_limits(p_account uuid) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('plan', 'pro', 'share_members', 25, 'storage_bytes', 10737418240::bigint);
$$;

-- ---------- Tables ----------

/* Mutual: one row per pair, `a < b`. A pending row is a request from `requested_by`. */
create table public.friendships (
  a            uuid not null references auth.users on delete cascade,
  b            uuid not null references auth.users on delete cascade,
  status       text not null default 'pending' check (status in ('pending', 'accepted')),
  requested_by uuid not null,
  created_at   timestamptz not null default now(),
  primary key (a, b),
  check (a < b),
  check (requested_by in (a, b))
);
create index friendships_b on public.friendships (b);

/* A decline blocks a new request from the same person for 7 days. */
create table public.friend_declines (
  from_id uuid not null references auth.users on delete cascade,
  to_id   uuid not null references auth.users on delete cascade,
  at      timestamptz not null default now(),
  primary key (from_id, to_id)
);

/* Requests sent, for the 20-a-day limit (rows older than a day are pruned on the next request). */
create table public.friend_request_log (
  account_id uuid not null references auth.users on delete cascade,
  at         timestamptz not null default now()
);
create index friend_request_log_account on public.friend_request_log (account_id, at);

create table public.blocks (
  blocker    uuid not null references auth.users on delete cascade,
  blocked    uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);
create index blocks_blocked on public.blocks (blocked);

/* Invite links (D261): a friend link, or a share link with the role it grants (share_id is added
 * by the shares migration). Usable by anyone holding the code until it expires or is revoked. */
create table public.invites (
  code       text primary key check (code ~ '^[A-Za-z0-9]{10}$'),
  creator    uuid not null references auth.users on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index invites_creator on public.invites (creator, created_at);

-- Reports can name an account (Report on a friend or request).
alter table public.reports add column reported_id uuid references auth.users on delete set null;
grant insert (reported_id) on public.reports to authenticated;

-- ---------- Helpers ----------

create function public.is_friend(x uuid, y uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.friendships f
    where f.a = least(x, y) and f.b = greatest(x, y) and f.status = 'accepted');
$$;

create function public.is_blocked(x uuid, y uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.blocks k where (k.blocker = x and k.blocked = y) or (k.blocker = y and k.blocked = x));
$$;

create function public.me() returns uuid
language plpgsql stable set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  return auth.uid();
end $$;

/* Who may read a profile: yourself, friends and people with a pending request either way. The
 * shares migration widens this to people in a share with you. */
create function public.profile_visible(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_id = auth.uid() or exists (select 1 from public.friendships f
    where f.a = least(p_id, auth.uid()) and f.b = greatest(p_id, auth.uid()));
$$;

create function public.new_code() returns text
language sql volatile set search_path = '' as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789', (get_byte(b, i) % 57) + 1, 1), '')
  from extensions.gen_random_bytes(10) as b, generate_series(0, 9) as i;
$$;

-- ---------- Friend requests ----------

create function public.friend_count(p_account uuid) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.friendships f where p_account in (f.a, f.b) and f.status = 'accepted';
$$;

/* Makes two accounts friends (both caps checked). */
create function public.befriend(x uuid, y uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.friend_count(x) >= 200 or public.friend_count(y) >= 200 then
    raise exception 'too_many_friends' using errcode = '23514';
  end if;
  insert into public.friendships (a, b, status, requested_by) values (least(x, y), greatest(x, y), 'accepted', x)
  on conflict (a, b) do update set status = 'accepted';
end $$;

/* Sends a request by @handle. Returns 'pending', 'accepted' (they had asked you) or 'friends'. */
create function public.request_friend(p_handle text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.me();
  them uuid;
  f public.friendships;
begin
  select p.id into them from public.profiles p where p.handle = p_handle::extensions.citext;
  if them is null or them = me or public.is_blocked(me, them) then
    raise exception 'no_such_account' using errcode = 'P0002';
  end if;
  select * into f from public.friendships where a = least(me, them) and b = greatest(me, them);
  if f.status = 'accepted' then return 'friends'; end if;
  if f.status = 'pending' and f.requested_by = them then
    perform public.befriend(me, them);
    return 'accepted';
  end if;
  if f.status = 'pending' then return 'pending'; end if;
  if exists (select 1 from public.friend_declines d where d.from_id = me and d.to_id = them and d.at > now() - interval '7 days') then
    raise exception 'declined_recently' using errcode = '23514';
  end if;
  delete from public.friend_request_log where account_id = me and at < now() - interval '1 day';
  if (select count(*) from public.friend_request_log where account_id = me) >= 20 then
    raise exception 'too_many_requests' using errcode = '23514';
  end if;
  if public.friend_count(me) >= 200 then
    raise exception 'too_many_friends' using errcode = '23514';
  end if;
  insert into public.friend_request_log (account_id) values (me);
  insert into public.friendships (a, b, requested_by) values (least(me, them), greatest(me, them), me);
  return 'pending';
end $$;

/* Accepts or declines a request someone sent you. */
create function public.respond_friend(p_account uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.me();
begin
  if not exists (select 1 from public.friendships f where f.a = least(me, p_account) and f.b = greatest(me, p_account)
                 and f.status = 'pending' and f.requested_by = p_account) then
    raise exception 'no_such_request' using errcode = 'P0002';
  end if;
  if p_accept then
    perform public.befriend(me, p_account);
  else
    delete from public.friendships where a = least(me, p_account) and b = greatest(me, p_account);
    insert into public.friend_declines (from_id, to_id) values (p_account, me)
    on conflict (from_id, to_id) do update set at = now();
  end if;
end $$;

/* Ends a friendship or cancels a request, either direction. */
create function public.remove_friend(p_account uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.friendships where a = least(public.me(), p_account) and b = greatest(public.me(), p_account);
$$;

/* Ends the friendship and every request both ways, and hides each account from the other. Shares stay. */
create function public.block_account(p_account uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.me();
begin
  if p_account = me then raise exception 'bad_account' using errcode = '22023'; end if;
  perform public.remove_friend(p_account);
  insert into public.blocks (blocker, blocked) values (me, p_account) on conflict do nothing;
end $$;

create function public.unblock_account(p_account uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.blocks where blocker = public.me() and blocked = p_account;
$$;

/* An exact @handle lookup for Add friend. Blocked accounts (either way) aren't found. */
create function public.find_profile(p_handle text)
returns table (id uuid, handle text, display_name text, avatar text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.handle::text, p.display_name, p.avatar from public.profiles p
  where p.handle = p_handle::extensions.citext and p.id <> public.me() and not public.is_blocked(p.id, public.me());
$$;

/* Friends and requests, with their profiles. `incoming` marks requests waiting on you. */
create function public.my_friends()
returns table (id uuid, handle text, display_name text, avatar text, status text, incoming boolean, since timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.id, p.handle::text, p.display_name, p.avatar, f.status, f.status = 'pending' and f.requested_by <> public.me(), f.created_at
  from public.friendships f
  join public.profiles p on p.id = case when f.a = public.me() then f.b else f.a end
  where public.me() in (f.a, f.b)
  order by f.status, p.handle;
$$;

-- ---------- Friend invite links ----------

/* Friend links last 30 days. At most 50 links a day. */
create function public.create_friend_invite() returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.me();
  c text := public.new_code();
begin
  if (select count(*) from public.invites where creator = me and created_at > now() - interval '1 day') >= 50 then
    raise exception 'too_many_invites' using errcode = '23514';
  end if;
  insert into public.invites (code, creator, expires_at) values (c, me, now() + interval '30 days');
  return c;
end $$;

create function public.revoke_invite(p_code text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.invites set revoked_at = now() where code = p_code and creator = public.me() and revoked_at is null;
  if not found then raise exception 'no_such_invite' using errcode = 'P0002'; end if;
end $$;

-- ---------- Access ----------

alter table public.friendships enable row level security;
alter table public.friend_declines enable row level security;
alter table public.friend_request_log enable row level security;
alter table public.blocks enable row level security;
alter table public.invites enable row level security;
revoke all on public.friendships, public.friend_declines, public.friend_request_log, public.blocks, public.invites from anon, authenticated;

grant select on public.friendships, public.blocks, public.invites to authenticated;
create policy friendships_own on public.friendships for select to authenticated using ((select auth.uid()) in (a, b));
create policy blocks_own on public.blocks for select to authenticated using (blocker = (select auth.uid()));
create policy invites_own on public.invites for select to authenticated using (creator = (select auth.uid()));

drop policy profiles_own_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (public.profile_visible(id));

revoke all on function public.plan_limits(uuid), public.is_friend(uuid, uuid), public.is_blocked(uuid, uuid), public.me(),
  public.profile_visible(uuid), public.new_code(), public.friend_count(uuid), public.befriend(uuid, uuid),
  public.request_friend(text), public.respond_friend(uuid, boolean), public.remove_friend(uuid), public.block_account(uuid),
  public.unblock_account(uuid), public.find_profile(text), public.my_friends(), public.create_friend_invite(),
  public.revoke_invite(text) from public, anon;
-- Helpers that take any two accounts stay private: they would reveal who is friends with whom.
revoke all on function public.befriend(uuid, uuid), public.friend_count(uuid), public.new_code(),
  public.is_friend(uuid, uuid), public.is_blocked(uuid, uuid) from authenticated;
grant execute on function public.me(), public.profile_visible(uuid) to authenticated;
grant execute on function public.plan_limits(uuid), public.request_friend(text), public.respond_friend(uuid, boolean),
  public.remove_friend(uuid), public.block_account(uuid), public.unblock_account(uuid), public.find_profile(text),
  public.my_friends(), public.create_friend_invite(), public.revoke_invite(text) to authenticated;
