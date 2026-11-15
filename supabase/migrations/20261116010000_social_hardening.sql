-- v1.2.4 test findings (SOC-02, SOC-06, SOC-09, SOC-14). Bumps schema_version to 5.

/* SOC-02: a blocked pair can't accept an invitation, and blocking cancels the pending ones both ways. */
create or replace function public.respond_share(p_share uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.me();
  s public.shares := public.share_of(p_share);
  before jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('shares', 0));
  before := public.scope_snapshot(s.owner_id, s.kind, s.container_id);
  if p_accept and public.is_blocked(me, s.owner_id) then raise exception 'no_such_invitation' using errcode = 'P0002'; end if;
  if p_accept then
    update public.share_members set status = 'active', joined_at = now() where share_id = p_share and account_id = me and status = 'invited';
  else
    delete from public.share_members where share_id = p_share and account_id = me and status = 'invited';
  end if;
  if not found then raise exception 'no_such_invitation' using errcode = 'P0002'; end if;
  perform public.settle_share(p_share, before);
end $$;

/* Ends the friendship and every request both ways, hides each account from the other and cancels
   share invitations between them. Active shares stay (SOC-03 is a product decision). */
create or replace function public.block_account(p_account uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.me();
begin
  if p_account = me then raise exception 'bad_account' using errcode = '22023'; end if;
  perform public.remove_friend(p_account);
  insert into public.blocks (blocker, blocked) values (me, p_account) on conflict do nothing;
  delete from public.share_members m using public.shares s
  where m.share_id = s.id and m.status = 'invited'
    and ((s.owner_id = me and m.account_id = p_account) or (s.owner_id = p_account and m.account_id = me));
end $$;

/* SOC-06: a global ceiling on link attempts (the per-chat limit alone lets many throwaway chats
   guess a 6-digit code). The attempt counts before the lookup, so a failed one is counted too. */
create or replace function public.link_chat(p_code text, p_source text, p_external text, p_label text, p_reply jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  acct uuid;
begin
  if not public.hit_rate('link:all', 120, interval '1 minute') then raise exception 'bad_code' using errcode = 'P0002'; end if;
  delete from public.link_codes where code = p_code and expires_at > now() returning account_id into acct;
  if acct is null then raise exception 'bad_code' using errcode = 'P0002'; end if;
  insert into public.chat_links (account_id, source, external_id, label, reply) values (acct, p_source, p_external, p_label, p_reply)
  on conflict (source, external_id) do update set account_id = excluded.account_id, label = excluded.label,
    reply = excluded.reply, digest_time = null, digest_sent = null, permission = 'full';
  return acct;
end $$;

/* SOC-09: a sent task is checked when it is sent, so accepting it can't write a value the apps refuse. */
create or replace function public.send_task(p_sender uuid, p_recipient uuid, p_payload jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  sid uuid;
  v jsonb;
begin
  if not public.is_friend(p_sender, p_recipient) then
    raise exception 'not_friends' using errcode = '42501';
  end if;
  if (select count(*) from public.sent_tasks where sender = p_sender and created_at > now() - interval '1 day') >= 100 then
    raise exception 'too_many_sent' using errcode = '23514';
  end if;
  if jsonb_typeof(p_payload->'title') <> 'string' or trim(p_payload->>'title') = '' or char_length(p_payload->>'title') > 500 then
    raise exception 'bad_title' using errcode = '22023';
  end if;
  v := public.pick(p_payload, array['title', 'description', 'checklist', 'subtasks', 'priority', 'due_date']);
  if jsonb_typeof(v->'description') is distinct from 'string' then v := v - 'description'; end if;
  if jsonb_typeof(v->'due_date') is distinct from 'string' then v := v - 'due_date'; end if;
  if jsonb_typeof(v->'checklist') is distinct from 'array' then v := v - 'checklist'; end if;
  if jsonb_typeof(v->'subtasks') is distinct from 'array' then v := v - 'subtasks'; end if;
  if jsonb_typeof(v->'priority') is distinct from 'number' or (v->>'priority') not in ('0', '1', '2', '3') then v := v - 'priority'; end if;
  insert into public.sent_tasks (sender, recipient, payload) values (p_sender, p_recipient, v) returning id into sid;
  return sid;
end $$;

/* SOC-14: the 30-day handle limit can't be reset by clearing handle_changed_at (a signed-in user's
   own update can't touch it; only a handle change sets it). */
create or replace function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.handle is distinct from old.handle then
    if exists (select 1 from public.reserved_handles r where r.handle = new.handle) then
      raise exception 'handle_reserved' using errcode = '23514';
    end if;
    if old.handle_changed_at is not null and old.handle_changed_at > now() - interval '30 days' then
      raise exception 'handle_changed_recently' using errcode = '23514';
    end if;
    new.handle_changed_at := now();
  elsif auth.uid() is not null then
    new.handle_changed_at := old.handle_changed_at;
  end if;
  new.id := old.id;
  return new;
end $$;

update public.server_meta set schema_version = 5;
