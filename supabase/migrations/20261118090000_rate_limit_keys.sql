/* Global rate-limit buckets could be drained by anonymous or throwaway callers, locking everyone out.
   Each caller's own key is now counted first, and a caller already over its own budget never touches
   the global one. The global ceilings stay as a last-resort bound, set so one abuser can't reach them. */

/* Who is calling: the account, else the address the Supabase platform puts in cf-connecting-ip, else the
   first x-forwarded-for entry (docs: guides/api/securing-your-api, guides/api/query-plans). The address key is
   spoofable when the platform header is absent, so it only spreads load: the global caps stay the real bound.
   ponytail: header choice from the docs, confirm on the hosted project (and that storage-api sets
   request.headers; if not, the key is null there and report:upload is the only bound on uploads). */
create function public.client_key() returns text
language sql stable set search_path = '' as $$
  select coalesce(auth.uid()::text, nullif(left(h->>'cf-connecting-ip', 64), ''), nullif(left(trim(split_part(h->>'x-forwarded-for', ',', 1)), 64), ''))
  from (select nullif(current_setting('request.headers', true), '')::json as h) x;
$$;
grant execute on function public.client_key() to anon, authenticated, service_role;

/* As in 20261116040000, with every guess counted against the chat (60 an hour) and then globally (300 a
   minute, the bound on code guessing) before the code is looked at. A wrong or refused guess returns null
   instead of raising: a raise rolls the transaction back, increments included, so failed guesses were
   never counted. The caller treats null as 'bad code' and replies as before. */
create or replace function public.link_chat(p_code text, p_source text, p_external text, p_label text, p_reply jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  acct uuid;
begin
  -- Separate ifs: the chat's own key is always counted first, and link:all only when it passes.
  if not public.hit_rate('link:' || left(p_source || ':' || p_external, 100), 60, interval '1 hour') then return null; end if;
  if not public.hit_rate('link:all', 300, interval '1 minute') then return null; end if;
  delete from public.link_codes where code = p_code and expires_at > now() returning account_id into acct;
  if acct is null then return null; end if;
  insert into public.chat_links (account_id, source, external_id, label, reply) values (acct, p_source, p_external, p_label, p_reply)
  on conflict (source, external_id) do update set account_id = excluded.account_id, label = excluded.label,
    reply = excluded.reply, digest_time = null, digest_sent = null, permission = 'add';
  return acct;
end $$;

/* A refused insert rolls back its own count, so only accepted reports count; that is enough, since a refused caller stores nothing.
   Report rows: 20 a day for a signed-in account, 5 an hour for an anonymous address, then 1000 an hour for everyone. */
create or replace function public.reports_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare k text := public.client_key();
begin
  -- Separate ifs: the caller's own key is always counted first, and report:all only when it passes.
  if auth.uid() is not null and not public.hit_rate('report:' || auth.uid(), 20, interval '1 day') then
    raise exception 'too_many_reports' using errcode = '23514';
  end if;
  if auth.uid() is null and k is not null and not public.hit_rate('report:ip:' || k, 5, interval '1 hour') then
    raise exception 'too_many_reports' using errcode = '23514';
  end if;
  if not public.hit_rate('report:all', 1000, interval '1 hour') then
    raise exception 'too_many_reports' using errcode = '23514';
  end if;
  return new;
end $$;

/* Screenshot uploads: 20 an hour per caller, then 150 an hour across everyone (5 MB each, about 750 MB) (the free tier's 1 GB). */
create or replace function public.report_upload_ok() returns boolean
language plpgsql security definer set search_path = '' as $$
declare k text := public.client_key();
begin
  return (k is null or public.hit_rate('report:upload:' || k, 20, interval '1 hour'))
     and public.hit_rate('report:upload', 150, interval '1 hour');
end $$;

update public.server_meta set schema_version = 20;
