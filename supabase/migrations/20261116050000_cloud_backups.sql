-- Cloud copy of the automatic backup (FEAT-06). Bumps schema_version to 9.
--
-- Private `backups` bucket, paths `<account id>/momentum-auto-<stamp>.json`. The file is the backup JSON,
-- or the client-side encrypted envelope when the user set a passphrase (the server never sees the key).
-- An account reads, writes and deletes only its own folder; the client keeps the newest 7 (or the number
-- chosen). Not counted against the shared-attachments quota (storage_used() looks at `attachments` only).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('backups', 'backups', false, 52428800, array['application/json', 'text/plain'])
on conflict (id) do nothing;

create policy backups_read on storage.objects for select to authenticated
  using (bucket_id = 'backups' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy backups_write on storage.objects for insert to authenticated
  with check (bucket_id = 'backups' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy backups_delete on storage.objects for delete to authenticated
  using (bucket_id = 'backups' and (storage.foldername(name))[1] = (select auth.uid())::text);

update public.server_meta set schema_version = 9;
