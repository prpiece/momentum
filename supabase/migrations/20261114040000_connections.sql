-- Connections (v1.4, PLAN D263, D265, ADR 0008): Discord, Slack and Telegram chats linked to an
-- account, the personal webhook, rate limits, numbered listings and the Digest. The `inbound`
-- Edge Function is the only caller of the service-role functions here.

create extension if not exists pg_net with schema extensions;

/* A chat identity bound to an account. `reply` holds what the adapter needs to message it later. */
create table public.chat_links (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references auth.users on delete cascade,
  source      text not null check (source in ('discord', 'slack', 'telegram')),
  external_id text not null check (char_length(external_id) between 1 and 200),
  label       text check (char_length(label) <= 100),
  reply       jsonb not null default '{}' check (jsonb_typeof(reply) = 'object'),
  digest_time time,
  digest_sent date,
  created_at  timestamptz not null default now(),
  unique (source, external_id)
);
create index chat_links_account on public.chat_links (account_id);

/* One-time 6-digit codes from Settings → Connections, valid 10 minutes. */
create table public.link_codes (
  code       text primary key check (code ~ '^\d{6}$'),
  account_id uuid not null unique references auth.users on delete cascade,
  expires_at timestamptz not null
);

/* The personal webhook: a secret URL that adds tasks (add only). */
create table public.webhooks (
  account_id uuid primary key references auth.users on delete cascade,
  secret     text not null unique check (char_length(secret) >= 32),
  created_at timestamptz not null default now()
);

/* The tasks a chat's last listing numbered, so `done 2` means the same task for an hour. */
create table public.chat_listings (
  link_id uuid primary key references public.chat_links on delete cascade,
  items   jsonb not null check (jsonb_typeof(items) = 'array'),
  at      timestamptz not null default now()
);

/* Fixed-window counters for the rate limits. */
create table public.rate_counts (
  key    text not null,
  bucket timestamptz not null,
  n      int not null default 0,
  primary key (key, bucket)
);

/* Slack workspaces that installed the app (OAuth without the Marketplace). The bot token never leaves the server. */
create table public.slack_installs (
  team_id      text primary key,
  bot_token    text not null,
  installed_at timestamptz not null default now()
);

/* Server-only settings: the inbound function's URL and the Digest secret (set per environment). */
create table public.server_secrets (
  key   text primary key,
  value text not null
);

-- ---------- Client calls (Settings → Connections) ----------

/* A fresh linking code; asking again replaces the old one. */
create function public.create_link_code() returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.me();
  c text;
begin
  delete from public.link_codes where account_id = me or expires_at < now();
  loop
    select lpad(((get_byte(b, 0) * 65536 + get_byte(b, 1) * 256 + get_byte(b, 2)) % 1000000)::text, 6, '0') into c
    from extensions.gen_random_bytes(3) as b;
    begin
      insert into public.link_codes (code, account_id, expires_at) values (c, me, now() + interval '10 minutes');
      return c;
    exception when unique_violation then
      -- another account holds this code right now: draw again
    end;
  end loop;
end $$;

