-- send_task checked the top-level task but let sub-task fields and the due date through unchecked
-- (insert_inbox_task trusted them). As in 20261116040000, plus: due_date must be a real YYYY-MM-DD,
-- at most 50 sub-tasks (the number insert_inbox_task keeps), and each sub-task is an object with a
-- string title of 1..500 characters, a string description and an array checklist when present.
-- Refused like the title: errcode 22023.
create or replace function public.send_task(p_sender uuid, p_recipient uuid, p_payload jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  sid uuid;
  v jsonb;
  sub jsonb;
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
  if jsonb_typeof(v->'checklist') is distinct from 'array' then v := v - 'checklist'; end if;
  if jsonb_typeof(v->'subtasks') is distinct from 'array' then v := v - 'subtasks'; end if;
  if jsonb_typeof(v->'priority') is distinct from 'number' or (v->>'priority') not in ('0', '1', '2', '3') then v := v - 'priority'; end if;
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
       or (sub ? 'checklist' and jsonb_typeof(sub->'checklist') is distinct from 'array') then
      raise exception 'bad_subtask' using errcode = '22023';
    end if;
  end loop;
  insert into public.sent_tasks (sender, recipient, payload) values (p_sender, p_recipient, v) returning id into sid;
  return sid;
end $$;

update public.server_meta set schema_version = 19;
