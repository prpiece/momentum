-- Note images sync (PLAN D291). Bumps schema_version to 6.
--
-- A task note embeds an image as `![](attachment:<uuid>.<ext>)`; the file used to stay on the device
-- that pasted it. Each one is now uploaded once to the private `attachments` bucket at `notes/<file>`.
-- Who may read it follows the tasks that reference it: an account reads `notes/<file>` when it can see
-- a task whose description names the file and the uploader can see that same task too (so copying a
-- file name into a task of your own grants nothing). Uploading needs editor access to such a task.
-- Moving the task, sharing or unsharing its list, and purging it change access with no extra work.

/* The attachment file names a note references. Immutable, so the index below can use it. */
create function public.note_attachments(p text) returns text[]
language sql immutable parallel safe set search_path = '' as $$
  select coalesce(array(select m[1] from regexp_matches(coalesce(p, ''), 'attachment:([A-Za-z0-9_-]+\.[A-Za-z0-9]+)', 'g') m), '{}');
$$;

create index sync_rows_note_attachments on public.sync_rows
  using gin (public.note_attachments(data->>'description')) where tbl = 'tasks';

/*
 * `notes/<file>`: the signed-in account holds at least p_min on a task that references the file, and,
 * when p_uploader is given, the uploader can see that task as well.
 */
create function public.note_attachment_access(p_name text, p_min text, p_uploader text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(array_length(storage.foldername(p_name), 1), 0) = 1 and (storage.foldername(p_name))[1] = 'notes'
    and exists (
      select 1 from public.sync_rows r
      where r.tbl = 'tasks' and public.note_attachments(r.data->>'description') @> array[storage.filename(p_name)]
        and public.role_rank(public.row_role(r.owner_id, 'tasks', r.id, r.data, auth.uid())) >= public.role_rank(p_min)
        and (p_uploader is null or public.row_role(r.owner_id, 'tasks', r.id, r.data, p_uploader::uuid) is not null));
$$;

revoke all on function public.note_attachments(text), public.note_attachment_access(text, text, text) from public, anon, authenticated;
grant execute on function public.note_attachment_access(text, text, text) to authenticated;

-- Same bucket, size cap (10 MB) and image types as the share paths; insert-only for notes (a re-upload
-- of the same name is refused as a duplicate, which the client counts as done).
drop policy attachments_read on storage.objects;
create policy attachments_read on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and (public.attachment_access(name, 'viewer') or public.note_attachment_access(name, 'viewer', owner_id)));
drop policy attachments_write on storage.objects;
create policy attachments_write on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and (public.attachment_access(name, 'editor') or public.note_attachment_access(name, 'editor', null))
              and public.storage_used() < (public.plan_limits((select auth.uid()))->>'storage_bytes')::bigint);

update public.server_meta set schema_version = 6;