create function public.my_connections()
returns table (id uuid, source text, label text, digest_time time, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select l.id, l.source, l.label, l.digest_time, l.created_at from public.chat_links l
  where l.account_id = public.me() order by l.created_at;
$$;

create function public.remove_connection(p_id uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.chat_links where id = p_id and account_id = public.me();
$$;

create function public.set_digest(p_id uuid, p_time time) returns void
language sql security definer set search_path = '' as $$
  update public.chat_links set digest_time = p_time, digest_sent = null where id = p_id and account_id = public.me();
$$;

/* Creates (or replaces, which revokes the old URL) the webhook secret. */
create function public.create_webhook() returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.me();
  s text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  insert into public.webhooks (account_id, secret) values (me, s)
  on conflict (account_id) do update set secret = excluded.secret, created_at = now();
  return s;
end $$;

create function public.delete_webhook() returns void
language sql security definer set search_path = '' as $$
  delete from public.webhooks where account_id = public.me();
$$;

create function public.has_webhook() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.webhooks where account_id = public.me());
$$;

-- ---------- Inbound function calls (service role) ----------

/* Binds a chat to the account holding a live code; the code is used up. */
create function public.link_chat(p_code text, p_source text, p_external text, p_label text, p_reply jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  acct uuid;
begin
  delete from public.link_codes where code = p_code and expires_at > now() returning account_id into acct;
  if acct is null then raise exception 'bad_code' using errcode = 'P0002'; end if;
  insert into public.chat_links (account_id, source, external_id, label, reply) values (acct, p_source, p_external, p_label, p_reply)
  on conflict (source, external_id) do update set account_id = excluded.account_id, label = excluded.label,
    reply = excluded.reply, digest_time = null, digest_sent = null;
  return acct;
end $$;

/* Counts one hit against `p_key` and says whether it is within `p_max` per window. */
create function public.hit_rate(p_key text, p_max int, p_window interval) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  b timestamptz := to_timestamp(floor(extract(epoch from now()) / extract(epoch from p_window)) * extract(epoch from p_window));
  c int;
begin
  insert into public.rate_counts as r (key, bucket, n) values (p_key, b, 1)
  on conflict (key, bucket) do update set n = r.n + 1
  returning n into c;
  return c <= p_max;
end $$;

/* Chats whose Digest time has come today in their account's time zone. */
create function public.due_digests()
returns table (id uuid, account_id uuid, source text, reply jsonb, today date)
language sql stable security definer set search_path = '' as $$
  select l.id, l.account_id, l.source, l.reply, public.local_today(l.account_id)
  from public.chat_links l
  left join public.profiles p on p.id = l.account_id
  where l.digest_time is not null
    and (l.digest_sent is null or l.digest_sent < public.local_today(l.account_id))
    and (now() at time zone coalesce(p.time_zone, 'UTC'))::time >= l.digest_time;
$$;

/* pg_cron: asks the inbound function to send due Digests (only when its URL is configured). */
create function public.run_digest() returns void
language plpgsql security definer set search_path = '' as $$
declare
  url text := (select value from public.server_secrets where key = 'inbound_url');
  secret text := (select value from public.server_secrets where key = 'digest_secret');
begin
  delete from public.rate_counts where bucket < now() - interval '2 days';
  delete from public.chat_listings where at < now() - interval '1 hour';
  delete from public.link_codes where expires_at < now();
  if url is null or secret is null or not exists (select public.due_digests()) then return; end if;
  perform net.http_post(url := url || '/digest', body := '{}'::jsonb,
    headers := jsonb_build_object('content-type', 'application/json', 'x-digest-secret', secret));
end $$;

select cron.schedule('digest', '*/5 * * * *', 'select public.run_digest()');

/*
 * A write from a bot command into the account's own records, merged like a sync patch and pulled
 * by its devices. `_delta` adds to a check-in's value (ADR 0005). Only tables the commands touch.
 */
create function public.server_write(p_account uuid, p_tbl text, p_id text, p_fields jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  f jsonb := p_fields;
  cur jsonb;
begin
  if p_tbl not in ('tasks', 'tags', 'habit_checkins', 'task_activity') then
    raise exception 'bad_table' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_account::text, 0));
  if f ? '_delta' then
    select r.data into cur from public.sync_rows r where r.owner_id = p_account and r.tbl = p_tbl and r.id = p_id;
    f := (f - '_delta') || jsonb_build_object('value',
      (case when cur is null or cur->>'deleted_at' is not null then 0 else coalesce((cur->>'value')::numeric, 0) end)
      + (f->>'_delta')::numeric);
  end if;
  insert into public.sync_rows as r (owner_id, tbl, id, data, version)
  values (p_account, p_tbl, p_id, f, nextval('public.sync_version'))
  on conflict (owner_id, tbl, id) do update set data = r.data || excluded.data, version = excluded.version, updated_at = now();
  perform public.ping_all(p_account);
end $$;

-- ---------- Access ----------

alter table public.chat_links enable row level security;
alter table public.link_codes enable row level security;
alter table public.webhooks enable row level security;
alter table public.chat_listings enable row level security;
alter table public.rate_counts enable row level security;
alter table public.slack_installs enable row level security;
alter table public.server_secrets enable row level security;
revoke all on public.chat_links, public.link_codes, public.webhooks, public.chat_listings, public.rate_counts,
  public.slack_installs, public.server_secrets from anon, authenticated;

do $$
declare fn regprocedure;
begin
  for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('create_link_code', 'my_connections', 'remove_connection', 'set_digest',
      'create_webhook', 'delete_webhook', 'has_webhook', 'link_chat', 'hit_rate', 'due_digests', 'run_digest', 'server_write')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
  end loop;
end $$;
grant execute on function public.create_link_code(), public.my_connections(), public.remove_connection(uuid),
  public.set_digest(uuid, time), public.create_webhook(), public.delete_webhook(), public.has_webhook() to authenticated;
grant execute on function public.link_chat(text, text, text, text, jsonb), public.hit_rate(text, int, interval),
  public.due_digests(), public.server_write(uuid, text, text, jsonb) to service_role;
