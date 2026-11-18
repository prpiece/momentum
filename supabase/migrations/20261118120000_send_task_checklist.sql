-- Sent checklists never arrived: the apps send the checklist as JSON text (the form synced rows store it
-- in, and the only form their row mapping reads), but send_task kept arrays only, so the text was dropped.
-- As in 20261118070000, plus: a checklist (top-level or on a sub-task) arrives as JSON text holding an
-- array, or as an array, and is stored as re-serialised (canonical) JSON text; text that isn't a JSON
-- array is dropped as before. More than 100 items or 20,000 characters is refused (bad_checklist).

/* A checklist value as the JSON text synced rows hold (null: not a checklist, drop it). */
create function public.checklist_text(p jsonb) returns text
language plpgsql immutable set search_path = '' as $$
declare
  a jsonb := p;
begin
  if jsonb_typeof(p) = 'string' then
    begin
      a := (p #>> '{}')::jsonb;
    exception when others then
      return null;
    end;
  end if;
  if jsonb_typeof(a) is distinct from 'array' then return null; end if;
  if jsonb_array_length(a) > 100 or char_length(a::text) > 20000 then
    raise exception 'bad_checklist' using errcode = '22023';
  end if;
  return a::text;
end $$;
revoke all on function public.checklist_text(jsonb) from public, anon, authenticated;
grant execute on function public.checklist_text(jsonb) to service_role;

create or replace function public.send_task(p_sender uuid, p_recipient uuid, p_payload jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  sid uuid;
  v jsonb;
  sub jsonb;
  subs jsonb := '[]';
  c text;
begin
  if not public.is_friend(p_sender, p_recipient) then
    raise exception 'not_friends' using errcode = '42501';
  end if;
  if (select count(*) from public.sent_tasks where sender = p_sender and created_at > now() - interval '1 day') >= 100
     or (select count(*) from public.sent_tasks where recipient = p_recipient and status = 'pending') >= 200 then
    raise exception 'too_many_sent' using errcode = '23514';
  end if;
  if jsonb_typeof(p_payload->'title') <> 'string' or trim(p_payload->>'title') = '' or char_length(p_payload->>'title') > 500 then
    raise exception 'bad_title' using errcode = '22023';
  end if;
  v := public.pick(p_payload, array['title', 'description', 'checklist', 'subtasks', 'priority', 'due_date']);
  if jsonb_typeof(v->'description') is distinct from 'string' then v := v - 'description'; end if;
  if jsonb_typeof(v->'due_date') is distinct from 'string' then v := v - 'due_date'; end if;
  if jsonb_typeof(v->'subtasks') is distinct from 'array' then v := v - 'subtasks'; end if;
  if jsonb_typeof(v->'priority') is distinct from 'number' or (v->>'priority') not in ('0', '1', '2', '3') then v := v - 'priority'; end if;
  c := public.checklist_text(v->'checklist');
  v := case when c is null then v - 'checklist' else v || jsonb_build_object('checklist', c) end;
  if v ? 'due_date' then
    begin
      if (v->>'due_date') !~ '^\d{4}-\d{2}-\d{2}$' or to_char((v->>'due_date')::date, 'YYYY-MM-DD') <> v->>'due_date' then
        raise exception 'bad_due_date' using errcode = '22023';
      end if;
    exception when datetime_field_overflow or invalid_datetime_format then
      raise exception 'bad_due_date' using errcode = '22023';
    end;
  end if;
  if jsonb_array_length(coalesce(v->'subtasks', '[]')) > 50 then
    raise exception 'too_many_subtasks' using errcode = '22023';
  end if;
  for sub in select value from jsonb_array_elements(coalesce(v->'subtasks', '[]')) loop
    if jsonb_typeof(sub) <> 'object'
       or jsonb_typeof(sub->'title') is distinct from 'string' or trim(sub->>'title') = '' or char_length(sub->>'title') > 500
       or (sub ? 'description' and jsonb_typeof(sub->'description') is distinct from 'string')
       or (sub ? 'checklist' and jsonb_typeof(sub->'checklist') not in ('array', 'string')) then
      raise exception 'bad_subtask' using errcode = '22023';
    end if;
    c := public.checklist_text(sub->'checklist');
    subs := subs || (case when c is null then sub - 'checklist' else sub || jsonb_build_object('checklist', c) end);
  end loop;
  if v ? 'subtasks' then v := v || jsonb_build_object('subtasks', subs); end if;
  insert into public.sent_tasks (sender, recipient, payload) values (p_sender, p_recipient, v) returning id into sid;
  return sid;
end $$;

update public.server_meta set schema_version = 23;
